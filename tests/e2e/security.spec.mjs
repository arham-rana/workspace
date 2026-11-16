// Security: hostile content never runs, other people's things stay private, protections are in place.
import { test, expect } from '@playwright/test';
import { signUp, api, enc, createNote, openNote, currentId } from './helpers.mjs';

const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><svg onload="window.__xss=3">';
async function noScriptRan(page) {
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const bad = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value))).map((a) => `${el.tagName} ${a.name}=${a.value.slice(0, 40)}`)));
  expect(bad, 'event handlers or script links in the page').toEqual([]);
}

test('hostile content in documents, titles, folders, reminders, events, cells and slides never runs', async ({ page }) => {
  const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await signUp(page, `Alex ${XSS}`);
  const content = `## Heading ${XSS}\n\n${XSS}\n\n[click](javascript:window.__xss=4) [data](data:text/html,<script>alert(1)</script>) ![pic](javascript:alert(1))\n\n- [ ] task ${XSS}\n\n> quote ${XSS}`;
  const doc = await createNote(page, { title: `Title ${XSS}`, content });
  await api(page, 'POST', '/api/folders', { name: `Folder ${XSS}` });
  await api(page, 'POST', '/api/reminders', { title: `Reminder ${XSS}`, dueAt: new Date(Date.now() + 3600000).toISOString().slice(0, 16), category: 'task' });
  await api(page, 'POST', '/api/events', { title: `Event ${XSS}`, date: new Date().toISOString().slice(0, 10), start: '09:00', end: '10:00', color: 'green' });
  const sheet = await createNote(page, { title: 'Sheet', kind: 'sheet', block: 'sheet', data: { sheets: [{ name: `S${XSS}`.slice(0, 31), cells: { A1: { v: XSS }, B1: { v: 'link', l: 'javascript:alert(1)' }, C1: { v: `=HYPERLINK("javascript:alert(1)","x")` }, D1: { v: 'note', n: { t: XSS } } } }] } });
  const deck = await createNote(page, { title: 'Deck', kind: 'slides', block: 'slides', data: { slides: [{ items: [{ t: 'text', x: 0, y: 0, w: 500, h: 100, html: `<a href="javascript:alert(1)">x</a>${XSS}` }, { t: 'image', src: 'javascript:alert(1)', x: 0, y: 0, w: 10, h: 10 }] }] } });
  await page.goto('/#/documents'); await page.reload(); await page.waitForSelector('[data-action=new-note]'); await page.waitForTimeout(500); await noScriptRan(page);
  await openNote(page, doc); await page.waitForSelector('#doc-sheet'); await page.waitForTimeout(800); await noScriptRan(page);
  await page.click('[data-action=edit-note]'); await page.waitForSelector('.ProseMirror'); await page.waitForTimeout(800); await noScriptRan(page);
  await openNote(page, sheet); await page.waitForSelector('.xl-wrap'); await page.waitForTimeout(500); await noScriptRan(page);
  await openNote(page, deck); await page.waitForSelector('.gs-canvas .sl-stage'); await page.waitForTimeout(500); await noScriptRan(page);
  for (const where of ['#/calendar', '#/reminders', '#/settings']) { await page.goto(`/${where}`); await page.waitForTimeout(600); await noScriptRan(page); }
  expect(dialogs).toEqual([]);
});

test('other people’s documents, files, versions, exports and live sessions stay private', async ({ browser }) => {
  const A = await (await browser.newContext()).newPage(); const B = await (await browser.newContext()).newPage();
  await signUp(A, 'Alex'); await signUp(B, 'Blake');
  const note = await createNote(A, { title: 'Private plans', content: 'Secret: the launch date' });
  const file = await A.evaluate(async (id) => (await fetch('/api/files', { method: 'POST', headers: { 'X-Requested-With': 'workspace', 'X-File-Name': 'x.txt', 'X-File-Type': 'text/plain', 'X-Note-Id': id }, body: 'secret file' })).json(), note);
  await A.waitForTimeout(300);
  for (const url of [`/api/notes/${note}`, `/api/notes/${note}/versions`, `/api/notes/${note}/export.docx`, `/api/notes/${note}/people`, file.url]) {
    const r = await B.request.get(url); expect(r.status(), `Blake reading ${url}`).toBeGreaterThanOrEqual(400); expect(await r.text()).not.toContain('Secret');
  }
  for (const [method, url, body] of [['PUT', `/api/notes/${note}`, { content: 'hacked' }], ['DELETE', `/api/notes/${note}`], ['POST', `/api/notes/${note}/shares`, { username: 'someone', permission: 'edit' }]]) {
    const r = await B.request.fetch(url, { method, headers: { 'X-Requested-With': 'workspace', 'Content-Type': 'application/json' }, data: body ? JSON.stringify(body) : undefined });
    expect(r.status(), `Blake ${method} ${url}`).toBeGreaterThanOrEqual(400);
  }
  expect((await api(A, 'GET', `/api/notes/${note}`)).content).toBe('Secret: the launch date'); // untouched
  expect((await api(B, 'GET', '/api/notes')).some((n) => n.id === note)).toBe(false);
  // Blake's live connection to Alex's document gets nothing
  const got = await B.evaluate(async (id) => { const { watchDocument } = await import('/js/vendor/collab.js'); let text = ''; const w = watchDocument({ noteId: id, onChange: (md) => { text = md; } }); await new Promise((r) => setTimeout(r, 3000)); w?.destroy?.(); return text; }, note);
  expect(got).not.toContain('Secret');
  // requests from other sites can't change anything (no app header) — and the server refuses them
  const forged = await B.request.fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: JSON.stringify({ title: 'forged' }) });
  expect(forged.status()).toBe(403);
});

