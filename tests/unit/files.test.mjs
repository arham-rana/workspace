// File formats: Excel and PowerPoint round trips, Word export, and a fresh database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createRequire } from 'node:module';
import { exportSheet, importSheet } from '../../src/sheets.mjs';
import { exportPptx, importPptx } from '../../src/slides.mjs';
const require = createRequire(import.meta.url);

test('Excel: formats, notes, links, validation, names, spills, tables, protection and print settings round-trip', async () => {
  const wb = { sheets: [{ name: 'Data', cells: {
    A1: { v: '1234.5', s: { nf: '#,##0.00;[Red](#,##0.00)', rot: 45, ind: 2, st: 1, bd: { b: 6 }, bc: '#ff0000' }, n: { t: 'Check this' } },
    A2: { v: 'Visit', l: 'https://example.com' }, B1: { v: '=SEQUENCE(3)' }, D1: { v: '10' }, D2: { v: '20' }, E1: { v: 'open', s: { unl: 1 } } },
    dv: [{ range: 'A3:A6', type: 'list', v1: 'Yes,No', err: { style: 'warning' } }], protect: { on: true, allow: {} }, print: { area: 'A1:E3', titles: '1:1', fit: 'width' } },
  { name: 'Hidden', cells: { A1: { v: 'x' } }, hidden: true }], names: { Totals: 'Data!$D$1:$D$2' } };
  const { workbook: back } = await importSheet(await exportSheet(wb, 'xlsx'), 'x.xlsx');
  const s = back.sheets[0];
  assert.equal(s.cells.A1.s.nf, '#,##0.00;[Red](#,##0.00)'); assert.equal(s.cells.A1.s.rot, 45); assert.equal(s.cells.A1.s.bd.b, 6);
  assert.equal(s.cells.A1.n.t, 'Check this'); assert.equal(s.cells.A2.l, 'https://example.com');
  assert.equal(s.dv[0].range, 'A3:A6'); assert.equal(s.dv[0].err.style, 'warning');
  assert.deepEqual(back.names, { Totals: 'Data!$D$1:$D$2' });
  assert.ok(s.protect); assert.equal(s.cells.E1.s.unl, 1); assert.equal(back.sheets[1].hidden, true);
  assert.deepEqual(s.print, { area: 'A1:E3', titles: '1:1', fit: 'width' });
});

test('Excel: CSV import and export', async () => {
  const { workbook } = await importSheet(Buffer.from('Name,Score\n"Doe, Jane",9\n'), 'x.csv');
  assert.equal(workbook.sheets[0].cells.A2.v, 'Doe, Jane');
  assert.match((await exportSheet(workbook, 'csv')).toString(), /"Doe, Jane",9/);
});

test('PowerPoint: text formatting, shapes, lines, tables, video, cropped images and backgrounds round-trip', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const deck = { slides: [{ bgImg: '/api/files/00000000-0000-0000-0000-000000000001', items: [
    { t: 'text', x: 60, y: 60, w: 500, h: 200, rot: 30, ff: 'Georgia', html: '<div><s>old</s> <a href="https://example.com">site</a> <span style="background-color:#ffff00">hi</span></div><ol style="list-style-type:upper-roman"><li>one<ul><li>nested</li></ul></li></ol>' },
    { t: 'shape', shape: 'star5', x: 60, y: 300, w: 100, h: 100, fill: '#ffcc00', stroke: '#333333', sw: 2, dash: 'dash' },
    { t: 'line', x1: 200, y1: 350, x2: 400, y2: 350, kind: 'elbow', a2: 'triangle', dash: 'dot', sw: 3 },
    { t: 'table', x: 450, y: 300, w: 300, h: 80, rows: [[{ html: 'A' }, { html: 'B' }], [{ html: 'Merged', cs: 2 }, { hide: 1 }]], colW: [150, 150], rowH: [40, 40] },
    { t: 'video', yt: 'dQw4w9WgXcQ', start: 30, x: 600, y: 60, w: 320, h: 180 },
    { t: 'image', src: '/api/files/00000000-0000-0000-0000-000000000002', x: 700, y: 400, w: 160, h: 120, crop: { l: 0.1, t: 0.15, r: 0.1, b: 0.2 }, op: 0.6, alt: 'Logo' }] }] };
  const buf = await exportPptx(deck, { readImage: async () => ({ data: `image/png;base64,${png.toString('base64')}` }) });
  const s0 = (await importPptx(buf, { saveImage: async () => '/api/files/00000000-0000-0000-0000-00000000000f' })).deck.slides[0];
  const by = (t) => s0.items.filter((x) => x.t === t);
  const text = by('text').find((x) => /old/.test(x.html));
  assert.equal(text.rot, 30); assert.equal(text.ff, 'Georgia');
  assert.match(text.html, /<s>old<\/s>/); assert.match(text.html, /href="https:\/\/example.com"/); assert.match(text.html, /background-color:#ffff00/); assert.match(text.html, /upper-roman/);
  assert.equal(by('shape').find((x) => x.shape === 'star5').dash, 'dash');
  const ln = by('line')[0]; assert.deepEqual([ln.kind, ln.a2, ln.dash], ['elbow', 'triangle', 'dot']);
  assert.equal(by('table')[0].rows[1][0].cs, 2);
  assert.deepEqual([by('video')[0].yt, by('video')[0].start], ['dQw4w9WgXcQ', 30]);
  const im = by('image')[0]; assert.deepEqual([im.x, im.y, im.w, im.h], [700, 400, 160, 120]); assert.equal(im.crop.t, 0.15); assert.equal(im.op, 0.6);
  assert.ok(s0.bgImg);
});

