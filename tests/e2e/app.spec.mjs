// Documents and the rest of the app.
import { test, expect } from '@playwright/test';
import { signUp, watchErrors, api, currentId } from './helpers.mjs';

test('documents: formatting, inserted blocks, page view, print, Word, history', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page);
  await page.click('[data-action=new-note]'); await page.waitForSelector('.ProseMirror');
  await page.fill('#doc-bar .bar-title', 'Regression doc'); await page.keyboard.press('Enter');
  await page.click('.ProseMirror'); const k = page.keyboard;
  await k.type('Heading line'); await k.press('Enter'); await k.type('Some bold words and more text here.');
  await page.click('.ProseMirror p >> nth=0'); await page.click('[data-cmd=style]'); await page.click('.pick-pop [data-pick=h2]');
  await expect(page.locator('.ProseMirror h2')).toHaveCount(1);
  await page.evaluate(() => { const root = document.querySelector('.ProseMirror'); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.nodeValue.indexOf('bold words'); if (i >= 0) { root.focus(); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 10); getSelection().removeAllRanges(); getSelection().addRange(r); return; } } });
  await page.waitForTimeout(200); // the editor picks up a scripted selection on its next tick
  await k.press('Control+b'); await expect(page.locator('.ProseMirror strong')).toHaveCount(1);
  await k.press('Control+End'); await expect.poll(() => page.evaluate(() => getSelection().isCollapsed)).toBe(true); await k.press('Enter'); // end of the document, nothing selected (an insert replaces a selection)
  await page.click('[data-cmd=insert]'); await page.click('.pick-pop [data-pick=chart]'); await page.click('.modal-foot [data-save]');
  await expect(page.locator('.ProseMirror .chart-svg')).toHaveCount(1);
  await page.click('[data-action=done-editing]');
  // page view
  await page.click('.doc-actions [data-action=note-menu]'); await page.click('.menu-item >> text=Page setup'); await page.click('.page-opt:has([value=pages])'); await page.click('.modal-foot button[type=submit]');
  await expect(page.locator('#doc-sheet .paged').first()).toBeVisible();
  // print builds the pages with the text
  await page.evaluate(() => { window.print = () => { window.__printed = document.getElementById('print-root')?.textContent || ''; }; });
  await page.click('.doc-actions [data-action=note-menu]'); await page.click('.menu-item >> text=Print');
  await expect.poll(() => page.evaluate(() => window.__printed || '')).toContain('Some bold words');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  // Word
  await page.click('.doc-actions [data-action=note-menu]'); const dl = page.waitForEvent('download');
  await page.click('.menu-item >> text=Download'); await page.click('.menu-item >> text=Word');
  expect((await dl).suggestedFilename()).toMatch(/\.docx$/);
  // version history
  await page.click('[data-action=doc-history]'); await expect(page.locator('.modal')).toBeVisible(); await page.locator('.modal [data-close]').first().click();
  errs.check();
});

test('folders, Deleted and restore, reminders, calendar, settings', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page);
  const folder = await api(page, 'POST', '/api/folders', { name: 'Work' });
  const note = await api(page, 'POST', '/api/notes', { title: 'Temp', content: 'x' });
  await api(page, 'PUT', `/api/notes/${note.id}/folder`, { folderId: folder.id });
  await api(page, 'DELETE', `/api/notes/${note.id}`);
  expect((await api(page, 'GET', '/api/trash')).some((n) => n.title === 'Temp')).toBe(true);
  await api(page, 'POST', `/api/trash/${note.id}/restore`);
  expect((await api(page, 'GET', '/api/notes')).some((n) => n.title === 'Temp')).toBe(true);
  await api(page, 'POST', '/api/reminders', { title: 'Call the dentist', dueAt: new Date(Date.now() + 3600000).toISOString().slice(0, 16), category: 'task' });
  await api(page, 'POST', '/api/events', { title: 'Team lunch', date: new Date().toISOString().slice(0, 10), start: '12:00', end: '13:00', color: 'green' });
  await page.goto('/#/documents'); await page.reload();
  await expect(page.locator('.folder-card', { hasText: 'Work' })).toHaveCount(1);
  await page.click('[data-action=open-trash]'); await expect(page.locator('.modal h2')).toHaveText('Deleted files'); await page.locator('.modal [data-close]').first().click();
  await page.goto('/#/reminders'); await expect(page.locator('.reminder-row', { hasText: 'Call the dentist' })).toHaveCount(1);
  await page.goto('/#/calendar'); await expect(page.locator('text=Team lunch').first()).toBeVisible();
  await page.goto('/#/settings'); await page.click('.segmented label:has-text("Dark")');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.click('.segmented label:has-text("Device")');
  errs.check();
});

test('signature requests notify the signer', async ({ browser }) => {
  const A = await (await browser.newContext()).newPage(); const S = await (await browser.newContext()).newPage();
  await signUp(A, 'Alex'); const sam = await signUp(S, 'Sam Lee');
  await A.click('[data-action=new-note]'); await A.waitForSelector('.ProseMirror'); await A.click('.ProseMirror'); await A.keyboard.type('Please sign');
  const id = await currentId(A);
  await api(A, 'POST', `/api/notes/${id}/shares`, { username: sam, permission: 'view' }); // signers must be able to open the document
  const sig = await api(A, 'POST', `/api/notes/${id}/signatures`, { signer: sam, label: 'Approved' });
  expect(sig.id).toBeTruthy();
  await expect.poll(() => S.evaluate(() => fetch('/api/bootstrap').then((r) => r.json()).then((b) => b.notifications.some((n) => n.kind === 'signature')))).toBe(true);
});

test('Word export right after typing includes what was just typed (no waiting for the batched save)', async ({ page }) => {
  await signUp(page); await page.click('[data-action=new-note]'); await page.waitForSelector('.ProseMirror');
  await page.click('.ProseMirror'); await page.keyboard.type('Fresh words 4711'); const id = await currentId(page);
  await expect.poll(async () => { const r = await page.request.get(`/api/notes/${id}/export.docx`); const zip = await (await import('jszip')).default.loadAsync(await r.body()); return (await zip.file('word/document.xml').async('string')).includes('Fresh words 4711'); }, { timeout: 4000, intervals: [300] }).toBe(true);
});