test('security headers are sent; a malformed connection origin can’t stop the server', async ({ request }) => {
  const r = await request.get('/'); const h = r.headers();
  expect(h['content-security-policy']).toContain("script-src 'self'"); expect(h['content-security-policy']).toContain("object-src 'none'"); expect(h['content-security-policy']).toContain("frame-ancestors 'self'");
  expect(h['x-content-type-options']).toBe('nosniff'); expect(h['x-frame-options']).toBe('SAMEORIGIN');
  const http = await import('node:http'); const base = new URL(r.url());
  await new Promise((resolve) => { const req = http.request({ host: base.hostname, port: base.port, path: '/collab/x', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: 'null' } }); req.on('error', resolve); req.on('upgrade', resolve); req.on('response', resolve); req.end(); setTimeout(resolve, 1500); });
  expect((await request.get('/api/health')).ok()).toBe(true); // still running
});

test('removing or reducing someone’s access takes effect on their open editor at once', async ({ browser }) => {
  const A = await (await browser.newContext()).newPage(); const B = await (await browser.newContext()).newPage();
  await signUp(A, 'Alex'); const blake = await signUp(B, 'Blake');
  await A.click('[data-action=new-note]'); await A.waitForSelector('.ProseMirror'); await A.click('.ProseMirror'); await A.keyboard.type('Shared start.');
  const id = await currentId(A); await A.waitForTimeout(1500);
  await api(A, 'POST', `/api/notes/${id}/shares`, { username: blake, permission: 'edit' });
  const blakeId = (await api(A, 'GET', `/api/notes/${id}/shares`)).find((x) => x.username === blake).userId;
  await B.goto('/#/documents'); await B.reload(); await B.waitForSelector('[data-action=new-note]'); await B.goto(`/#/documents/${id}`);
  await B.click('[data-action=edit-note]'); await B.waitForSelector('.ProseMirror'); await B.click('.ProseMirror p >> nth=0'); await B.keyboard.press('End'); await B.keyboard.type(' Blake was here.');
  await expect(A.locator('.ProseMirror')).toContainText('Blake was here.'); // editing works while shared
  // reduce to view only: Blake's typing no longer reaches the document
  expect((await A.request.fetch(`/api/notes/${id}/shares/${blakeId}`, { method: 'PUT', headers: { 'X-Requested-With': 'workspace', 'Content-Type': 'application/json' }, data: JSON.stringify({ permission: 'view' }) })).ok()).toBe(true);
  await A.waitForTimeout(2500); await B.keyboard.type(' VIEW-ONLY TYPING'); await B.waitForTimeout(2500);
  await expect(A.locator('.ProseMirror')).not.toContainText('VIEW-ONLY TYPING');
  // remove entirely: Blake's open editor gets nothing more
  await A.request.delete(`/api/notes/${id}/shares/${blakeId}`, { headers: { 'X-Requested-With': 'workspace' } });
  await A.waitForTimeout(2500); await A.click('.ProseMirror'); await A.keyboard.press('Control+End'); await A.keyboard.type(' After removal: secret.');
  await B.waitForTimeout(3000);
  expect(await B.locator('.ProseMirror').innerText().catch(() => '')).not.toContain('secret');
  expect((await api(A, 'GET', `/api/notes/${id}`)).content).not.toContain('VIEW-ONLY');
});
