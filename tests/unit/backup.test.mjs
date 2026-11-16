// Backups: a checked copy of the database and files; keeping the newest; restoring (and undoing a restore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createRequire } from 'node:module';
import { makeBackup, listBackups, restoreBackup, checkDatabase } from '../../src/backup.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../../src/db.js');

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-bk-')); const filesDir = path.join(dataDir, 'files'); fs.mkdirSync(filesDir);
  const db = openDatabase(path.join(dataDir, 'app.db'));
  return { dataDir, filesDir, db };
}
const addUser = (db) => db.createUser?.({ username: `u${Math.random().toString(36).slice(2, 8)}`, name: 'T', password: 'password123' });

test('a backup is a checked copy of the database and every file', async () => {
  const { dataDir, filesDir, db } = setup();
  fs.writeFileSync(path.join(filesDir, 'a1'), 'hello'); fs.writeFileSync(path.join(filesDir, 'b2'), 'world');
  const m = await makeBackup({ db, dataDir, filesDir });
  assert.equal(m.ok, true); assert.equal(m.files, 2);
  const b = listBackups(dataDir)[0];
  assert.equal(fs.readFileSync(path.join(b.dir, 'files', 'a1'), 'utf8'), 'hello');
  assert.equal(checkDatabase(path.join(b.dir, 'app.db')).ok, true);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'backups')).filter((n) => n.endsWith('.tmp')), []);
});

test('only the newest backups are kept', async () => {
  const { dataDir, filesDir, db } = setup();
  for (let i = 0; i < 4; i++) await makeBackup({ db, dataDir, filesDir, keep: 2 });
  assert.equal(listBackups(dataDir).length, 2);
});

test('restore brings back the database and files, and keeps the replaced data aside', async () => {
  const { dataDir, filesDir, db } = setup();
  addUser(db); fs.writeFileSync(path.join(filesDir, 'keep'), 'original');
  await makeBackup({ db, dataDir, filesDir });
  const before = checkDatabase(path.join(dataDir, 'app.db'));
  addUser(db); fs.rmSync(path.join(filesDir, 'keep')); fs.writeFileSync(path.join(filesDir, 'new'), 'x'); // later changes: as in the app, files are only added or deleted, never rewritten
  db.close?.();
  const r = restoreBackup({ dataDir, name: 'latest', log: {} });
  assert.equal(checkDatabase(path.join(dataDir, 'app.db')).users, before.users);
  assert.equal(fs.readFileSync(path.join(filesDir, 'keep'), 'utf8'), 'original'); // the deleted file is back
  assert.equal(fs.existsSync(path.join(filesDir, 'new')), false);
  assert.equal(fs.readFileSync(path.join(r.aside, 'files', 'new'), 'utf8'), 'x'); // undo is possible
});

test('a damaged backup is refused', async () => {
  const { dataDir, filesDir, db } = setup();
  await makeBackup({ db, dataDir, filesDir });
  const b = listBackups(dataDir)[0]; const f = path.join(b.dir, 'app.db');
  const buf = fs.readFileSync(f); buf.fill(0x41, 100, Math.min(buf.length, 8192)); fs.writeFileSync(f, buf); // corrupt it
  assert.throws(() => restoreBackup({ dataDir, name: b.name, log: {} }), /damaged|malformed|not a database/i);
  assert.equal(fs.existsSync(path.join(dataDir, 'app.db')), true); // current data untouched
});

test('deleting a live file leaves its backup copy intact (backups hard-link files)', async () => {
  const { dataDir, filesDir, db } = setup();
  fs.writeFileSync(path.join(filesDir, 'pic'), 'picture data');
  await makeBackup({ db, dataDir, filesDir });
  fs.rmSync(path.join(filesDir, 'pic'));
  assert.equal(fs.readFileSync(path.join(listBackups(dataDir)[0].dir, 'files', 'pic'), 'utf8'), 'picture data');
});

test('"Download everything": readable copies and file references inside blocks', async () => {
  const { readableMarkdown, remapFiles } = await import('../../src/export-all.mjs');
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const md = readableMarkdown(`Budget:\n\n[[sheet:${enc({ sheets: [{ name: 'Q1', cells: { A1: { v: 'Item' }, B1: { v: 'Cost' }, A2: { v: 'Rent' }, B2: { v: '=1000+500' } } }] })}]]\n\n[[slides:${enc({ slides: [{ items: [{ t: 'text', x: 0, y: 0, w: 10, h: 10, html: 'Team update' }] }] })}]]`);
  assert.match(md, /\| Item \| Cost \|/); assert.match(md, /\| Rent \| 1500 \|/); assert.match(md, /\*\*Slide 1\*\*\n\nTeam update/);
  const old = '11111111-1111-1111-1111-111111111111', neu = '22222222-2222-2222-2222-222222222222';
  const content = `![pic](/api/files/${old}) [[slides:${enc({ slides: [{ items: [{ t: 'image', src: `/api/files/${old}`, x: 0, y: 0, w: 10, h: 10 }] }] })}]]`;
  const out = remapFiles(content, new Map([[old, neu]]));
  assert.ok(!out.includes(old)); assert.match(out, new RegExp(`/api/files/${neu}`));
  const deck = JSON.parse(Buffer.from(/\[\[slides:([A-Za-z0-9_-]+)/.exec(out)[1], 'base64url').toString());
  assert.equal(deck.slides[0].items[0].src, `/api/files/${neu}`);
});
