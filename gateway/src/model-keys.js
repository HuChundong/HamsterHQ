/**
 * One model credential per tenant, claimed from a pool the operator filled.
 *
 * The deployment's model is served by something that meters it, and that thing
 * is not this project's dependency: how many keys exist, what each one is
 * allowed to spend, and what happens when it is gone are decisions made where
 * the meter lives. What this project needs is narrower than all of that — a
 * tenant needs one credential that is theirs — and the narrow thing is worth
 * doing narrowly.
 *
 * So a key is claimed, not minted. The operator makes them in bulk, offline,
 * in whatever system serves the model, and loads the strings in with
 * `scripts/load-model-keys.mjs`. Registration then takes one row and writes it
 * onto the account, and everything after that reads a column.
 *
 * That is the whole reason this is not a call out to somebody's API at
 * registration. A call has to be configured, authenticated, retried, timed out
 * and explained when it fails, and it fails on the one path where a person is
 * waiting — a sign-in. A claim is one statement against a table this
 * deployment already owns, it cannot be slow, and a pool that runs dry is an
 * operator's problem that a line in the log states plainly rather than a
 * tenant's sign-in that hangs.
 *
 * A tenant whose claim finds nothing gets the deployment's own credential,
 * which is what every sandbox used before pooling existed.
 *
 * @module model-keys
 */

/**
 * Per-tenant model credentials, claimed once and kept.
 */
export class ModelKeys {
  /**
   * @param {import('pg').Pool} pool - the connected database pool.
   */
  constructor(pool) {
    this.pool = pool
  }

  /**
   * The key this account holds, if it holds one.
   *
   * A column read, and deliberately nothing more. Which key is a tenant's is
   * decided once, when they register; every read after that — and a sandbox
   * creation is a read — has no business running a claim, taking a lock, or
   * touching the pool at all. This used to claim on every call, which meant
   * every path that wanted to know a tenant's key was also a path that could
   * spend one.
   *
   * @param {string} email - the tenant's address.
   * @returns {Promise<string | undefined>} the key, or undefined when this account has none.
   */
  async keyFor(email) {
    const { rows } = await this.pool.query('SELECT model_key FROM accounts WHERE email = $1', [email])
    return rows[0]?.model_key ?? undefined
  }

  /**
   * Take one key from the pool for an account that has none.
   *
   * Called at registration, and by the operator's backfill for accounts that
   * registered when the pool was empty. Both are moments somebody chose; a
   * sandbox coming up is not one of them.
   *
   * One statement, and the claim is the statement. `WHERE email IS NULL` with
   * `FOR UPDATE SKIP LOCKED` is what makes two registrations at the same
   * moment take two different rows rather than one row twice — the second
   * transaction skips what the first is holding instead of waiting for it and
   * then overwriting.
   *
   * The answer comes from `RETURNING` and not from reading the table back, and
   * that is not a preference. A data-modifying CTE's effect is NOT visible to
   * the rest of the statement it sits in: Postgres runs every part against the
   * snapshot the statement started with, so a final `SELECT ... WHERE email =
   * $1` sees the row as it was — unclaimed, belonging to nobody — and answers
   * nothing while the UPDATE beside it has already taken the key. That ran in
   * production for twenty minutes and cost three keys: spent, and reported as
   * "the pool is empty".
   *
   * `held` is checked first and guards the claim, so an account asked for
   * twice keeps the key it has rather than taking a second one.
   *
   * @param {string} email - the tenant's address.
   * @returns {Promise<string | undefined>} the key it now holds, or undefined when the pool is empty.
   */
  async claim(email) {
    const { rows } = await this.pool.query(
      `WITH held AS (
         SELECT model_key AS api_key FROM accounts WHERE email = $1 AND model_key IS NOT NULL
       ), free AS (
         SELECT api_key FROM model_keys
          WHERE email IS NULL AND NOT EXISTS (SELECT 1 FROM held)
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       ), taken AS (
         UPDATE model_keys AS k
            SET email = $1, claimed_at = now()
           FROM free
          WHERE k.api_key = free.api_key
        RETURNING k.api_key
       ), written AS (
         UPDATE accounts AS a
            SET model_key = taken.api_key
           FROM taken
          WHERE a.email = $1
        RETURNING a.model_key AS api_key
       )
       SELECT api_key FROM held
        UNION ALL
       SELECT api_key FROM written`,
      [email],
    )
    if (rows.length > 0) return rows[0].api_key
    console.warn(`gateway: no model key for ${email}: the pool is empty`)
    return undefined
  }

  /**
   * How many keys there are and how many are spoken for.
   *
   * For whoever has to notice that the pool is running out before a tenant
   * does. A count is cheap and the alternative is finding out from a person
   * whose agent is spending the deployment's own credential.
   *
   * @returns {Promise<{total: number, claimed: number}>} the two numbers.
   */
  async census() {
    const { rows } = await this.pool.query(
      'SELECT count(*)::int AS total, count(email)::int AS claimed FROM model_keys',
    )
    return rows[0] ?? { total: 0, claimed: 0 }
  }
}
