// Presentations: Google Slides editing (Phase A), content and design (B), motion and presenting (C), files.
import { test, expect } from '@playwright/test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { signUp, watchErrors, newSlides, untilSaved, saved, createNote, openNote, dragOnSlide } from './helpers.mjs';

const items = async (page, id, i = 0) => (await saved(page, id, 'slides')).slides[i].items;
const png = (file, w = 400, h = 300) => { // a tiny valid PNG, made without image libraries
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; fs.writeFileSync(file, Buffer.from(b64, 'base64')); return file; };

test('editing like Google Slides: text, rotation, resizing, duplicating, grouping, Format options', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); const id = await newSlides(page); const k = page.keyboard;
  await expect(page.locator('.gs-menu')).toHaveText(['File', 'Edit', 'View', 'Insert', 'Format', 'Slide', 'Arrange', 'Tools']);
  await page.click('[data-c="text-box"]'); await dragOnSlide(page, 100, 300, 400, 360); await expect(page.locator('.sl-rich.editing')).toHaveCount(1);
  await k.type('Hello world'); await k.press('Control+a'); await k.press('Alt+Shift+Digit5'); await k.press('Escape');
  const t = (await untilSaved(page, id, 'slides', (d) => d.slides[0].items.some((x) => /<s(trike)?>Hello world/.test(x.html || '')), 'strikethrough saved')).slides[0].items.find((x) => /Hello/.test(x.html || ''));
  await page.locator(`.gs-canvas .sl-item[data-id="${t.id}"]`).click(); await expect(page.locator('.gs-sel .gs-h')).toHaveCount(8); await expect(page.locator('.gs-rot')).toHaveCount(1);
  await page.click('[data-menu="Arrange"]'); await page.click('.menu-item >> text=Rotate clockwise 90°');
  await untilSaved(page, id, 'slides', (d) => d.slides[0].items.find((x) => x.id === t.id).rot === 90, 'rotated 90°');
  await page.click('[data-menu="Arrange"]'); await page.click('.menu-item >> text=Rotate counter-clockwise 90°');
  const b = await page.locator(`.gs-canvas .sl-item[data-id="${t.id}"]`).boundingBox(); // Alt-drag duplicates
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await k.down('Alt'); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 120, { steps: 6 }); await page.mouse.up(); await k.up('Alt');
  const both = (await untilSaved(page, id, 'slides', (d) => d.slides[0].items.filter((x) => /Hello/.test(x.html || '')).length === 2, 'Alt-drag made a copy')).slides[0].items.filter((x) => /Hello/.test(x.html || ''));
  await page.locator(`.gs-canvas .sl-item[data-id="${both[0].id}"]`).click(); await page.locator(`.gs-canvas .sl-item[data-id="${both[1].id}"]`).click({ modifiers: ['Shift'] }); await k.press('Control+g');
  await untilSaved(page, id, 'slides', (d) => { const g = d.slides[0].items.filter((x) => /Hello/.test(x.html || '')).map((x) => x.g); return g[0] && g[0] === g[1]; }, 'grouped');
  await k.press('Control+Shift+g'); await untilSaved(page, id, 'slides', (d) => d.slides[0].items.every((x) => !x.g), 'ungrouped');
  await page.locator('.gs-stagewrap').click({ position: { x: 5, y: 5 } }); await page.locator(`.gs-canvas .sl-item[data-id="${both[1].id}"]`).click();
  await page.click('[data-c="format-options"]'); await page.fill('.gs-panel [data-f="w"]', '3'); await k.press('Tab'); await page.check('.gs-panel [data-f="af"][value="shrink"]');
  await untilSaved(page, id, 'slides', (d) => { const x = d.slides[0].items.find((y) => y.id === both[1].id); return x.w === 288 && x.af === 'shrink'; }, 'Format options: 3 in wide, shrink on overflow');
  errs.check();
});

