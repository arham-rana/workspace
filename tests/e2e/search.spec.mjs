// Search finds text inside spreadsheets, presentations and blocks in documents, says where, and opens it there.
import { test, expect } from '@playwright/test';
import { signUp, createNote, enc } from './helpers.mjs';

test('search inside spreadsheets and presentations; results open at the cell or slide', async ({ page }) => {
  await signUp(page);
  await createNote(page, { title: 'Budget', kind: 'sheet', block: 'sheet', data: { sheets: [{ id: 's1', name: 'Summary', cells: { A1: { v: 'Total' } } }, { id: 's2', name: 'Detail', cells: { C7: { v: 'Blue widgets' } } }] } });
  await createNote(page, { title: 'Deck', kind: 'slides', block: 'slides', data: { slides: [{ id: 'a', items: [{ id: 't1', t: 'text', x: 60, y: 60, w: 600, h: 80, html: 'Welcome' }] }, { id: 'b', items: [{ id: 't2', t: 'text', x: 60, y: 60, w: 600, h: 80, html: 'Quarterly results' }] }] } });
  await createNote(page, { title: 'Report', content: `Intro.\n\n[[sheet:${enc({ sheets: [{ id: 'x', name: 'Data', cells: { B2: { v: 'Gizmos' } } }] })}]]` });
  await page.goto('/#/files'); await page.reload(); await page.waitForSelector('[data-action=new-note]');
  // a value on the second sheet
  await page.fill('#global-search', 'widgets'); const r1 = page.locator('#search-results .sr-item', { hasText: 'Budget' });
  await expect(r1).toContainText('Detail!C7 · Blue widgets'); await expect(page.locator('#search-results')).not.toContainText('[[sheet:');
  await r1.click(); await page.waitForSelector('.xl-wrap');
  await expect(page.locator('.sheet-tab.on')).toHaveText('Detail'); await expect(page.locator('.xl-name')).toHaveValue('C7');
  // slide text
  await page.goto('/#/files'); await page.waitForSelector('#global-search'); // the main search is on the pages with the top bar
  await page.fill('#global-search', 'quarterly'); const r2 = page.locator('#search-results .sr-item', { hasText: 'Deck' });
  await expect(r2).toContainText('Slide 2 · Quarterly results'); await r2.click();
  await expect(page.locator('.gs-film .deck-thumb').nth(1)).toHaveClass(/\bon\b/); await expect(page.locator('.gs-sel')).toHaveCount(1);
  // a spreadsheet inside a document, from the Files search box
  await page.goto('/#/files'); await page.fill('#docs-search', 'gizmos');
  await expect(page.locator('.doc-row')).toHaveCount(1); await expect(page.locator('.doc-row')).toContainText('Report');
});
