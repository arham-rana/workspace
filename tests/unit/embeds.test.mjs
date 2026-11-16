// Files embedded in documents and slides: references, parts, previews, and resolving with access checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../shared/sheet-engine.mjs';
import { cleanRef, sheetRange, deckSlide, withoutFileLinks, plainOf, encodeData, blockOf } from '../../shared/embeds.mjs';
import { resolveEmbeds, fileItemSnapshot } from '../../src/embeds.mjs';

const ID = '11111111-1111-4111-8111-111111111111', SECRET = '22222222-2222-4222-8222-222222222222';
test('references are cleaned; malformed ones are rejected', () => {
  assert.equal(cleanRef({ id: 'not-an-id' }), null);
  assert.deepEqual(cleanRef({ id: ID, kind: 'sheet', title: 'T', part: { sheet: 'Q1', range: 'a1:c3' } }).part, { sheet: 'Q1', range: 'A1:C3' });
  assert.equal(cleanRef({ id: ID, kind: 'sheet', title: 'T', part: { sheet: 'Q1', range: 'a1:c3);alert(1)' } }).part, undefined); // not a range: the whole sheet
  assert.equal(cleanRef({ id: ID, kind: 'evil' }).kind, 'note');
});

test('a spreadsheet range becomes values with formatting (formulas would point outside it)', () => {
  const d = { sheets: [{ name: 'Q1', cells: { A1: { v: '5' }, B1: { v: '=A1*2', s: { b: 1 } }, C3: { v: 'far' } } }] };
  const part = sheetRange(E, d, { sheet: 'Q1', range: 'B1:C3' });
  assert.deepEqual(part.sheets[0].cells.A1, { v: '10', s: { b: 1 } }); // B1 → A1, value not formula
  assert.equal(part.sheets[0].cells.B3.v, 'far');
});

test('one slide; previews never embed further files', () => {
  assert.deepEqual(deckSlide({ theme: 'dark', slides: [{ id: 'a' }, { id: 'b' }] }, { slide: 'b' }), { theme: 'dark', slides: [{ id: 'b' }] });
  const md = `Intro\n\n[[file:${encodeData({ id: ID, kind: 'sheet', title: 'Budget' })}]]\n\nEnd`;
  assert.equal(withoutFileLinks(md), 'Intro\n\n*Spreadsheet: Budget*\n\nEnd');
  assert.equal(plainOf('## Title\n\n- [x] done **bold**'), 'Title\n\n• done bold');
});

test('server: links resolve to snapshots for files you can open, and "not available" otherwise', () => {
  const files = { [ID]: { id: ID, title: 'Budget', kind: 'sheet', content: `[[sheet:${encodeData({ sheets: [{ name: 'S', cells: { A1: { v: '7' } } }] })}]]` }, [SECRET]: { id: SECRET, title: 'Secret plans', kind: 'note', content: 'launch date' } };
  const db = { get: (k, id, uid) => (id === SECRET && uid !== 'owner' ? null : files[id] || null) };
  const content = `[[file:${encodeData({ id: ID, kind: 'sheet', title: 'Budget' })}]]\n\n[[file:${encodeData({ id: SECRET, kind: 'note', title: 'Secret plans' })}]]`;
  const out = resolveEmbeds({ db, collab: null }, content, 'someone');
  assert.match(out, /\*\*Spreadsheet: Budget\*\*/); assert.equal(blockOf(out, 'sheet').sheets[0].cells.A1.v, '7');
  assert.match(out, /Secret plans \(not available to you\)/); assert.doesNotMatch(out, /launch date/);
  const snap = fileItemSnapshot({ db, collab: null }, { id: 'x', t: 'file', ref: { id: ID, kind: 'sheet', title: 'Budget' }, x: 0, y: 0, w: 200, h: 100 }, 'someone');
  assert.equal(snap.t, 'table'); assert.equal(snap.rows[0][0].html, '7');
});

test('links between files: the new #/files/ form and old #/documents/ links both survive saving', async () => {
  const { markdownToDoc, docToMarkdown } = await import('../../shared/convert.mjs');
  const md = `[New](#/files/${ID}) and [Old](#/documents/${SECRET})`;
  const out = docToMarkdown(markdownToDoc(md));
  assert.match(out, new RegExp(`\\[New\\]\\(#/files/${ID}\\)`)); assert.match(out, new RegExp(`\\[Old\\]\\(#/documents/${SECRET}\\)`));
});