test('slides: find and replace, grid view, multi-select, zoom, shortcuts', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page);
  const id = await createNote(page, { title: 'Deck', kind: 'slides', block: 'slides', data: { slides: [1, 2, 3].map((n) => ({ items: [{ t: 'text', x: 60, y: 60, w: 600, h: 80, html: `Hello slide ${n}` }] })) } });
  await openNote(page, id); await expect(page.locator('.gs-film .deck-thumb')).toHaveCount(3); const k = page.keyboard; // the stored slides have arrived
  await page.locator('.gs-canvas').focus(); await k.press('Control+Shift+h'); await page.fill('#gs-find [name=find]', 'Hello'); await page.fill('#gs-find [name=repl]', 'Hi');
  await expect(page.locator('.gs-find-status')).toHaveText('3 results'); await page.click('[data-f="all"]'); await k.press('Escape');
  await untilSaved(page, id, 'slides', (d) => d.slides.every((s) => /Hi slide/.test(s.items[0].html)), 'replaced on every slide');
  await page.locator('.gs-canvas').focus(); await k.press('Control+Alt+Digit1'); await expect(page.locator('.gs-grid .deck-thumb')).toHaveCount(3); await k.press('Escape'); await expect(page.locator('.gs-body')).toBeVisible();
  await page.locator('.gs-film .deck-thumb').nth(1).click(); await page.locator('.gs-film .deck-thumb').nth(2).click({ modifiers: ['Shift'] });
  await expect(page.locator('.gs-film .deck-thumb.picked')).toHaveCount(2); await k.press('Delete'); await expect(page.locator('.gs-film .deck-thumb')).toHaveCount(1);
  await page.selectOption('[data-c="zoom-select"]', '2'); expect(Math.round((await page.locator('.gs-canvas').boundingBox()).width)).toBe(1920);
  await page.locator('.gs-canvas').focus(); await k.press('Control+m'); await expect(page.locator('.gs-film .deck-thumb')).toHaveCount(2);
  errs.check();
});

