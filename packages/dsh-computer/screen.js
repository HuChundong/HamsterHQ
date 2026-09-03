/**
 * The sandbox's screen, read once.
 *
 * The handoff card has to show what the person is about to take over, and
 * that is the whole desktop rather than the agent's browser page. Those are
 * not the same picture, and the difference was the bug: the card asked CDP
 * for a page screenshot, but the desktop image starts Chrome lazily, so a
 * card raised before the agent had opened a page — or for a KDE dialog, a
 * terminal, or the very login that stopped the automation — showed "the
 * browser has not started" over an empty rectangle.
 *
 * `maim` because the measurement decided it, taken on the desktop image's own
 * X display at 1920x1080: one JPEG to stdout in 59ms at 51KB, for 311KB of
 * download and 1.4MB installed. `scrot` is the same idea and costs 59MB —
 * imlib2 drags in ghostscript and the URW font set for loaders nothing here
 * will ever open. `imagemagick` and `ffmpeg` are already refused in the
 * Dockerfile for costing more than the conversions they would add, and PNG
 * through Node's zlib was measured too: 226ms and 282KB for the same frame.
 *
 * A grabber of our own was considered and is the wrong trade. X11 has an
 * official client; writing the wire protocol to save 1.4MB is the thing
 * AGENTS.md forbids, and the Rust binary this sandbox already runs is
 * dependency-free on purpose.
 *
 * @module dsh-computer/screen
 */

import { execFile } from 'node:child_process'
import process from 'node:process'

/** Xvnc's display. The desktop stack owns `:0` and starts it before dsh. */
const DISPLAY = process.env.DISPLAY ?? ':0'

/** Longer than a capture takes by an order of magnitude, short enough to poll. */
const SHOT_TIMEOUT_MS = 4000

/** A 1920x1080 frame is ~51KB. Anything near this bound is a broken encoder. */
const MAX_BYTES = 8 * 1024 * 1024

/**
 * maim's 1-10 scale, not libjpeg's 1-100. Six is where the desktop's flat
 * fills stop showing ringing around text; higher only grows the base64.
 */
const QUALITY = '6'

/**
 * One JPEG of the whole screen.
 *
 * A light sandbox has no X display and no `maim`, and that is not an error:
 * the caller asks the same question of every variant and renders whatever
 * comes back, so a missing screen is reported rather than thrown.
 *
 * @returns {Promise<{running: boolean, data?: string}>} the frame, base64.
 */
export function shot() {
  return new Promise((resolve) => {
    execFile(
      'maim',
      ['--format=jpg', `--quality=${QUALITY}`],
      {
        encoding: 'buffer',
        timeout: SHOT_TIMEOUT_MS,
        maxBuffer: MAX_BYTES,
        env: { ...process.env, DISPLAY },
      },
      (error, stdout) => {
        if (error !== null || stdout.length === 0) resolve({ running: false })
        else resolve({ running: true, data: stdout.toString('base64') })
      },
    )
  })
}
