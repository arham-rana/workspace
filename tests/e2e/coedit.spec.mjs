// Several people editing at the same moment: nobody's change may be lost.
import { test, expect } from '@playwright/test';
import { signUp, api, newSheet, newSlides, grid, untilSaved } from './helpers.mjs';

async function people(browser, n) { const pages = []; for (let i = 0; i < n; i++) { const p = await (await browser.newContext({ viewport: { width: 1300, height: 860 } })).newPage(); await signUp(p, `Person ${i + 1}`); pages.push(p); } return pages; }
async function share(owner, id, others) { for (const p of others) { const user = await p.evaluate(() => fetch('/api/bootstrap').then((r) => r.json()).then((b) => b.user.username)); await api(owner, 'POST', `/api/notes/${id}/shares`, { username: user, permission: 'edit' }); } }
async function open(p, id) { await p.goto('/#/documents'); await p.reload(); await p.waitForSelector('[data-action=new-note]'); await p.goto(`/#/documents/${id}`); }

test('documents: live co-editing', async ({ browser }) => {
  const [A, S] = await people(browser, 2);
  await A.click('[data-action=new-note]'); await A.waitForSelector('.ProseMirror'); await A.click('.ProseMirror'); await A.keyboard.type('Shared text');
  const id = await A.evaluate(() => location.hash.split('/').pop()); await A.waitForTimeout(1500); await share(A, id, [S]); await open(S, id);
  await S.click('[data-action=edit-note]'); await S.waitForSelector('.ProseMirror'); await S.click('.ProseMirror p >> nth=0'); await S.keyboard.press('End'); await S.keyboard.type(' plus Sam');
  await expect(A.locator('.ProseMirror')).toContainText('Shared text plus Sam');
});

test('spreadsheets: two people typing in different cells at the same moment', async ({ browser }) => {
  const [A, S] = await people(browser, 2); const id = await newSheet(A); await share(A, id, [S]); await open(S, id); await S.waitForSelector('.xl-wrap');
  const ga = grid(A), gs = grid(S);
  await ga.go('A1'); await gs.go('C5'); await A.keyboard.type('From A'); await S.keyboard.type('From S'); await Promise.all([A.keyboard.press('Enter'), S.keyboard.press('Enter')]);
  await untilSaved(A, id, 'sheet', (d) => d.sheets[0].cells.A1?.v === 'From A' && d.sheets[0].cells.C5?.v === 'From S', 'both cells kept');
  await expect.poll(() => gs.raw('A1')).toBe('From A'); await expect.poll(() => ga.raw('C5')).toBe('From S');
});

