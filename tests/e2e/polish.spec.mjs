// Polish: linked files can become copies; template previews; recently opened files first in the picker.
import { test, expect } from '@playwright/test';
import { signUp, api, enc, createNote, openNote, untilSaved, saved } from './helpers.mjs';

test('Make a copy here: a linked file becomes an editable copy (documents and slides)', async ({ page }) => {
  await signUp(page);
  const sheet = await createNote(page, { title: 'Budget', kind: 'sheet', block: 'sheet', data: { sheets: [{ name: 'Q1', cells: { A1: { v: 'Rent' }, B1: { v: '1500' } } }] } });
  const notesDoc = await createNote(page, { title: 'Meeting notes', content: 'Ship the release on Friday.' });
  const doc = await createNote(page, { title: 'Report', content: `See:\n\n[[file:${enc({ id: sheet, kind: 'sheet', title: 'Budget' })}]]` });
  await openNote(page, doc); await page.click('[data-action=edit-note]'); await page.waitForSelector('.ProseMirror .file-embed .fe-copy');
  await page.click('.ProseMirror .file-embed .fe-copy');
  await expect(page.locator('.ProseMirror .xl-wrap')).toBeVisible(); await expect(page.locator('.ProseMirror .file-embed')).toHaveCount(0);
  await expect.poll(async () => (await api(page, 'GET', `/api/notes/${doc}`)).content).toMatch(/\[\[sheet:/);
  expect((await api(page, 'GET', `/api/notes/${doc}`)).content).not.toContain('[[file:');
  // on a slide
  const deck = await createNote(page, { title: 'Deck', kind: 'slides', block: 'slides', data: { slides: [{ id: 'a', items: [{ id: 'card', t: 'file', ref: { id: notesDoc, kind: 'note', title: 'Meeting notes' }, x: 100, y: 100, w: 500, h: 300 }] }] } });
  await openNote(page, deck); await page.waitForSelector('.gs-canvas .sl-file .fe-doc');
  await page.locator('.gs-canvas .sl-item[data-id="card"]').click(); await page.locator('.gs-canvas .sl-item[data-id="card"]').click({ button: 'right' });
  await page.click('.menu-item >> text=Make a copy here');
  const d = await untilSaved(page, deck, 'slides', (x) => x.slides[0].items[0].t === 'text', 'the card became text');
  expect(d.slides[0].items[0].html).toContain('Ship the release on Friday.'); expect([d.slides[0].items[0].x, d.slides[0].items[0].y]).toEqual([100, 100]);
});

test('template previews; recently opened files first in the picker', async ({ page }) => {
  await signUp(page);
  await page.click('[data-action=template-menu][data-kind=sheet]'); await page.locator('.menu-item', { hasText: 'Monthly budget' }).hover();
  await expect(page.locator('.tpl-preview')).toBeVisible(); await expect(page.locator('.tpl-preview')).toContainText('4,500.00');
  await expect(page.locator('.menu-item', { hasText: 'Invoice' }).locator('.menu-desc')).toHaveText('Line items, subtotal, tax and total.');
  await page.keyboard.press('Escape'); await expect(page.locator('.tpl-preview')).toHaveCount(0); // closes with the menu
  const older = await createNote(page, { title: 'Opened first', content: 'x' }); const newer = await createNote(page, { title: 'Opened last', content: 'y' });
  await api(page, 'POST', `/api/notes/${older}/opened`); await page.waitForTimeout(1100); await api(page, 'POST', `/api/notes/${newer}/opened`);
  const host = await createNote(page, { title: 'Host', content: '' });
  await openNote(page, host); await page.click('[data-action=edit-note]'); await page.waitForSelector('.ProseMirror'); await page.click('.ProseMirror');
  await page.click('[data-cmd=insert]'); await page.click('.pick-pop [data-pick=fileLink]');
  await expect(page.locator('.fp-item').first()).toContainText('Opened last'); await expect(page.locator('.fp-item').nth(1)).toContainText('Opened first');
});
