// Uploading files into Files: kept as they are and previewed; Office files can be opened as editable copies.
import { test, expect } from '@playwright/test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell } from 'docx';
import { signUp, api, currentId } from './helpers.mjs';
import { exportSheet } from '../../src/sheets.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const tmp = (name, data) => { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'up-')), name); fs.writeFileSync(p, data); return p; }; // its real name
async function wordFile() {
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: 'Quarterly report', heading: HeadingLevel.HEADING_1 }), new Paragraph({ children: [new TextRun('Revenue grew '), new TextRun({ text: '12%', bold: true })] }), new Paragraph({ text: 'First point', bullet: { level: 0 } }),
    new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Region')] }), new TableCell({ children: [new Paragraph('Sales')] })] }), new TableRow({ children: [new TableCell({ children: [new Paragraph('North')] }), new TableCell({ children: [new Paragraph('120')] })] })] })] }] });
  return Packer.toBuffer(doc);
}
const upload = async (page, files) => { await page.goto('/#/files'); await page.waitForSelector('[data-action=upload-files]'); await page.setInputFiles('#upload-input', files); await expect(page.locator('.toast').last()).toContainText(/Uploaded \d+ file/); };

test('upload pictures, PDFs and text: kept as they are and previewed', async ({ page }) => {
  await signUp(page);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  await upload(page, [tmp('photo.png', PNG), tmp('guide.pdf', pdf), tmp('notes.txt', 'Plain <b>text</b> file')]);
  for (const name of ['photo.png', 'guide.pdf', 'notes.txt']) await expect(page.locator('.doc-row', { hasText: name })).toHaveCount(1);
  await page.dblclick('.doc-row:has-text("photo.png")'); await expect(page.locator('#doc-sheet .up-image')).toBeVisible(); await expect(page.locator('[data-action=edit-note]')).toHaveCount(0);
  await page.goto('/#/files'); await page.dblclick('.doc-row:has-text("guide.pdf")'); await expect(page.locator('#doc-sheet .up-pdf')).toBeVisible();
  const pdfUrl = await page.locator('#doc-sheet .up-pdf').getAttribute('src'); const r = await page.request.get(pdfUrl); expect(r.headers()['content-type']).toBe('application/pdf'); expect(r.headers()['content-disposition']).toMatch(/^inline/);
  await page.goto('/#/files'); await page.dblclick('.doc-row:has-text("notes.txt")'); await expect(page.locator('#doc-sheet .up-text')).toHaveText('Plain <b>text</b> file'); // shown as text, never as a page
  await expect(page.locator('.up-actions a[download]')).toHaveCount(1);
});

test('Word and Excel uploads open as editable copies; the original stays', async ({ page }) => {
  await signUp(page);
  await upload(page, [tmp('report.docx', await wordFile()), tmp('budget.xlsx', await exportSheet({ sheets: [{ name: 'Q1', cells: { A1: { v: 'Rent' }, B1: { v: '1500' } } }] }, 'xlsx'))]);
  await page.dblclick('.doc-row:has-text("report.docx")'); await page.waitForSelector('#doc-sheet .up-view'); const original = await currentId(page);
  await page.click('#doc-sheet [data-action=convert-upload]');
  await expect.poll(() => currentId(page)).not.toBe(original); // the editable copy opens
  const docId = await currentId(page); const doc = await api(page, 'GET', `/api/notes/${docId}`);
  expect(doc.title).toBe('report'); expect(doc.kind).toBe('note'); expect(doc.content).toMatch(/^# Quarterly report/m); expect(doc.content).toContain('**12%**'); expect(doc.content).toContain('| Region | Sales |');
  await page.goto('/#/files'); await page.dblclick('.doc-row:has-text("budget.xlsx")'); await page.click('#doc-sheet [data-action=convert-upload]');
  await page.waitForSelector('.xl-wrap'); await expect(page.locator('.xl-q .xc', { hasText: /^1500$/ })).toHaveCount(1);
  const all = await api(page, 'GET', '/api/notes'); expect(all.filter((n) => n.kind === 'upload').map((n) => n.title).sort()).toEqual(['budget.xlsx', 'report.docx']); // originals kept
});

test('convert automatically (setting); drag and drop; private unless shared', async ({ browser }) => {
  const A = await (await browser.newContext()).newPage(); const B = await (await browser.newContext()).newPage();
  await signUp(A, 'Alex'); const blake = await signUp(B, 'Blake');
  await A.goto('/#/settings'); await A.check('[name=convertUploads]'); await expect.poll(async () => (await api(A, 'GET', '/api/bootstrap')).settings.convertUploads).toBe(true);
  await upload(A, [tmp('minutes.docx', await wordFile())]);
  await expect.poll(async () => (await api(A, 'GET', '/api/notes')).map((n) => `${n.kind}:${n.title}`)).toContain('note:minutes');
  expect((await api(A, 'GET', '/api/trash')).some((n) => n.title === 'minutes.docx')).toBe(true); // the original, restorable
  await A.goto('/#/settings'); await A.uncheck('[name=convertUploads]');
  // drag and drop onto the Files page
  await A.goto('/#/files'); await A.waitForSelector('[data-action=upload-files]');
  await A.evaluate(async (b64) => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' })); for (const t of ['dragenter', 'dragover', 'drop']) document.querySelector('#doc-list').dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })); }, PNG.toString('base64'));
  await expect(A.locator('.doc-row', { hasText: 'dropped.png' })).toHaveCount(1);
  const up = (await api(A, 'GET', '/api/notes')).find((n) => n.title === 'dropped.png'); const src = /\/api\/files\/[0-9a-f-]{36}/.exec(Buffer.from(/\[\[upload:([A-Za-z0-9_-]+)/.exec(up.content)[1], 'base64url').toString())[0];
  expect((await B.request.get(src)).status()).toBe(404); // not shared: nothing
  await api(A, 'POST', `/api/notes/${up.id}/shares`, { username: blake, permission: 'view' });
  expect((await B.request.get(src)).status()).toBe(200); // shared: they can open it
});

test('single choices are filled with no mark; checkboxes keep their tick', async ({ page }) => {
  await signUp(page); await page.goto('/#/settings'); await page.waitForSelector('.setting-group');
  const radio = await page.locator('.segmented input:checked + span').first().evaluate((el) => getComputedStyle(el, '::before').backgroundImage);
  const box = await page.locator('[name=convertUploads]').evaluate((el) => { el.checked = true; return getComputedStyle(el).backgroundImage; });
  expect(radio).toBe('none'); expect(box).toMatch(/^url\(/);
});
