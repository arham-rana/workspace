// Version history shows what changed: words and paragraphs, cells, slides and objects.
import { test, expect } from '@playwright/test';
import { signUp, api, enc, createNote, openNote } from './helpers.mjs';

const openHistory = async (page, id) => { await openNote(page, id); await page.waitForSelector('#doc-sheet'); await page.click('[data-action=doc-history]'); await page.waitForSelector('.vh-item'); };

test('documents: edited words, added paragraphs; the first version; changes can be hidden', async ({ page }) => {
  await signUp(page);
  const id = await createNote(page, { title: 'Plan', content: 'Keep this.\n\nThe old launch date is March.' });
  await api(page, 'PUT', `/api/notes/${id}`, { content: 'Keep this.\n\nThe new launch date is April.\n\nA brand new paragraph.' }); // captures the original as a version
  await openHistory(page, id);
  await expect(page.locator('.vh-sum')).toHaveText('1 paragraph edited, 1 added');
  await expect(page.locator('.vh-diff ins')).toHaveText(['new', 'April.']); await expect(page.locator('.vh-diff del')).toHaveText(['old', 'March.']);
  await expect(page.locator('.vh-add-block')).toContainText('A brand new paragraph.');
  await page.click('[data-vh-changes]'); await expect(page.locator('.vh-diff')).toHaveCount(0); await expect(page.locator('.vh-doc')).toContainText('The new launch date is April.');
  await page.click('[data-vh-changes]'); await page.locator('.vh-item').nth(1).click(); await expect(page.locator('.vh-first')).toHaveText('The first saved version');
});

test('spreadsheets: a table of changed cells', async ({ page }) => {
  await signUp(page);
  const wb = (cells) => `[[sheet:${enc({ sheets: [{ id: 's1', name: 'Q1', cells }] })}]]`;
  const id = await createNote(page, { title: 'Budget', kind: 'sheet', content: wb({ A1: { v: 'Rent' }, B1: { v: '1500' }, C1: { v: '=B1*12' }, D1: { v: 'drop me' } }) });
  await api(page, 'PUT', `/api/notes/${id}`, { content: wb({ A1: { v: 'Rent' }, B1: { v: '2000' }, C1: { v: '=B1*13' } }) });
  await openHistory(page, id);
  await expect(page.locator('.vh-sum')).toHaveText('3 cells changed');
  const rows = await page.locator('.vh-table tbody tr').allInnerTexts();
  expect(rows.map((r) => r.replace(/\s+/g, ' ').trim())).toEqual(['B1 1500 2000', 'C1 =B1*12 =B1*13', 'D1 drop me cleared']);
});

test('presentations: slides changed and added, with before and after', async ({ page }) => {
  await signUp(page);
  const deck = (slides) => `[[slides:${enc({ slides })}]]`;
  const id = await createNote(page, { title: 'Deck', kind: 'slides', content: deck([{ id: 'a', items: [{ id: 't', t: 'text', x: 60, y: 60, w: 600, h: 80, html: 'Quarterly results' }] }]) });
  await api(page, 'PUT', `/api/notes/${id}`, { content: deck([{ id: 'a', items: [{ id: 't', t: 'text', x: 60, y: 60, w: 600, h: 80, html: 'Quarterly results 2026' }] }, { id: 'b', items: [{ id: 'u', t: 'text', x: 60, y: 60, w: 600, h: 80, html: 'Next steps' }] }]) });
  await openHistory(page, id);
  await expect(page.locator('.vh-sum')).toHaveText('1 slide changed, 1 slide added');
  await expect(page.locator('.vh-block').first().locator('.vh-changes')).toContainText('Text box edited'); await expect(page.locator('.vh-block').first().locator('ins')).toHaveText(' 2026');
  await expect(page.locator('.vh-block').first().locator('.vh-thumb')).toHaveCount(2);
});
