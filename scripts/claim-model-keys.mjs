/**
 * Give a key to every account that has none.
 *
 * Registration is where a key is normally taken, so this exists for the two
 * moments registration cannot cover: accounts that were made before the
 * deployment had a pool, and accounts that registered while it was empty.
 *
 * It is a command rather than something the gateway does when it notices,
 * because noticing would mean claiming from a path nobody chose — a sandbox
 * coming up, a page being loaded — and a claim on a read path is a way to
 * spend a key by accident. This is the operator saying "hand these out", after
 * loading a pool, on purpose.
 *
 * Idempotent: an account that already holds a key is not touched, and a run
 * against a full set of accounts costs nothing.
 *
 *   docker compose exec -T gateway node scripts/claim-model-keys.mjs
 *   docker compose exec -T gateway node scripts/claim-model-keys.mjs --dry-run
 */

import process from 'node:process'
import { connect } from '../gateway/src/db.js'
import { ModelKeys } from '../gateway/src/model-keys.js'

const dryRun = process.argv.includes('--dry-run')
const db = await connect()
try {
  const keys = new ModelKeys(db)
  const { rows: waiting } = await db.query(
    'SELECT email FROM accounts WHERE model_key IS NULL AND NOT disabled ORDER BY created_at',
  )
  const { total, claimed } = await keys.census()
  console.log(`claim-model-keys: ${String(waiting.length)} account(s) without a key; pool has ${String(total - claimed)} free of ${String(total)}`)
  if (dryRun || waiting.length === 0) process.exit(0)

  let given = 0
  for (const { email } of waiting) {
    const key = await keys.claim(email)
    if (key === undefined) {
      // The pool ran out partway through. Said once and stopped, rather than
      // repeating the same line for every account left: what is wrong is the
      // pool, and the rest of the list is the same answer.
      console.error(`claim-model-keys: the pool is empty after ${String(given)} — load more keys and run again`)
      break
    }
    given += 1
  }
  console.log(`claim-model-keys: gave out ${String(given)}`)
} finally {
  await db.end()
}
