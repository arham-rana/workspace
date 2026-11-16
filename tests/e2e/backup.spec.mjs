// "Download everything" and restoring it (with files) into another account; the health check.
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { signUp, api, enc } from './helpers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('health check reports the database and storage', async ({ request }) => {
  const r = await request.get('/api/health'); expect(r.ok()).toBe(true);
  expect((await r.json()).checks).toEqual({ database: 'ok', storage: 'ok' });
});

test('Download everything, then restore it, files and all, in another account', async ({ browser }) => {
  const A = await (await browser.newContext()).newPage(); await signUp(A, 'Alex');
  const plansNote = await api(A, 'POST', '/api/notes', { title: 'Plans', content: '' });
  const file = await A.evaluate(async ([b64, noteId]) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const r = await fetch('/api/files', { method: 'POST', headers: { 'X-Requested-With': 'workspace', 'X-File-Name': 'logo.png', 'X-File-Type': 'image/png', 'X-Note-Id': noteId }, body: bytes }); return r.json(); }, [PNG.toString('base64'), plansNote.id]); // attached to the document, as the editor does
  const sheet = { sheets: [{ name: 'Q1', cells: { A1: { v: 'Item' }, B1: { v: 'Cost' }, A2: { v: 'Rent' }, B2: { v: '=1000+500' } } }] };
  await api(A, 'PUT', `/api/notes/${plansNote.id}`, { content: `Our logo: ![logo](${file.url})\n\n[[sheet:${enc(sheet)}]]` });
  const work = await api(A, 'POST', '/api/folders', { name: 'Work' }); await api(A, 'PUT', `/api/notes/${plansNote.id}/folder`, { folderId: work.id });
  await api(A, 'POST', '/api/notes', { title: 'Pitch', kind: 'slides', content: `[[slides:${enc({ slides: [{ items: [{ t: 'text', x: 60, y: 40, w: 800, h: 80, html: 'Team update' }, { t: 'image', src: file.url, x: 100, y: 200, w: 200, h: 150 }] }] })}]]` });
  await api(A, 'POST', '/api/notes', { title: 'Budget', kind: 'sheet', content: `[[sheet:${enc(sheet)}]]` });
  // download everything
  const res = await A.request.get('/api/export?format=zip'); expect(res.ok()).toBe(true);
  const zip = await JSZip.loadAsync(await res.body()); const names = Object.keys(zip.files);
  expect(names).toEqual(expect.arrayContaining(['backup.json', `files/${file.id}`, 'documents/Work/Plans.md', 'documents/Pitch.pptx', 'documents/Budget.xlsx', 'README.txt']));
  const md = await zip.file('documents/Work/Plans.md').async('string'); expect(md).toMatch(/\| Rent \| 1500 \|/);
  expect(Buffer.compare(await zip.file(`files/${file.id}`).async('nodebuffer'), PNG)).toBe(0);
  const zipPath = path.join(os.tmpdir(), `everything-${Date.now()}.zip`); fs.writeFileSync(zipPath, await res.body());
  // restore it as someone else, through Settings
  const B = await (await browser.newContext()).newPage(); await signUp(B, 'Blake');
  await B.goto('/#/settings'); await B.setInputFiles('#restore-file', zipPath); await B.click('.modal-foot .btn-danger, .modal-foot .btn-primary');
  await expect(B.locator('.toast').last()).toContainText('and 1 file');
  const notes = await api(B, 'GET', '/api/notes'); expect(notes.map((n) => n.title).sort()).toEqual(['Budget', 'Pitch', 'Plans']);
  const plans = notes.find((n) => n.title === 'Plans'); const url = /\/api\/files\/[0-9a-f-]{36}/.exec(plans.content)[0];
  expect(url).not.toBe(file.url); // a new copy of the file, owned by Blake
  expect((await B.request.get(url)).status()).toBe(200);
  const pitch = notes.find((n) => n.title === 'Pitch'); const deck = JSON.parse(Buffer.from(/\[\[slides:([A-Za-z0-9_-]+)/.exec(pitch.content)[1], 'base64url').toString());
  expect(deck.slides[0].items.find((x) => x.t === 'image').src).toBe(url); // inside the presentation too
  const exported = await api(B, 'GET', '/api/export'); const bWork = exported.folders.find((f) => f.name === 'Work');
  expect(bWork && bWork.id).not.toBe(work.id); // Blake's own folder, not Alex's
  expect(exported.noteFolders).toContainEqual({ noteId: plans.id, folderId: bWork.id }); // and the document is still in it
  const files = await api(B, 'GET', '/api/files'); expect(files.files[0].noteTitle).toBe('Plans'); // re-attached to its document
});

test('backups made before the rename still restore; sheets protected before it still unlock', async ({ page }) => {
  await signUp(page);
  const oldName = ['still', 'point'].join('') + '-backup.json';
  const zip = new JSZip(); zip.file(oldName, JSON.stringify({ version: 3, notes: [{ title: 'From an older backup', content: 'hello' }], reminders: [], events: [] }));
  const res = await page.request.post('/api/import', { headers: { 'X-Requested-With': 'workspace', 'Content-Type': 'application/zip' }, data: await zip.generateAsync({ type: 'nodebuffer' }) });
  expect(res.ok()).toBe(true);
  expect((await api(page, 'GET', '/api/notes')).some((n) => n.title === 'From an older backup')).toBe(true);
  // a sheet whose password was set by the earlier version
  const crypto = await import('node:crypto'); const oldPw = crypto.createHash('sha256').update(`${['still', 'point'].join('')}:secret`).digest('hex');
  const id = (await api(page, 'POST', '/api/notes', { title: 'Locked', kind: 'sheet', content: `[[sheet:${enc({ sheets: [{ name: 'S', cells: { A1: { v: 'x' } }, protect: { on: true, pw: oldPw, allow: {} } }] })}]]` })).id;
  await page.goto('/#/files'); await page.reload(); await page.waitForSelector('[data-action=new-note]'); await page.goto(`/#/files/${id}`); await page.waitForSelector('.xl-wrap');
  await page.click('.rb-tab[data-rbtab="Data"]'); await page.click('.rb-pop [data-cmd="protect"]');
  await page.fill('[name=pw]', 'secret'); await page.click('.modal-foot .btn-primary');
  await expect(page.locator('.modal')).toHaveCount(0); // unlocked with the old password
  await page.click('.xl-name'); await page.fill('.xl-name', 'A1'); await page.keyboard.press('Enter'); await page.keyboard.type('now editable'); await page.keyboard.press('Enter');
  await page.click('.xl-name'); await page.fill('.xl-name', 'A1'); await page.keyboard.press('Enter'); expect(await page.inputValue('.xl-formula')).toBe('now editable');
});
