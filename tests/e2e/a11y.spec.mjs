// Accessibility: automated checks (axe-core) on the main screens. Serious and critical problems fail the test.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signUp, createNote, openNote, newSheet, newSlides, api } from './helpers.mjs';

async function audit(page, where) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  for (const v of r.violations) for (const n of v.nodes.slice(0, 6)) console.log(`A11Y ${where} | ${v.id} | ${n.target.join(' ')} | ${n.html.slice(0, 170)}`);
  return bad.map((v) => `${v.id} (${v.nodes.length}×): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`);
}

test('sign-in page', async ({ page }) => { await page.goto('/'); await page.waitForSelector('[name=username]'); expect(await audit(page, 'sign-in')).toEqual([]); });

test('documents, reading, editing, settings', async ({ page }) => {
  await signUp(page);
  const id = await createNote(page, { title: 'Plan', content: '## Goals\n\nSome **text** and a [link](https://example.com).\n\n- [ ] a task\n- [x] done' });
  await page.goto('/#/documents'); await page.reload(); await page.waitForSelector('[data-action=new-note]');
  const issues = { list: await audit(page, 'documents') };
  await openNote(page, id); await page.waitForSelector('#doc-sheet'); issues.reading = await audit(page, 'reading');
  await page.click('[data-action=edit-note]'); await page.waitForSelector('.ProseMirror'); issues.editing = await audit(page, 'editing');
  await page.goto('/#/settings'); await page.waitForSelector('.setting-group'); issues.settings = await audit(page, 'settings');
  await page.goto('/#/calendar'); await page.waitForTimeout(500); issues.calendar = await audit(page, 'calendar');
  await page.goto('/#/reminders'); await page.waitForTimeout(500); issues.reminders = await audit(page, 'reminders');
  expect(issues).toEqual({ list: [], reading: [], editing: [], settings: [], calendar: [], reminders: [] });
});

test('spreadsheet and presentation editors, a dialog and a menu', async ({ page }) => {
  await signUp(page); await newSheet(page);
  const issues = { sheet: await audit(page, 'spreadsheet') };
  for (const tab of ['Home', 'Insert', 'Formulas', 'Data', 'View', 'File']) { await page.click(`.rb-tab[data-rbtab="${tab}"]`); const found = await audit(page, `ribbon ${tab}`); if (found.length) issues[`ribbon ${tab}`] = found; }
  await page.keyboard.press('Escape'); await page.locator('.xl-wrap').focus(); // the grid has the keyboard
  await page.keyboard.press('Control+Digit1'); await page.waitForSelector('.modal'); issues.dialog = await audit(page, 'format-cells-dialog'); await page.keyboard.press('Escape');
  await page.goto('/#/documents'); await newSlides(page); issues.slides = await audit(page, 'presentation');
  await page.click('[data-menu="Insert"]'); await page.waitForSelector('.menu'); issues.menu = await audit(page, 'menu'); await page.keyboard.press('Escape');
  expect(issues).toEqual({ sheet: [], dialog: [], slides: [], menu: [] });
});

const said = (page) => page.evaluate(() => [...document.querySelectorAll('body > .sr-only[aria-live]')].map((e) => e.textContent).join(' '));

test('keyboard and screen reader: spreadsheet announcements, menus and dialogs', async ({ page }) => {
  await signUp(page); await newSheet(page); const k = page.keyboard;
  await page.click('.xl-name'); await page.fill('.xl-name', 'A1'); await k.press('Enter'); await k.type('5'); await k.press('Enter'); await k.type('=A1*2'); await k.press('Enter');
  await page.locator('.xl-wrap').focus(); await k.press('ArrowUp');
  await expect.poll(() => said(page)).toContain('A2: 10, formula =A1*2');
  await k.press('Shift+ArrowUp'); await expect.poll(() => said(page)).toContain('A1:A2 selected, 2 cells');
  // a dialog: Escape closes it and focus returns to the grid
  await k.press('Control+Digit1'); await expect(page.locator('.modal')).toBeVisible(); await k.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0); await expect(page.locator('.xl-wrap')).toBeFocused();
});

test('keyboard only: presentation menus, selecting and adding a shape', async ({ page }) => {
  await signUp(page); const id = await newSlides(page); const k = page.keyboard;
  // menus: End / Home, a letter jumps, Escape returns to the menu button
  await page.locator('[data-menu="Insert"]').focus(); await k.press('Enter'); await expect(page.locator('.menu .menu-item').first()).toBeFocused();
  await k.press('End'); await expect(page.locator('.menu .menu-item').last()).toBeFocused();
  await k.press('Home'); await k.press('t'); await expect(page.locator('.menu .menu-item:focus')).toHaveText(/^Text box/);
  await k.press('Escape'); await expect(page.locator('[data-menu="Insert"]')).toBeFocused();
  // Tab selects objects on the slide and says what's selected
  await page.locator('.gs-canvas').focus(); await k.press('Tab');
  await expect.poll(() => said(page)).toMatch(/Slide 1 of 1\. .*selected, [\d.]+ by [\d.]+ inches/);
  await k.press('Escape');
  // the shape picker works with the keyboard; Enter on the slide places the shape
  await page.locator('[data-c="shape-menu"]').focus(); await k.press('Enter'); await expect(page.locator('.gs-shapes button').first()).toBeFocused();
  await k.press('ArrowRight'); await k.press('Enter'); // the second shape
  await expect.poll(() => said(page)).toContain('press Enter to place it');
  await page.locator('.gs-canvas').focus(); await k.press('Enter');
  await expect.poll(async () => (await api(page, 'GET', `/api/notes/${id}`)).content.length).toBeGreaterThan(0);
  await expect(page.locator('.gs-canvas .sl-item.sl-shape')).toHaveCount(1);
});

test('reduce motion: no slide transitions, animations finish at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await signUp(page);
  const id = await createNote(page, { title: 'M', kind: 'slides', block: 'slides', data: { slides: [{ id: 'a', tr: { type: 'cube', dur: 2 }, items: [{ id: 't', t: 'text', x: 60, y: 60, w: 600, h: 80, html: 'One' }], anims: [{ item: 't', fx: 'flyInLeft', start: 'click', dur: 3 }] }, { id: 'b', tr: { type: 'cube', dur: 2 }, items: [{ id: 'u', t: 'text', x: 60, y: 60, w: 600, h: 80, html: 'Two' }] }] } });
  await openNote(page, id); await expect(page.locator('.gs-film .deck-thumb')).toHaveCount(2);
  await page.click('[data-c="present"]'); const k = page.keyboard;
  await k.press('ArrowRight'); await page.waitForTimeout(150); // the 3-second fly-in
  expect(await page.evaluate(() => document.querySelector('.deck-present-stage:last-child .sl-item[data-id="t"]').getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  await k.press('ArrowRight'); await expect(page.locator('.deck-present-stage.incoming')).toHaveCount(0); // no 2-second cube transition
  await expect(page.locator('.deck-present-stage:last-child .sl-rich').first()).toHaveText('Two');
});
