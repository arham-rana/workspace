// Files from the app embedded in documents and presentations: linked or copied, whole or a part, private when not shared.
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { signUp, api, enc, createNote, openNote, currentId, untilSaved, saved } from './helpers.mjs';

const budget = { sheets: [{ name: 'Q1', cells: { A1: { v: 'Rent' }, B1: { v: '1500' }, A2: { v: 'Food' }, B2: { v: '=200*2' }, D9: { v: 'outside the range' } } }] };
async function pick(page, title, { copy = false, range = null, slide = null } = {}) {
  await expect(page.locator('.fp')).toBeVisible(); await page.fill('.fp-q', title); await page.click(`.fp-item:has-text("${title}")`);
  if (copy) await page.check('[name=mode][value=copy]');
  if (range) { await page.fill('.fp-range', range); await page.check('[name=part][value=range]'); }
  if (slide !== null) { await page.selectOption('.fp-slide', { value: String(slide) }); /* by value: labels are slide numbers too */ await page.check('[name=part][value=slide]'); }
  await page.click('.fp-ok');
}
const insertInDoc = async (page) => { await page.click('[data-cmd=insert]'); await page.click('.pick-pop [data-pick=fileLink]'); };

test('documents: link a spreadsheet range; it follows changes to the original and shows in reading view', async ({ page }) => {
  await signUp(page); const sheet = await createNote(page, { title: 'Budget sheet', kind: 'sheet', block: 'sheet', data: budget });
  const doc = await createNote(page, { title: 'Report', content: 'Our budget:' }); await openNote(page, doc);
  await page.click('[data-action=edit-note]'); await page.waitForSelector('.ProseMirror'); await page.click('.ProseMirror p >> nth=-1'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await insertInDoc(page); await pick(page, 'Budget sheet', { range: 'A1:B2' });
  const card = page.locator('.ProseMirror .file-embed'); await expect(card).toContainText('Rent'); await expect(card).toContainText('400'); await expect(card).not.toContainText('outside the range');
  await expect(card.locator('.fe-badge')).toContainText('Q1!A1:B2 · Linked');
  await expect.poll(async () => (await api(page, 'GET', `/api/notes/${doc}`)).content).toContain('[[file:');
  const wb = await saved(page, sheet, 'sheet'); wb.sheets[0].cells.B1 = { v: '2000' };
  await api(page, 'PUT', `/api/notes/${sheet}`, { content: `[[sheet:${enc(wb)}]]` });
  await card.locator('[data-fe=refresh]').click(); await expect(card).toContainText('2000'); // the latest version
  await page.click('[data-action=done-editing]'); await expect(page.locator('#doc-sheet .file-embed')).toContainText('2000');
});

test('documents: copy a document; later changes to the original don’t change the copy', async ({ page }) => {
  await signUp(page); const src = await createNote(page, { title: 'Source notes', content: 'Original paragraph text.' });
  await page.goto('/#/documents'); await page.reload(); await page.waitForSelector('[data-action=new-note]'); // the app knows about the new document
  await page.click('[data-action=new-note]'); await page.waitForSelector('.ProseMirror'); await page.click('.ProseMirror');
  await insertInDoc(page); await pick(page, 'Source notes', { copy: true });
  await expect(page.locator('.ProseMirror')).toContainText('Original paragraph text.'); await expect(page.locator('.ProseMirror .file-embed')).toHaveCount(0);
  const id = await currentId(page); await expect.poll(async () => (await api(page, 'GET', `/api/notes/${id}`)).content).toContain('Original paragraph text.');
  await api(page, 'PUT', `/api/notes/${src}`, { content: 'Changed later.' });
  expect((await api(page, 'GET', `/api/notes/${id}`)).content).not.toContain('Changed later.');
});

test('people who can open the document but not the embedded file see a placeholder, never its contents', async ({ browser }) => {
  const A = await (await browser.newContext()).newPage(); const B = await (await browser.newContext()).newPage();
  await signUp(A, 'Alex'); const blake = await signUp(B, 'Blake');
  const secret = await createNote(A, { title: 'Salaries', kind: 'sheet', block: 'sheet', data: { sheets: [{ name: 'S', cells: { A1: { v: 'CEO 999999' } } }] } });
  const doc = await createNote(A, { title: 'Shared report', content: `Intro\n\n[[file:${enc({ id: secret, kind: 'sheet', title: 'Salaries' })}]]` });
  await api(A, 'POST', `/api/notes/${doc}/shares`, { username: blake, permission: 'view' });
  await openNote(B, doc); const card = B.locator('#doc-sheet .file-embed');
  await expect(card).toContainText('You don’t have access'); await expect(B.locator('body')).not.toContainText('999999');
  expect((await B.request.get(`/api/notes/${secret}/embed`)).status()).toBe(404);
  const resolved = await api(B, 'GET', `/api/notes/${doc}/resolved`); expect(resolved.content).toContain('not available to you'); expect(resolved.content).not.toContain('999999');
  await openNote(A, doc); await expect(A.locator('#doc-sheet .file-embed')).toContainText('CEO 999999'); // the owner sees it
});

test('presentations: a linked document card, a spreadsheet copied as a table, one slide copied in; slideshow opens the file', async ({ page }) => {
  await signUp(page);
  await createNote(page, { title: 'Meeting notes', content: '## Agenda\n\nShip the release.' });
  await createNote(page, { title: 'Budget sheet', kind: 'sheet', block: 'sheet', data: budget });
  await createNote(page, { title: 'Old deck', kind: 'slides', block: 'slides', data: { slides: [1, 2, 3].map((n) => ({ items: [{ t: 'text', x: 60, y: 60, w: 600, h: 80, html: `Old slide ${n}` }] })) } });
  const id = await createNote(page, { title: 'New deck', kind: 'slides', block: 'slides', data: { slides: [{ items: [] }] } });
  await openNote(page, id); await expect(page.locator('.gs-film .deck-thumb')).toHaveCount(1);
  const insert = async () => { await page.click('[data-menu="Insert"]'); await page.click('.menu-item >> text=Existing file…'); };
  await insert(); await pick(page, 'Meeting notes');
  await expect(page.locator('.gs-canvas .sl-file .file-embed')).toContainText('Ship the release.');
  await insert(); await pick(page, 'Budget sheet', { copy: true, range: 'A1:B2' });
  await untilSaved(page, id, 'slides', (d) => d.slides[0].items.some((x) => x.t === 'table' && x.rows[1][1].html === '400'), 'spreadsheet copied as a table');
  await insert(); await pick(page, 'Old deck', { copy: true, slide: 2 });
  await untilSaved(page, id, 'slides', (d) => d.slides.length === 2 && /Old slide 3/.test(d.slides[1].items[0].html), 'one slide copied in');
  await page.locator('.gs-film .deck-thumb').first().click(); await page.click('[data-c="present"]');
  const popup = page.waitForEvent('popup'); await page.locator('.deck-present .sl-file').first().click();
  expect((await popup).url()).toMatch(/#\/files\/[0-9a-f-]{36}$/);
});

test('exports: Word and PowerPoint include snapshots of linked files', async ({ page }) => {
  await signUp(page); const sheet = await createNote(page, { title: 'Budget sheet', kind: 'sheet', block: 'sheet', data: budget });
  const doc = await createNote(page, { title: 'Report', content: `See:\n\n[[file:${enc({ id: sheet, kind: 'sheet', title: 'Budget sheet', part: { sheet: 'Q1', range: 'A1:B2' } })}]]` });
  const docx = await JSZip.loadAsync(await (await page.request.get(`/api/notes/${doc}/export.docx`)).body());
  const xml = await docx.file('word/document.xml').async('string'); expect(xml).toContain('Rent'); expect(xml).toContain('1500'); expect(xml).not.toContain('outside the range');
  const res = await page.request.post('/api/slides/export', { headers: { 'X-Requested-With': 'workspace', 'Content-Type': 'application/json' }, data: JSON.stringify({ title: 'Deck', data: { slides: [{ items: [{ id: 'f1', t: 'file', ref: { id: sheet, kind: 'sheet', title: 'Budget sheet' }, x: 60, y: 60, w: 400, h: 200 }] }] } }) });
  expect(decodeURIComponent(res.headers()['x-export-note'] || '')).toContain('snapshot');
  const pptx = await JSZip.loadAsync(await res.body()); const slide = await pptx.file('ppt/slides/slide1.xml').async('string');
  expect(slide).toContain('<a:tbl>'); expect(slide).toContain('1500');
});