test('presentations: three people editing different objects at the same moment', async ({ browser }) => {
  const [A, S, T] = await people(browser, 3); const id = await newSlides(A);
  await A.locator('.gs-canvas').focus(); await A.keyboard.press('Control+a'); await A.keyboard.press('Delete');
  for (const [i, y] of [60, 200, 340].entries()) { await A.click('[data-c="text-box"]'); const s = await A.locator('.gs-canvas .sl-stage').boundingBox(); const k = await A.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.gs-canvas .sl-frame')).getPropertyValue('--k'))); await A.mouse.click(s.x + 300 * k, s.y + y * k); await A.keyboard.type(`Box ${i + 1}`); await A.keyboard.press('Escape'); }
  const d0 = await untilSaved(A, id, 'slides', (d) => d.slides[0].items.length === 3, 'three boxes'); const ids = d0.slides[0].items.map((x) => x.id);
  await share(A, id, [S, T]); await open(S, id); await open(T, id); await S.waitForSelector('.gs-canvas .sl-stage'); await T.waitForSelector('.gs-canvas .sl-stage');
  const people3 = [A, S, T];
  for (const [i, p] of people3.entries()) { await p.locator(`.gs-canvas .sl-item[data-id="${ids[i]}"]`).dblclick(); await p.keyboard.press('End'); await p.keyboard.type(` edited by ${i + 1}`); }
  await Promise.all(people3.map((p) => p.keyboard.press('Escape'))); // all save at once
  await untilSaved(A, id, 'slides', (d) => ids.every((x, i) => d.slides[0].items.find((y) => y.id === x)?.html.includes(`edited by ${i + 1}`)), 'all three edits kept');
});

test('spreadsheets: two people typing many cells as fast as they can, interleaved', async ({ browser }) => {
  const [A, S] = await people(browser, 2); const id = await newSheet(A); await share(A, id, [S]); await open(S, id); await S.waitForSelector('.xl-wrap');
  const typeCells = async (p, col) => { const g = grid(p); for (let r = 1; r <= 6; r++) { await g.go(`${col}${r}`); await p.keyboard.type(`${col}${r}`); await p.keyboard.press('Enter'); } };
  await Promise.all([typeCells(A, 'A'), typeCells(S, 'C')]);
  await untilSaved(A, id, 'sheet', (d) => [1, 2, 3, 4, 5, 6].every((r) => d.sheets[0].cells[`A${r}`]?.v === `A${r}` && d.sheets[0].cells[`C${r}`]?.v === `C${r}`), 'all twelve cells kept');
});

test('presentations: moving, editing and adding slides at the same moment', async ({ browser }) => {
  const [A, S, T] = await people(browser, 3); const id = await newSlides(A);
  const d0 = await untilSaved(A, id, 'slides', (d) => d.slides[0].items.length === 2, 'title slide saved'); const [titleId, subId] = d0.slides[0].items.map((x) => x.id);
  await share(A, id, [S, T]); await open(S, id); await open(T, id);
  for (const p of [S, T]) await expect(p.locator('.gs-canvas .sl-item')).toHaveCount(2);
  await A.locator(`.gs-canvas .sl-item[data-id="${titleId}"]`).click(); await S.locator(`.gs-canvas .sl-item[data-id="${subId}"]`).dblclick(); await S.keyboard.type('Edited subtitle'); await T.locator('.gs-canvas').focus();
  await Promise.all([(async () => { for (let i = 0; i < 4; i++) await A.keyboard.press('ArrowDown'); })(), S.keyboard.press('Escape'), T.keyboard.press('Control+m')]);
  await untilSaved(A, id, 'slides', (d) => d.slides.length === 2 && d.slides[0].items.find((x) => x.id === titleId).y === d0.slides[0].items[0].y + 32 && /Edited subtitle/.test(d.slides[0].items.find((x) => x.id === subId).html), 'the move, the edit and the new slide all kept');
  for (const p of [A, S, T]) await expect(p.locator('.gs-film .deck-thumb')).toHaveCount(2); // everyone sees the same
});

test('a spreadsheet inside a document: co-edited, read live, and copied independently', async ({ browser }) => {
  const [A, S] = await people(browser, 2);
  await A.click('[data-action=new-note]'); await A.waitForSelector('.ProseMirror'); await A.click('.ProseMirror'); await A.keyboard.type('Budget:'); await A.keyboard.press('Enter');
  await A.click('[data-cmd=insert]'); await A.click('.pick-pop [data-pick=sheet]'); await A.waitForSelector('.ProseMirror .xl-wrap');
  const id = await A.evaluate(() => location.hash.split('/').pop()); await grid(A).put('A1', 'Rent'); await A.waitForTimeout(1500);
  await share(A, id, [S]); await open(S, id); // Sam reads (doesn't edit)
  await expect(S.locator('#doc-sheet .sheet-static td').first()).toHaveText('Rent');
  await grid(A).put('B1', '1500'); // Alex keeps editing: Sam's reading view updates live
  await expect(S.locator('#doc-sheet .sheet-static td', { hasText: '1500' })).toHaveCount(1, { timeout: 15000 });
  // copy the spreadsheet block and paste it below: the copy is independent
  // paste a copy of the spreadsheet block, as it arrives from the clipboard (HTML without the block's id)
  const html = await A.evaluate(async (noteId) => { const n = await (await fetch(`/api/notes/${noteId}`, { headers: { 'X-Requested-With': 'workspace' } })).json(); const m = /\[\[sheet:([A-Za-z0-9_-]+)/.exec(n.content); const json = new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))); const d = document.createElement('div'); d.dataset.sheet = json; return d.outerHTML; }, id);
  await A.click('.ProseMirror p >> nth=-1'); await A.keyboard.press('End');
  await A.evaluate((h) => { const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', ''); document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, html);
  await expect(A.locator('.ProseMirror .xl-wrap')).toHaveCount(2);
  await A.locator('.ProseMirror .xl-name').nth(1).click(); await A.locator('.ProseMirror .xl-name').nth(1).fill('A1'); await A.keyboard.press('Enter'); await A.keyboard.type('Copy only'); await A.keyboard.press('Enter');
  await expect.poll(async () => { const n = await api(A, 'GET', `/api/notes/${id}`); const blocks = [...(n.content || '').matchAll(/\[\[sheet:([A-Za-z0-9_-]+)/g)].map((m) => JSON.parse(Buffer.from(m[1], 'base64url').toString())); return blocks.map((b) => b.sheets[0].cells.A1?.v).join(' | '); }, { timeout: 15000 }).toBe('Rent | Copy only');
});