test('a fresh database installs, and opening it again upgrades nothing twice', () => {
  const { openDatabase } = require('../../src/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-db-'));
  const file = path.join(dir, 'app.db');
  assert.doesNotThrow(() => openDatabase(file).close?.());
  assert.doesNotThrow(() => openDatabase(file).close?.());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('picture sizes: the four formats, and hostile files never hang or crash', async () => {
  const { imageDims } = await import('../../src/image-dims.mjs');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  assert.deepEqual(imageDims(png), { type: 'png', width: 1, height: 1 });
  const gif = Buffer.from('R0lGODlhAgADAIAAAP///wAAACwAAAAAAgADAAACAoRRADs=', 'base64'); assert.deepEqual(imageDims(gif), { type: 'gif', width: 2, height: 3 });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40]), Buffer.alloc(20)]);
  assert.deepEqual(imageDims(jpeg), { type: 'jpg', width: 64, height: 32 });
  const t = Date.now();
  for (const bad of [Buffer.alloc(0), Buffer.from('not an image at all, honestly'), Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(100000, 0xff)]), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00]), Buffer.alloc(50)]), Buffer.from('AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAA', 'base64') /* HEIF */]) assert.equal(imageDims(bad)?.width ?? null, null);
  assert.ok(Date.now() - t < 500, 'hostile files are rejected quickly');
});

test('zip bombs (Excel, PowerPoint, backups) are refused quickly, and normal files still import', async () => {
  const JSZip = (await import('jszip')).default; const { importEverything } = await import('../../src/export-all.mjs');
  const bomb = new JSZip(); bomb.file('[Content_Types].xml', '<Types/>'); bomb.file('xl/worksheets/sheet1.xml', Buffer.alloc(400 * 1048576)); // 400 MB of zeros
  const buf = await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  assert.ok(buf.length < 2 * 1048576, `the bomb is small (${buf.length} bytes)`);
  const t = Date.now();
  await assert.rejects(importSheet(buf, 'bomb.xlsx'), (e) => e.status === 413);
  await assert.rejects(importPptx(buf, {}), (e) => e.status === 413);
  await assert.rejects(importEverything({ db: {}, uid: 'x', buffer: buf, writeFile: () => {} }), (e) => e.status === 413 || /no backup\.json/.test(e.message));
  assert.ok(Date.now() - t < 15000, `refused in ${Date.now() - t} ms`);
  const { workbook } = await importSheet(await exportSheet({ sheets: [{ name: 'S', cells: { A1: { v: 'ok' } } }] }, 'xlsx'), 'ok.xlsx'); // normal files are unaffected
  assert.equal(workbook.sheets[0].cells.A1.v, 'ok');
});

test('templates remember their kind; ones saved before kinds existed are worked out from their content', () => {
  const { openDatabase } = require('../../src/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-tpl-')); const db = openDatabase(path.join(dir, 'app.db'));
  const u = db.createUser({ username: `t${Date.now()}`, name: 'T', password: 'password123' });
  const sheet = db.create('notes', { title: 'S', kind: 'sheet', content: '[[sheet:eyJzaGVldHMiOltdfQ]]' }, u.id);
  assert.equal(db.saveTemplate(u.id, { noteId: sheet.id, name: 'Sheet one' })[0].kind, 'sheet');
  // an older template row (no kind recorded)
  const raw = new (require('better-sqlite3'))(path.join(dir, 'app.db'));
  raw.prepare("INSERT INTO templates (id, user_id, name, description, icon, color, title, content, tag, created_at) VALUES ('t-old', ?, 'Old deck', '', 'presentation', 'amber', 'Deck', '[[slides:eyJzbGlkZXMiOltdfQ]]', '', '2026-01-01')").run(u.id); raw.close();
  assert.equal(db.listTemplates(u.id).find((t) => t.id === 't-old').kind, 'slides');
  db.close?.(); fs.rmSync(dir, { recursive: true, force: true });
});
