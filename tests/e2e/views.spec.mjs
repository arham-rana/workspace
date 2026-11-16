// Files views: Recent (files you opened, on every device) and Shared with me (with who shared them).
import { test, expect } from '@playwright/test';
import { signUp, api, createNote } from './helpers.mjs';

test('Shared with me and Recent', async ({ browser }) => {
  const A = await (await browser.newContext()).newPage(); const B = await (await browser.newContext()).newPage();
  await signUp(A, 'Alex'); const blake = await signUp(B, 'Blake');
  const shared = await createNote(A, { title: 'Shared plan', content: 'From Alex' });
  await api(A, 'POST', `/api/notes/${shared}/shares`, { username: blake, permission: 'view' });
  const own = await createNote(B, { title: 'My notes', content: 'Mine' }); await createNote(B, { title: 'Never opened', content: 'x' });
  await B.goto('/#/files'); await B.reload(); await B.waitForSelector('.view-chips');
  await B.click('[data-action=set-view][data-view=shared]');
  await expect(B.locator('.filter-title')).toHaveText('Shared with me'); await expect(B.locator('.filter-count')).toHaveText('1 file'); await expect(B.locator('.hero')).toHaveCount(0);
  await expect(B.locator('.doc-row')).toHaveCount(1); await expect(B.locator('.doc-row')).toContainText('Shared by Alex');
  // open two files: they appear in Recent, newest first
  await B.goto(`/#/files/${own}`); await B.waitForSelector('#doc-sheet');
  await B.waitForTimeout(1100); await B.goto(`/#/files/${shared}`); await B.waitForSelector('#doc-sheet');
  await expect.poll(async () => (await api(B, 'GET', '/api/notes')).filter((n) => n.openedAt).length).toBe(2); // kept on the server (every device)
  await B.goto('/#/files'); await B.reload(); await B.waitForSelector('.view-chips'); await B.click('[data-action=set-view][data-view=recent]');
  await expect(B.locator('.filter-title')).toHaveText('Recent');
  await expect(B.locator('.doc-row')).toHaveCount(2); await expect(B.locator('.doc-row').nth(0)).toContainText('Shared plan'); await expect(B.locator('.doc-row').nth(1)).toContainText('My notes'); // newest first await expect(B.locator('.doc-row').first()).toContainText('Opened');
  await B.click('[data-action=filter-back]'); await expect(B.locator('.quick-actions')).toHaveCount(1); await expect(B.locator('.doc-row')).toHaveCount(3);
});
