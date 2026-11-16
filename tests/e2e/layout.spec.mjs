// Layout: document list rows, full-window spreadsheet and presentation editors, the one-row spreadsheet toolbar.
import { test, expect } from '@playwright/test';
import { signUp, api, newSheet, newSlides, grid } from './helpers.mjs';

test('document list: no preview lines, tags kept', async ({ page }) => {
  await signUp(page);
  await api(page, 'POST', '/api/notes', { title: 'Plans', content: 'A first line that used to be shown', tag: 'Work' });
  await api(page, 'POST', '/api/notes', { title: 'Budget', kind: 'sheet', content: '[[sheet:eyJzaGVldHMiOltdfQ]]' });
  await page.goto('/#/documents'); await page.reload(); await page.waitForSelector('.doc-row');
  await expect(page.locator('.doc-row', { hasText: 'Plans' }).locator('.row-sub')).toHaveText('Work');
  await expect(page.locator('.doc-row', { hasText: 'Budget' }).locator('.row-sub')).toHaveCount(0);
  expect(await page.locator('#doc-list').innerText()).not.toMatch(/\[\[sheet:|used to be shown/);
});

for (const width of [1190, 1440]) {
  test(`spreadsheet and presentation fill the window; the toolbar is one row (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 }); await signUp(page);
    for (const make of [newSheet, newSlides]) {
      await page.goto('/#/documents'); await make(page); await page.waitForTimeout(400);
      const box = await page.evaluate(() => { const e = document.querySelector('.sheet-file-ui, .deck-file-ui').getBoundingClientRect(); const bar = document.querySelector('.doc-bar').getBoundingClientRect(); const sc = document.querySelector('.doc-scroll'); return { left: e.left, right: e.right, top: e.top - bar.bottom, bottom: e.bottom, scrolls: sc.scrollHeight > sc.clientHeight + 1 }; });
      expect(box.left).toBeLessThanOrEqual(1); expect(box.right).toBeGreaterThanOrEqual(width - 1); expect(box.top).toBeLessThanOrEqual(2); expect(box.bottom).toBeGreaterThanOrEqual(819); expect(box.scrolls).toBe(false);
    }
    await page.goto('/#/documents'); await newSheet(page);
    expect(await page.evaluate(() => document.querySelector('.xl-tb-row').getBoundingClientRect().height)).toBeLessThan(60); // one row
  });
}

test('spreadsheet drop-down cards: open, close on Escape and outside click; the Align drop-down works', async ({ page }) => {
  await signUp(page); await newSheet(page); const g = grid(page);
  const data = page.locator('.rb-tab[data-rbtab="Data"]');
  await data.click(); await expect(page.locator('.rb-pop')).toBeVisible(); await expect(data).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.rb-pop [data-cmd="sort-dialog"]').focus(); await page.keyboard.press('Escape');
  await expect(page.locator('.rb-pop')).toBeHidden(); await expect(data).toBeFocused();
  await data.click(); await page.locator('.xl-wrap').click({ position: { x: 200, y: 120 } }); await expect(page.locator('.rb-pop')).toBeHidden();
  await g.put('B2', 'x'); await g.go('B2'); await page.click('.xl-tb-row [data-cmd="align-menu"]'); await page.click('.menu-item >> text=Centre');
  expect(await g.cellStyle('x', 'justifyContent')).toBe('center');
});

test('New buttons: one row of three with template menus; saved templates appear under their type', async ({ page }) => {
  await signUp(page);
  await expect(page.locator('.quick-split')).toHaveCount(3); await expect(page.locator('[data-action=new-template]')).toHaveCount(0);
  const tops = await page.locator('.quick-split').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1); // one row
  const menu = async (kind) => { await page.goto('/#/documents'); await page.click(`[data-action=template-menu][data-kind=${kind}]`); await expect(page.locator('.menu')).toBeVisible(); return page.locator('.menu .menu-item .menu-label'); };
  await expect(await menu('sheet')).toHaveText(['Monthly budget', 'Expense tracker', 'Project tracker', 'Invoice', 'Manage templates…']);
  await page.click('.menu-item >> text=Monthly budget'); await page.waitForSelector('.xl-wrap');
  const g = { raw: async (ref) => { await page.click('.xl-name'); await page.fill('.xl-name', ref); await page.keyboard.press('Enter'); return page.inputValue('.xl-formula'); } };
  expect(await g.raw('B19')).toBe('=B6-C17'); await expect(page.locator('.xl-q .xc', { hasText: /^1,504\.50$/ })).toHaveCount(1);
  const sheetId = await page.evaluate(() => location.hash.split('/').pop());
  await expect(await menu('slides')).toHaveText(['Pitch deck', 'Project update', 'Team meeting', 'Manage templates…']);
  await page.click('.menu-item >> text=Pitch deck'); await expect(page.locator('.gs-film .deck-thumb')).toHaveCount(7);
  await expect(await menu('note')).toContainText(['Meeting notes']); await page.click('.menu-item >> text=Meeting notes'); await page.waitForSelector('.ProseMirror');
  // save the budget as a template: it shows in the spreadsheet menu only, and can be deleted in Manage templates
  await api(page, 'POST', '/api/templates', { noteId: sheetId, name: 'Household budget' });
  await page.goto('/#/documents'); await page.reload(); await page.waitForSelector('[data-action=new-note]');
  await expect(await menu('sheet')).toContainText(['Household budget']); await page.keyboard.press('Escape');
  await expect(await menu('note')).not.toContainText(['Household budget']);
  await page.click('.menu-item >> text=Manage templates…'); await expect(page.locator('.tpl-row')).toHaveCount(1); await expect(page.locator('.tpl-row')).toContainText('Spreadsheet');
  await page.click('.tpl-row [data-del]'); await expect(page.locator('.tpl-row')).toHaveCount(0);
});

test('Files: renamed everywhere, old addresses redirect, and a folder or tag shows its files first', async ({ page }) => {
  await signUp(page);
  await expect(page.locator('nav.nav')).toContainText('Files'); await expect(page.locator('h1').first()).toHaveText('Files');
  const folder = await api(page, 'POST', '/api/folders', { name: 'Clients' });
  const note = await api(page, 'POST', '/api/notes', { title: 'Acme contract', content: 'x', tag: 'Legal' });
  await api(page, 'PUT', `/api/notes/${note.id}/folder`, { folderId: folder.id });
  await page.goto(`/#/documents/${note.id}`); await page.reload(); // an old link
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/files/${note.id}`);
  await page.goto('/#/files'); await page.reload(); await page.waitForSelector('[data-action=new-note]');
  await page.click('.folder-card:has-text("Clients")');
  await expect(page.locator('.filter-title')).toHaveText('Clients'); await expect(page.locator('.filter-count')).toHaveText('1 file');
  await expect(page.locator('.hero')).toHaveCount(0); await expect(page.locator('.quick-actions')).toHaveCount(0);
  await expect(page.locator('.doc-row', { hasText: 'Acme contract' })).toBeVisible();
  await page.click('[data-action=filter-back]'); await expect(page.locator('.quick-actions')).toHaveCount(1); await expect(page.locator('.filter-head')).toHaveCount(0);
  await page.click('.tag-filter [data-tag="Legal"]'); await expect(page.locator('.filter-title')).toHaveText('Legal'); await expect(page.locator('.hero')).toHaveCount(0);
  await page.click('[data-action=filter-back]'); await expect(page.locator('.hero')).toHaveCount(1);
});

test('document templates use the editor’s features', async ({ page }) => {
  await signUp(page); await page.click('[data-action=template-menu][data-kind=note]');
  await expect(page.locator('.menu .menu-item .menu-label')).toHaveText(['Project plan', 'Meeting notes', 'Research report', 'Weekly planner', 'Approval form', 'Manage templates…']);
  await page.keyboard.press('Escape');
  for (const name of ['Meeting notes', 'Research report', 'Weekly planner', 'Approval form']) { // every template creates its document
    await page.goto('/#/files'); await page.click('[data-action=template-menu][data-kind=note]'); await page.click(`.menu-item >> text=${name}`);
    await page.waitForSelector('.ProseMirror'); await expect(page.locator('.toast.error, .toast[data-tone=error]')).toHaveCount(0);
  }
  await page.goto('/#/files'); await page.click('[data-action=template-menu][data-kind=note]');
  await page.click('.menu-item >> text=Project plan'); await page.waitForSelector('.ProseMirror');
  for (const sel of ['.toc-title', '.dd-chip', 'table', '.chart-svg', 'ul[data-type="taskList"]', 'mark']) await expect(page.locator(`.ProseMirror :is(${sel})`).first()).toBeVisible();
});
