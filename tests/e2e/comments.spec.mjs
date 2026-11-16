// Comments on spreadsheet cells and slide objects (the same threads, replies and notifications as documents).
import { test, expect } from '@playwright/test';
import { signUp, api, createNote, openNote, grid } from './helpers.mjs';

test('spreadsheets: comment on a cell; marker; a collaborator jumps to it from another sheet', async ({ browser }) => {
  const A = await (await browser.newContext()).newPage(); const B = await (await browser.newContext()).newPage();
  await signUp(A, 'Alex'); const blake = await signUp(B, 'Blake');
  const id = await createNote(A, { title: 'Budget', kind: 'sheet', block: 'sheet', data: { sheets: [{ id: 's1', name: 'Summary', cells: { A1: { v: 'x' } } }, { id: 's2', name: 'Detail', cells: { B2: { v: '42' } } }] } });
  await api(A, 'POST', `/api/notes/${id}/shares`, { username: blake, permission: 'edit' });
  await openNote(A, id); await A.waitForSelector('.xl-wrap'); await A.locator('.sheet-tab', { hasText: 'Detail' }).click();
  await grid(A).go('B2'); const cell = A.locator('.xl-q .xc', { hasText: /^42$/ }); await cell.click({ button: 'right' }); await A.click('.menu-item >> text=Comment');
  await expect(A.locator('.comments-panel .cp-anchor').first()).toHaveText('Detail!B2');
  await A.fill('#cp-new-text', 'Is this figure final?'); await A.click('.cp-new button[type=submit]');
  await expect(A.locator('.cp-thread .cp-anchor')).toHaveText('Detail!B2'); await expect(A.locator('.xl-q .xcm')).toHaveCount(1);
  await A.reload(); await A.waitForSelector('.xl-wrap'); await A.locator('.sheet-tab', { hasText: 'Detail' }).click(); await expect(A.locator('.xl-q .xcm')).toHaveCount(1); // kept
  await expect.poll(async () => (await api(A, 'GET', '/api/bootstrap')).notifications.length).toBe(0); // own comment: no notification
  // Blake: opens the sheet on its first tab, then jumps to the comment
  await openNote(B, id); await B.waitForSelector('.xl-wrap'); await B.click('.cmt-btn'); await B.locator('.cp-thread .cp-anchor').click();
  await expect(B.locator('.sheet-tab.on')).toHaveText('Detail'); await expect(B.locator('.xl-name')).toHaveValue('B2');
  await B.fill('.cp-thread textarea', 'Yes, final.'); await B.click('.cp-reply-form button[type=submit]');
  await expect.poll(async () => (await api(A, 'GET', '/api/bootstrap')).notifications.some((n) => n.noteId === id)).toBe(true); // Alex hears about the reply
  // malformed anchors are ignored
  const list = await api(A, 'POST', `/api/notes/${id}/comments`, { body: 'malformed anchor', anchor: { type: 'cell', sheet: 's2', cell: 'B2;DROP TABLE' } }); // returns the updated list
  const made = list.find((x) => x.body === 'malformed anchor'); expect(made).toBeTruthy(); expect(made.anchor).toBeNull();
});

test('presentations: comment on an object; badge and thumbnail mark; go back to it', async ({ page }) => {
  await signUp(page);
  const id = await createNote(page, { title: 'Deck', kind: 'slides', block: 'slides', data: { slides: [{ id: 'a', items: [{ id: 'title', t: 'text', x: 60, y: 60, w: 600, h: 80, html: 'Results' }] }, { id: 'b', items: [{ id: 't2', t: 'text', x: 60, y: 60, w: 600, h: 80, html: 'Next' }] }] } });
  await openNote(page, id); await expect(page.locator('.gs-film .deck-thumb')).toHaveCount(2);
  await page.locator('.gs-canvas .sl-item[data-id="title"]').click(); await page.locator('.gs-canvas').focus(); await page.keyboard.press('Control+Alt+KeyM');
  await expect(page.locator('.comments-panel .cp-anchor').first()).toHaveText('Slide 1 · Results');
  await page.fill('#cp-new-text', 'Add last year for comparison'); await page.click('.cp-new button[type=submit]');
  await expect(page.locator('.gs-canvas .gs-cmt')).toHaveCount(1); await expect(page.locator('.gs-film .deck-thumb').first().locator('.thumb-cmt')).toHaveCount(1);
  await page.locator('.gs-film .deck-thumb').nth(1).click(); await expect(page.locator('.gs-canvas .gs-cmt')).toHaveCount(0);
  await page.locator('.cp-thread .cp-anchor').click(); // back to the object
  await expect(page.locator('.gs-film .deck-thumb').first()).toHaveClass(/\bon\b/); await expect(page.locator('.gs-sel')).toHaveCount(1);
  await page.click('.cmt-btn'); await expect(page.locator('.comments-panel .cp-thread')).toBeHidden(); // panel closed
  await page.locator('.gs-canvas .gs-cmt').click(); await expect(page.locator('.cp-thread.active')).toBeVisible(); // the badge opens its thread
});
