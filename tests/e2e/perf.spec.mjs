// Speed with a realistic big spreadsheet (5,000-row ledger: 30,000 cells, 15,000 formulas). Prints timings; fails only
// on gross slowness, since test machines vary. Engine timings: `node tests/perf/bench.mjs`.
import { test, expect } from '@playwright/test';
import { signUp, createNote, openNote, grid } from './helpers.mjs';
import { ledger } from '../perf/workbooks.mjs';

test('a 5,000-row ledger: opening, editing, jumping far', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page); const id = await createNote(page, { title: 'Ledger', kind: 'sheet', block: 'sheet', data: ledger(5000) });
  const t0 = Date.now(); await openNote(page, id);
  await expect(page.locator('.xl-q .xc', { hasText: /^1470020$/ })).toHaveCount(1, { timeout: 60_000 }); const open = Date.now() - t0; // K1, the grand total
  const g = grid(page); await g.go('B10'); await page.keyboard.type('1000');
  const before = await page.evaluate(() => [...document.querySelectorAll('.xl-q .xc')].map((e) => e.textContent).includes('1470650'));
  const t1 = Date.now(); await page.keyboard.press('Enter');
  await expect(page.locator('.xl-q .xc', { hasText: /^1470650$/ })).toHaveCount(1); const edit = Date.now() - t1; // the total follows: 1470020 - 370 + 1000 (B10 was 370)
  const t2 = Date.now(); await g.go('D4000'); await expect(page.locator('.xl-rh .xh[data-row="3999"]')).toHaveCount(1); const jump = Date.now() - t2;
  console.log(`PERF 5,000-row ledger: open ${open} ms | edit → total updated ${edit} ms | jump to row 4,000 ${jump} ms`);
  expect(before).toBe(false); expect(edit).toBeLessThan(3000); expect(jump).toBeLessThan(3000); expect(open).toBeLessThan(30_000);
});