test('content: shapes, connectors, tables, images, video, word art, design and the theme builder', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); const id = await newSlides(page); const k = page.keyboard;
  await page.locator('.gs-canvas').focus(); await k.press('Control+a'); await k.press('Delete');
  await page.click('[data-c="shape-menu"]'); await expect(page.locator('.gs-shapes [data-shape]')).toHaveCount(Object.keys((await import('../../shared/shapes.mjs')).SHAPE_LIB).length);
  await page.click('.gs-shapes [data-shape="star5"]'); await dragOnSlide(page, 80, 80, 240, 240);
  await page.click('[data-c="fill-pick"]'); await page.click('.gs-colors [data-col="#ff9900"]');
  await page.click('[data-c="shape-menu"]'); await page.click('.gs-shapes [data-shape="flowChartDecision"]'); await dragOnSlide(page, 520, 80, 700, 240);
  const d0 = await untilSaved(page, id, 'slides', (d) => d.slides[0].items.length === 2 && d.slides[0].items.some((x) => x.fill === '#ff9900'), 'two shapes, star filled orange');
  const star = d0.slides[0].items.find((x) => x.shape === 'star5'), dec = d0.slides[0].items.find((x) => x.shape === 'flowChartDecision');
  await page.click('[data-menu="Insert"]'); await page.click('.menu-item >> text=Arrow'); await dragOnSlide(page, star.x + star.w, star.y + star.h / 2, dec.x + 2, dec.y + dec.h / 2);
  const ln = (await untilSaved(page, id, 'slides', (d) => d.slides[0].items.some((x) => x.t === 'line'), 'arrow drawn')).slides[0].items.find((x) => x.t === 'line');
  expect([ln.from?.site, ln.to?.site, ln.a2]).toEqual(['e', 'w', 'arrow']);
  await page.locator(`.gs-canvas .sl-item[data-id="${star.id}"]`).click(); await page.locator('.gs-canvas').focus(); await k.press('ArrowDown'); await k.press('ArrowDown');
  await untilSaved(page, id, 'slides', (d) => d.slides[0].items.find((x) => x.t === 'line').y1 === ln.y1 + 16, 'the connector followed the star');
  await page.click('[data-menu="Insert"]'); await page.click('.menu-item >> text=Table…'); await page.click('.gs-tblpick [data-rc="3,3"]');
  const tb = (await untilSaved(page, id, 'slides', (d) => d.slides[0].items.some((x) => x.t === 'table'), 'table inserted')).slides[0].items.find((x) => x.t === 'table');
  await page.locator(`.gs-canvas .sl-item[data-id="${tb.id}"] td[data-cell="0,0"]`).dblclick(); await k.type('Name'); await k.press('Tab'); await k.type('Score'); await k.press('Escape');
  await untilSaved(page, id, 'slides', (d) => { const t = d.slides[0].items.find((x) => x.t === 'table'); return t.rows[0][0].html === 'Name' && t.rows[0][1].html === 'Score'; }, 'typed into cells with Tab');
  await page.locator(`.gs-canvas .sl-item[data-id="${tb.id}"] td[data-cell="2,0"]`).click(); await page.locator(`.gs-canvas .sl-item[data-id="${tb.id}"] td[data-cell="2,1"]`).click({ modifiers: ['Shift'], position: { x: 20, y: 10 } });
  await page.click('[data-c="table-menu"]'); await page.click('.menu-item >> text=Merge cells');
  await untilSaved(page, id, 'slides', (d) => d.slides[0].items.find((x) => x.t === 'table').rows[2][0].cs === 2, 'merged');
  await page.locator('.gs-stagewrap').click({ position: { x: 5, y: 5 } });
  await page.setInputFiles('.deck-img', png(path.join(os.tmpdir(), `pic-${Date.now()}.png`)));
  const im = (await untilSaved(page, id, 'slides', (d) => d.slides[0].items.some((x) => x.t === 'image'), 'image uploaded')).slides[0].items.find((x) => x.t === 'image');
  await page.locator(`.gs-canvas .sl-item[data-id="${im.id}"]`).click(); await page.click('[data-c="mask-menu"]'); await page.click('.menu-item >> text=Oval');
  await page.click('[data-c="format-options"]'); await page.selectOption('.gs-panel [data-io="rc"]', 'gray');
  await untilSaved(page, id, 'slides', (d) => { const x = d.slides[0].items.find((y) => y.t === 'image'); return x.mask === 'ellipse' && x.rc === 'gray'; }, 'masked and greyscale');
  await page.click('[data-menu="Insert"]'); await page.click('.menu-item >> text=Video…'); await page.fill('#gs-vid [name=url]', 'https://youtu.be/dQw4w9WgXcQ?t=42'); await page.click('.modal-foot .btn-primary');
  await page.click('[data-menu="Insert"]'); await page.click('.menu-item >> text=Word art'); await page.fill('#gs-wa [name=t]', 'Big news'); await page.click('.modal-foot .btn-primary');
  await untilSaved(page, id, 'slides', (d) => d.slides[0].items.some((x) => x.t === 'video' && x.start === 42) && d.slides[0].items.some((x) => x.t === 'wordart'), 'video and word art');
  await page.locator('.gs-stagewrap').click({ position: { x: 5, y: 5 } }); await page.click('[data-c="background"]'); await page.check('#gs-bg [name=m][value="gradient"]'); await page.click('[data-done]');
  await page.click('[data-menu="Slide"]'); await page.click('.menu-item >> text=Change theme'); await page.locator('.gs-panel [data-tc="accent"]').evaluate((e) => { e.value = '#ff0066'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('.gs-panel [data-pc="theme-builder"]'); await expect(page.locator('.gs-film [data-target]')).toHaveCount(7);
  await page.click('[data-c="text-box"]'); await dragOnSlide(page, 20, 500, 300, 530); await k.type('ACME Corp'); await k.press('Escape'); await page.click('[data-c="theme-builder"]');
  await page.click('[data-menu="Insert"]'); await page.click('.menu-item >> text=Slide numbers…'); await page.check('#gs-num [name=on][value="1"]'); await page.click('.modal-foot .btn-primary');
  const d = await untilSaved(page, id, 'slides', (x) => x.slides[0].bgGrad && x.custom?.accent === '#ff0066' && x.master?.items?.length === 1 && x.num?.on, 'background, theme, master and slide numbers');
  await expect(page.locator('.gs-canvas .sl-num')).toHaveText('1'); expect(d.master.items[0].html).toContain('ACME');
  errs.check();
});

