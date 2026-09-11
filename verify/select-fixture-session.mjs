/**
 * Select a fixture conversation that the workspace sidebar actually exposes.
 * History includes archived sessions, and titles live in projection values;
 * choosing the first history item or renaming it can target an invisible row.
 */
import assert from 'node:assert/strict'

/** The caller opens /app first; this helper does not create or rename sessions. */
export async function selectFixtureSession(page, rpc, timeout = 120_000) {
  const listed = await rpc.call('session/list', { _request: {} })
  assert(listed.ok)
  // Session history includes archived rows. The workspace sidebar owns which
  // nonblank sessions are visible; select its actual row without renaming it.
  const titles = listed.value.items
    .filter((session) => !session.blank)
    .map((session) => session.projections?.values?.title)
    .filter((title) => typeof title === 'string' && title.length > 0)
  assert(titles.length > 0, 'acceptance tenant needs a titled nonblank fixture session')
  await page.waitForFunction(
    (candidates) => {
      const rows = globalThis.document.querySelectorAll('[data-slot="sidebar.workspaces"] [role="treeitem"]')
      return [...rows].some(
        (row) =>
          row.getClientRects().length > 0 &&
          [...row.querySelectorAll('*')].some((node) => candidates.includes(node.textContent?.trim())),
      )
    },
    titles,
    { timeout },
  )
  let selected = false
  for (const title of titles) {
    const row = page
      .locator('[data-slot="sidebar.workspaces"]')
      .getByText(title, { exact: true })
      .first()
    if (!(await row.isVisible())) continue
    await row.click()
    selected = true
    break
  }
  assert(selected, 'no visible nonarchived fixture conversation was available')
}
