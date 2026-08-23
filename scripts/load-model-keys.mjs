/**
 * Load model credentials into the pool tenants claim from.
 *
 * The keys are made where the model is metered — in bulk, offline, by whoever
 * administers that system — and this puts the strings somewhere a registration
 * can take one. It knows nothing else about them: not what they may spend, not
 * when they expire, not which system issued them. A key is a string that works
 * until the thing that issued it says otherwise.
 *
 * Reads one key per line, from a file or from standard input. Blank lines and
 * `#` comments are skipped so that a list can carry a note about where it came
 * from. Loading is idempotent: a key already in the pool is left exactly as it
 * is, claimed or not, so re-running a list after adding to it cannot take a
 * key away from the tenant holding it.
 *
 * Run against the deployment's database:
 *
 *   docker compose exec -T gateway node scripts/load-model-keys.mjs < keys.txt
 *   docker compose exec -T gateway node scripts/load-model-keys.mjs keys.txt
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { connect } from '../gateway/src/db.js'

/**
 * Everything on standard input, as text.
 *
 * @returns {Promise<string>} what was piped in.
 */
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const source = process.argv[2] === undefined ? await readStdin() : readFileSync(process.argv[2], 'utf8')
const keys = source
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))

if (keys.length === 0) {
  console.error('load-model-keys: nothing to load — expected one key per line')
  process.exit(2)
}

const unique = [...new Set(keys)]
const db = await connect()
try {
  // One statement for the whole list. `ON CONFLICT DO NOTHING` is what makes
  // re-running safe: the row that is already there may be claimed, and the
  // update that "refreshed" it would be the update that took a working
  // credential away from whoever is using it.
  const { rowCount } = await db.query(
    `INSERT INTO model_keys (api_key) SELECT unnest($1::text[]) ON CONFLICT (api_key) DO NOTHING`,
    [unique],
  )
  const { rows } = await db.query('SELECT count(*)::int AS total, count(email)::int AS claimed FROM model_keys')
  const { total, claimed } = rows[0]
  console.log(`load-model-keys: added ${String(rowCount)} of ${String(unique.length)}; pool now ${String(total - claimed)} free of ${String(total)}`)
} finally {
  await db.end()
}