test('motion and presenting: animations, transitions, skip, laser, black screen, go to slide, auto-play', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page);
  const id = await createNote(page, { title: 'Motion', kind: 'slides', block: 'slides', data: { slides: [
    { id: 's1', items: [{ id: 'title', t: 'text', x: 60, y: 40, w: 840, h: 80, html: 'Results' }, { id: 'box', t: 'shape', shape: 'round', x: 100, y: 200, w: 200, h: 120, fill: '#4285f4' }, { id: 'txt', t: 'text', x: 400, y: 220, w: 400, h: 80, html: 'Growth up 12%' }] },
    { id: 's2', items: [{ id: 't2', t: 'text', x: 60, y: 40, w: 800, h: 80, html: 'Hidden slide' }] }, { id: 's3', items: [{ id: 't3', t: 'text', x: 60, y: 40, w: 800, h: 80, html: 'Next steps' }] }] } });
  await openNote(page, id); await expect(page.locator('.gs-film .deck-thumb')).toHaveCount(3); const k = page.keyboard;
  await page.locator('.gs-canvas .sl-item[data-id="box"]').click(); await page.click('[data-c="animate"]');
  await page.locator('.gs-canvas .sl-item[data-id="txt"]').click(); await page.click('.gs-panel [data-pc="animate"]');
  await page.locator('.gs-anim-row.on [data-af="fx"]').selectOption('flyInLeft'); await page.locator('.gs-anim-row.on [data-af="start"]').selectOption('after');
  await page.locator('.gs-panel [data-mt="type"]').selectOption('slideRight'); await page.click('.gs-panel [data-pc="tr-all"]');
  await page.locator('.gs-film .deck-thumb').nth(1).click(); await page.click('[data-menu="Slide"]'); await page.click('.menu-item >> text=Skip slide');
  await untilSaved(page, id, 'slides', (d) => d.slides[0].anims?.length === 2 && d.slides[0].anims[1].start === 'after' && d.slides.every((s) => s.tr?.type === 'slideRight') && d.slides[1].skip, 'animations, transitions and skip saved');
  await page.locator('.gs-film .deck-thumb').nth(0).click(); await page.click('[data-c="present"]');
  const vis = (itemId) => page.locator(`.deck-present-stage:last-child .sl-item[data-id="${itemId}"]`);
  await expect(vis('box')).toBeHidden(); await expect(vis('txt')).toBeHidden(); await expect(page.locator('.deck-count')).toHaveText('1 / 2');
  await k.press('ArrowRight'); await expect(vis('box')).toBeVisible(); await expect(vis('txt')).toBeVisible();
  await k.press('ArrowRight'); await expect(page.locator('.deck-present-stage.incoming')).toHaveCount(1); // transition running
  await expect(page.locator('.deck-present-stage:last-child .sl-rich').first()).toHaveText('Next steps'); // the skipped slide is passed over
  await k.press('ArrowLeft'); await expect(vis('box')).toBeVisible(); // going back: fully built
  await k.press('l'); await expect(page.locator('.deck-present')).toHaveClass(/laser-on/); await k.press('l');
  await k.press('b'); await expect(page.locator('.deck-blank')).toBeVisible(); await k.press('x'); await expect(page.locator('.deck-blank')).toBeHidden();
  await k.type('2'); await expect(page.locator('.deck-goto')).toHaveText('Go to slide 2'); await k.press('Enter'); await expect(page.locator('.deck-present-stage:last-child .sl-rich').first()).toHaveText('Hidden slide');
  await page.click('[data-p="options"]'); await page.click('.menu-item >> text=Every 2 seconds');
  await expect(page.locator('.deck-present-stage:last-child .sl-rich').first()).toHaveText('Next steps', { timeout: 4000 });
  await expect(page.locator('.deck-end')).toBeVisible({ timeout: 4000 }); await k.press('Escape'); await expect(page.locator('.deck-present')).toHaveCount(0);
  errs.check();
});

