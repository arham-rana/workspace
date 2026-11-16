// Shared helpers for the browser tests. Every test signs up its own user, so tests can run side by side.
import { expect } from '@playwright/test';

let n = 0;
export async function signUp(page, name = 'Alex') {
  const user = `u${Date.now().toString(36)}${process.pid}${(n += 1)}`;
  await page.goto('/');
  await page.waitForSelector('[name=username]'); // the sign-in page draws itself after loading
  if (!(await page.locator('[name=name]').isVisible().catch(() => false)) && (await page.locator('[data-mode=signup]').count())) await page.click('[data-mode=signup]');
  await page.fill('[name=name]', name); await page.fill('[name=username]', user); await page.fill('[name=password]', 'password123');
  await page.click('.glass-submit');
  await page.waitForSelector('[data-action=new-note]');
  return user;
}
/** Collect page errors; call `check()` at the end of a test. */
export function watchErrors(page) { const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) errs.push(`CSP: ${m.text().slice(0, 200)}`); }); return { check: () => expect(errs, 'errors in the page (including Content Security Policy violations)').toEqual([]) }; }
export const api = (page, method, url, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workspace' }, body: b === undefined ? undefined : JSON.stringify(b) }).then((r) => r.json()), [method, url, body]);
export const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
export async function createNote(page, { title = 'Test', kind = 'note', block = null, data = null, content = '' }) {
  const c = block ? `[[${block}:${enc(data)}]]` : content;
  return (await api(page, 'POST', '/api/notes', { title, kind, content: c })).id;
}
export async function openNote(page, id) { await page.goto('/#/documents'); await page.reload(); await page.waitForSelector('[data-action=new-note]'); await page.goto(`/#/documents/${id}`); } // reload so the app knows about notes made through the API
export const currentId = (page) => page.evaluate(() => location.hash.split('/').pop());
/** The saved spreadsheet or presentation data of a note. */
export async function saved(page, id, block) {
  const note = await api(page, 'GET', `/api/notes/${id}`);
  const m = new RegExp(`\\[\\[${block}:([A-Za-z0-9_-]+)`).exec(note.content || '');
  return m ? JSON.parse(Buffer.from(m[1], 'base64url').toString()) : null;
}
/** Wait until the saved data passes a check (saves are debounced). */
export async function untilSaved(page, id, block, fn, message) {
  let last = null;
  await expect.poll(async () => { last = await saved(page, id, block); try { return !!fn(last); } catch { return false; } }, { message, timeout: 15_000 }).toBe(true);
  return last;
}

/* spreadsheet grid */
export function grid(page) {
  const go = async (ref) => { await page.click('.xl-name'); await page.fill('.xl-name', ref); await page.keyboard.press('Enter'); };
  return {
    go,
    put: async (ref, v) => { await go(ref); await page.keyboard.type(v); await page.keyboard.press('Enter'); },
    raw: async (ref) => { await go(ref); return page.inputValue('.xl-formula'); },
    texts: () => page.evaluate(() => [...document.querySelectorAll('.xl-q .xc')].map((e) => e.textContent)),
    cellStyle: (text, prop) => page.evaluate(([t, p]) => { const e = [...document.querySelectorAll('.xl-q .xc')].find((x) => x.textContent === t); return e ? getComputedStyle(e)[p] : null; }, [text, prop]),
  };
}
export async function newSheet(page) { await page.click('[data-action=new-sheet]'); await page.waitForSelector('.xl-wrap'); return currentId(page); }

/* presentation canvas */
export async function newSlides(page) { await page.click('[data-action=new-slides]'); await page.waitForSelector('.gs-canvas .sl-stage'); return currentId(page); }
export async function dragOnSlide(page, x1, y1, x2, y2) {
  const s = await page.locator('.gs-canvas .sl-stage').boundingBox();
  const k = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.gs-canvas .sl-frame')).getPropertyValue('--k')));
  await page.mouse.move(s.x + x1 * k, s.y + y1 * k); await page.mouse.down(); await page.mouse.move(s.x + x2 * k, s.y + y2 * k, { steps: 6 }); await page.mouse.up();
}

/** Use a spreadsheet tool: in the main toolbar row if it's there, otherwise from its drop-down card (Format, Insert,
 *  Formulas, Data, View, File, or a contextual Table/Chart/PivotTable card). */
export async function tool(page, area, cmd) {
  const inRow = page.locator(`.xl-tb-row [data-cmd="${cmd}"]:visible`);
  if (await inRow.count()) return inRow.first().click();
  const tab = page.locator(`.rb-tab[data-rbtab="${area}"]`);
  if ((await tab.getAttribute('aria-expanded')) !== 'true') await tab.click();
  await page.locator(`.rb-pop [data-rbpanel="${area}"] [data-cmd="${cmd}"]`).first().click();
}
