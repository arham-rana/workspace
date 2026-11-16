// Phones and tablets: touch to select, drag and type; the phone layout keeps everything reachable.
import { test, expect, devices } from '@playwright/test';
import { signUp, createNote, openNote, untilSaved, grid } from './helpers.mjs';

const { defaultBrowserType, ...phone } = devices['iPhone 13']; void defaultBrowserType;
test.use(phone); // the iPhone's size, touch and mobile settings, in Chromium (Chrome's engine)

/** A real finger drag (touch events, which the browser turns into pointer events). */
async function touchDrag(page, x1, y1, x2, y2) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('presentations on a phone: tap to select, drag with a finger, double-tap a table cell, panels from the bottom', async ({ page }) => {
  await signUp(page);
  const id = await createNote(page, { title: 'Deck', kind: 'slides', block: 'slides', data: { slides: [{ id: 'a', items: [{ id: 'box', t: 'shape', shape: 'rect', x: 100, y: 100, w: 200, h: 120, fill: '#0b57d0' }, { id: 'tbl', t: 'table', x: 500, y: 300, w: 300, h: 80, rows: [[{ html: 'A' }, { html: 'B' }], [{ html: '1' }, { html: '2' }]], colW: [150, 150], rowH: [40, 40] }] }] } });
  await openNote(page, id); await page.waitForSelector('.gs-canvas .sl-item[data-id="box"]');
  const box = await page.locator('.gs-canvas .sl-item[data-id="box"]').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await expect(page.locator('.gs-sel')).toHaveCount(1);
  await touchDrag(page, box.x + box.width / 2, box.y + box.height / 2, box.x + box.width / 2 + 60, box.y + box.height / 2 + 30);
  await untilSaved(page, id, 'slides', (d) => { const b = d.slides[0].items.find((x) => x.id === 'box'); return b.x > 100 && b.y > 100; }, 'moved by a finger');
  const cell = await page.locator('.gs-canvas .sl-item[data-id="tbl"] td[data-cell="0,0"]').boundingBox();
  await page.touchscreen.tap(cell.x + 10, cell.y + 10); await page.waitForTimeout(120); await page.touchscreen.tap(cell.x + 10, cell.y + 10);
  await expect(page.locator('.gs-canvas .sl-cell.editing, .gs-canvas [contenteditable="true"]').first()).toBeVisible(); // double-tap: type in the cell
  await page.locator('.gs-stagewrap').tap({ position: { x: 4, y: 4 } }).catch(() => {});
  await page.touchscreen.tap(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30); await page.click('[data-c="format-options"]');
  const panel = await page.locator('.gs-panel').boundingBox(); const vp = page.viewportSize();
  expect(Math.round(panel.y + panel.height)).toBeGreaterThanOrEqual(vp.height - 2); expect(Math.round(panel.width)).toBeGreaterThanOrEqual(vp.width - 2); // a sheet from the bottom
});

test('spreadsheets on a phone: double-tap a cell to type', async ({ page }) => {
  await signUp(page);
  const id = await createNote(page, { title: 'Budget', kind: 'sheet', block: 'sheet', data: { sheets: [{ id: 's1', name: 'Q1', cells: { A1: { v: 'Rent' } } }] } });
  await openNote(page, id); await page.waitForSelector('.xl-wrap');
  const a1 = await page.locator('.xl-q .xc', { hasText: /^Rent$/ }).boundingBox();
  const x = a1.x + a1.width / 2, y = a1.y + a1.height * 1.5; // B? no: A2, one row down
  await page.touchscreen.tap(x, y); await page.waitForTimeout(120); await page.touchscreen.tap(x, y);
  await expect(page.locator('.xl-edit')).toBeVisible(); await expect(page.locator('.xl-edit')).toBeFocused(); // the phone keyboard has a field to type into
  await page.keyboard.type('1500'); await page.keyboard.press('Enter');
  await untilSaved(page, id, 'sheet', (d) => d.sheets[0].cells.A2?.v === '1500', 'typed on a phone');
});

test('documents on a phone: tap and type; the top bar keeps the essentials, the rest is in ⋮', async ({ page }) => {
  await signUp(page); await page.locator('[data-action=new-note]').first().tap(); await page.waitForSelector('.ProseMirror');
  await page.locator('.ProseMirror').tap(); await page.keyboard.type('Written on a phone');
  await expect(page.locator('.ProseMirror')).toContainText('Written on a phone');
  await expect(page.locator('.doc-bar [data-action="doc-history"]')).toBeHidden();
  await page.locator('.doc-bar [data-action=note-menu]').tap(); await page.locator('.menu-item', { hasText: 'Version history' }).tap();
  await expect(page.locator('.modal')).toContainText('Version history');
});