test('files: PowerPoint export and import, PDF, pictures, text, import slides, linked charts', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page);
  const other = await createNote(page, { title: 'Old deck', kind: 'slides', block: 'slides', data: { theme: 'dark', slides: [1, 2, 3].map((n) => ({ items: [{ t: 'text', x: 60, y: 60, w: 800, h: 80, html: `Old slide ${n}` }] })) } });
  const sheet = await createNote(page, { title: 'Sales data', kind: 'sheet', block: 'sheet', data: { sheets: [{ name: 'Q1', cells: { A1: { v: 'Month' }, B1: { v: 'Sales' }, A2: { v: 'Jan' }, B2: { v: '10' }, A3: { v: 'Feb' }, B3: { v: '14' } } }] } });
  const id = await createNote(page, { title: 'Deck', kind: 'slides', block: 'slides', data: { slides: [{ items: [{ t: 'text', x: 60, y: 40, w: 840, h: 80, html: 'Team update', rot: 15 }] }, { items: [{ t: 'text', x: 60, y: 40, w: 840, h: 80, html: 'Agenda' }] }] } });
  void other; await openNote(page, id); await expect(page.locator('.gs-film .deck-thumb')).toHaveCount(2);
  const download = async (label) => { await page.click('[data-menu="File"]'); const dl = page.waitForEvent('download'); await page.click(`.menu-item >> text=${label}`); const d = await dl; return { name: d.suggestedFilename(), data: fs.readFileSync(await d.path()), path: await d.path() }; };
  const pptx = await download('Download as PowerPoint (.pptx)'); expect(pptx.data.subarray(0, 2).toString()).toBe('PK');
  const copy = path.join(os.tmpdir(), `deck-${Date.now()}.pptx`); fs.copyFileSync(pptx.path, copy);
  await page.setInputFiles('.deck-file', copy); await page.click('.modal-foot .btn-primary'); await expect(page.locator('.toast').last()).toContainText('Imported 2 slides');
  expect((await items(page, id)).find((x) => /Team update/.test(x.html || '')).rot).toBe(15);
  expect((await download('Download this slide as PNG')).data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect((await download('Download this slide as SVG')).data.toString()).toContain('foreignObject');
  expect((await download('Download text (.txt)')).data.toString()).toContain('Team update');
  await page.evaluate(() => { window.print = () => { window.__pages = document.querySelectorAll('#print-root .print-deck-page').length; }; });
  await page.click('[data-menu="File"]'); await page.click('.menu-item >> text=Download as PDF / print'); await expect.poll(() => page.evaluate(() => window.__pages || 0)).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.click('[data-menu="File"]'); await page.click('.menu-item >> text=Import slides from another presentation…');
  await expect(page.locator('.gs-import-slides input')).toHaveCount(3); await page.locator('.gs-import-slides input').nth(2).check(); await page.click('.modal-foot .btn-primary');
  await untilSaved(page, id, 'slides', (d) => d.slides.length === 3 && /Old slide 3/.test(d.slides[1].items[0].html) && d.slides[1].bg === '#1f1e1d', 'imported with its theme background');
  await page.locator('.gs-film .deck-thumb').nth(0).click(); await page.click('[data-menu="Insert"]'); await page.click('.menu-item >> text=Chart from a spreadsheet…');
  await expect(page.locator('#gs-lc [name=r]')).toHaveValue('A1:B3'); await page.click('.modal-foot .btn-primary');
  const ch = (await untilSaved(page, id, 'slides', (d) => d.slides[0].items.some((x) => x.t === 'chart'), 'linked chart')).slides[0].items.find((x) => x.t === 'chart');
  expect(ch.spec.series[0].v).toEqual([10, 14]); expect(ch.link.noteId).toBe(sheet);
  const wb = await saved(page, sheet, 'sheet'); wb.sheets[0].cells.B3 = { v: '40' };
  await page.evaluate(([n, c]) => fetch(`/api/notes/${n}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workspace' }, body: JSON.stringify({ content: c }) }), [sheet, `[[sheet:${Buffer.from(JSON.stringify(wb)).toString('base64url')}]]`]);
  await page.locator('.gs-film .deck-thumb').nth(1).click(); await page.locator('.gs-film .deck-thumb').nth(0).click();
  await page.locator('.gs-chart-update').click({ timeout: 15000 });
  await untilSaved(page, id, 'slides', (d) => d.slides[0].items.find((x) => x.t === 'chart').spec.series[0].v[1] === 40, 'chart updated from the spreadsheet');
  const popup = page.waitForEvent('popup'); await page.click('[data-c="present-menu"]'); await page.click('.menu-item >> text=Presenter view'); expect(await popup).toBeTruthy();
  errs.check();
});
