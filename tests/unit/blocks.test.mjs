// Co-editing entries for spreadsheets and presentations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEntries, fromEntries, entryChanges, withBlockData } from '../../shared/blocks.mjs';
import { normalizeWorkbook } from '../../shared/sheet-engine.mjs';
import { normalizeDeck } from '../../shared/slides-engine.mjs';

const wb = normalizeWorkbook({ sheets: [{ name: 'A', cells: { A1: { v: '1' }, B2: { v: '=A1*2', s: { b: 1 } } } }, { name: 'B', cells: { C3: { v: 'x' } } }], names: { N: 'A!$A$1' } });
const deck = normalizeDeck({ theme: 'dark', num: { on: true }, slides: [{ id: 's1', items: [{ id: 'a', t: 'text', x: 0, y: 0, w: 10, h: 10, html: 'A', z: 2 }, { id: 'b', t: 'text', x: 0, y: 0, w: 10, h: 10, html: 'B', z: 1 }] }, { id: 's2', items: [] }] });

test('entries round-trip spreadsheets and presentations exactly', () => {
  assert.deepEqual(normalizeWorkbook(fromEntries('sheet', toEntries('sheet', wb))), wb);
  const byZ = (d) => ({ ...d, slides: d.slides.map((sl) => ({ ...sl, items: [...sl.items].sort((a, b) => a.z - b.z) })) }); // objects come back in stacking order
  assert.deepEqual(normalizeDeck(fromEntries('slides', toEntries('slides', deck))), byZ(deck));
});

test('one cell or object changed → one entry changed', () => {
  const w2 = structuredClone(wb); w2.sheets[0].cells.A1.v = '5';
  assert.deepEqual(entryChanges(toEntries('sheet', wb), toEntries('sheet', w2)), { set: { [`c:${wb.sheets[0].id}/A1`]: JSON.stringify({ v: '5' }) }, del: [] });
  const d2 = structuredClone(deck); d2.slides[0].items = d2.slides[0].items.filter((x) => x.id !== 'b');
  assert.deepEqual(entryChanges(toEntries('slides', deck), toEntries('slides', d2)).del, ['i:s1/b']);
});

test('two people’s simultaneous entries merge: both changes kept', () => {
  const base = toEntries('slides', deck);
  const mine = structuredClone(deck); mine.slides[0].items[0].html = 'A mine';
  const theirs = structuredClone(deck); theirs.slides[1].items.push({ id: 'c', t: 'text', x: 0, y: 0, w: 10, h: 10, html: 'C new', z: 1 });
  const merged = { ...base };
  for (const side of [mine, theirs]) { const { set, del } = entryChanges(base, toEntries('slides', normalizeDeck(side))); Object.assign(merged, set); del.forEach((k) => delete merged[k]); }
  const out = normalizeDeck(fromEntries('slides', merged));
  assert.equal(out.slides[0].items.find((x) => x.id === 'a').html, 'A mine');
  assert.equal(out.slides[1].items[0].html, 'C new');
});

test('a slide added while someone reordered is kept', () => {
  const e = toEntries('slides', deck);
  e['m:s3'] = JSON.stringify({ id: 's3', layout: 'blank', notes: '' }); // added by one person; another person's "order" won
  assert.deepEqual(fromEntries('slides', e).slides.map((s) => s.id), ['s1', 's2', 's3']);
});

test('documents get each block’s latest data for saving', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'slides', attrs: { bid: 'b1', data: '{"slides":[]}' } }, { type: 'sheet', attrs: { bid: 'zz', data: '{}' } }] };
  const out = withBlockData(doc, (bid) => (bid === 'b1' ? toEntries('slides', deck) : null));
  assert.equal(JSON.parse(out.content[1].attrs.data).slides.length, 2);
  assert.equal(out.content[2].attrs.data, '{}'); // no entries yet: unchanged
});

test('server: blocks get ids and entries; copies get their own; saved text has the latest data; simultaneous edits merge', async () => {
  const Y = await import('yjs'); const { prosemirrorJSONToYDoc } = await import('y-prosemirror');
  const { markdownToDoc, docToMarkdown } = await import('../../shared/convert.mjs'); const { documentSchema } = await import('../../shared/schema.mjs');
  const { ensureBlocks, liveJSON } = await import('../../src/collab.mjs');
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sheet = normalizeWorkbook({ sheets: [{ name: 'S', cells: { A1: { v: '1' } } }] });
  const md = `Intro\n\n[[sheet:${enc(sheet)}]]\n\n[[sheet:${enc(sheet)}]]`;
  const server = prosemirrorJSONToYDoc(documentSchema(), markdownToDoc(md), 'default');
  ensureBlocks(server);
  const bids = []; server.getXmlFragment('default').toArray().forEach((el) => { if (el.nodeName === 'sheet') bids.push(el.getAttribute('bid')); });
  assert.equal(bids.length, 2); assert.ok(bids[0] && bids[1] && bids[0] !== bids[1]);
  assert.equal(server.getMap('blocks').get(bids[0]).get(`c:${sheet.sheets[0].id}/A1`), JSON.stringify({ v: '1' }));
  // two people, each with their own copy of the shared document, edit different cells at the same moment
  const a = new Y.Doc(), b = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(server)); Y.applyUpdate(b, Y.encodeStateAsUpdate(server));
  const sid = sheet.sheets[0].id;
  a.getMap('blocks').get(bids[0]).set(`c:${sid}/A1`, JSON.stringify({ v: 'from A' }));
  b.getMap('blocks').get(bids[0]).set(`c:${sid}/B2`, JSON.stringify({ v: 'from B' }));
  Y.applyUpdate(server, Y.encodeStateAsUpdate(a)); Y.applyUpdate(server, Y.encodeStateAsUpdate(b));
  const out = docToMarkdown(liveJSON(server));
  const first = JSON.parse(Buffer.from(/\[\[sheet:([A-Za-z0-9_-]+)/.exec(out)[1], 'base64url').toString());
  assert.equal(first.sheets[0].cells.A1.v, 'from A'); assert.equal(first.sheets[0].cells.B2.v, 'from B'); // both kept
  // a document that comes back (restore, import) gets its blocks prepared again
  ensureBlocks(server); const again = []; server.getXmlFragment('default').toArray().forEach((el) => { if (el.nodeName === 'sheet') again.push(el.getAttribute('bid')); });
  assert.deepEqual(again, bids); // ids are stable
});

test('server: a whole-block save from a not-yet-reloaded browser is folded in, not overwritten', async () => {
  const { prosemirrorJSONToYDoc } = await import('y-prosemirror');
  const { markdownToDoc, docToMarkdown } = await import('../../shared/convert.mjs'); const { documentSchema } = await import('../../shared/schema.mjs');
  const { ensureBlocks, liveJSON, storeForTests } = await import('../../src/collab.mjs');
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sheet = normalizeWorkbook({ sheets: [{ name: 'S', cells: { A1: { v: '1' } } }] });
  const doc = prosemirrorJSONToYDoc(documentSchema(), markdownToDoc(`[[sheet:${enc(sheet)}]]`), 'default'); ensureBlocks(doc);
  storeForTests(doc); // first save: the server notes the snapshot
  const el = doc.getXmlFragment('default').toArray().find((x) => x.nodeName === 'sheet');
  const old = structuredClone(sheet); old.sheets[0].cells.A1 = { v: 'old browser' }; el.setAttribute('data', JSON.stringify(old)); // the older app writes the whole block
  storeForTests(doc);
  const saved = JSON.parse(Buffer.from(/\[\[sheet:([A-Za-z0-9_-]+)/.exec(docToMarkdown(liveJSON(doc)))[1], 'base64url').toString());
  assert.equal(saved.sheets[0].cells.A1.v, 'old browser');
});

test('the app’s change lists turn into exactly the right entry updates', async () => {
  const { sideToEntryOps } = await import('../../shared/blocks.mjs');
  const { diffBooks } = await import('../../public/js/sheet-core.js'); // must load: no silent skipping
  const { diffDecks } = await import('../../shared/slides-engine.mjs');
  const apply = (entries, ops) => { const out = { ...entries }; Object.assign(out, ops.set); for (const k of ops.del) delete out[k]; return out; };
  // presentations: edit an object, delete one, add a slide, change deck settings
  const d1 = structuredClone(deck); d1.slides[0].items[0].html = 'changed'; d1.slides[0].items.splice(1, 1); d1.slides.push({ id: 's3', layout: 'blank', notes: '', items: [{ id: 'z', t: 'text', x: 0, y: 0, w: 5, h: 5, html: 'new', z: 1 }] }); d1.custom = { accent: '#ff0000' }; d1.num = null;
  const n1 = normalizeDeck(d1); const e0 = toEntries('slides', deck);
  const ops = sideToEntryOps('slides', diffDecks(deck, n1).after, (k) => e0[k], () => Object.keys(e0));
  assert.deepEqual(normalizeDeck(fromEntries('slides', apply(e0, ops))), normalizeDeck(fromEntries('slides', toEntries('slides', n1))));
  // removing a slide removes its objects too
  const n2 = normalizeDeck({ ...structuredClone(deck), slides: [structuredClone(deck.slides[1])] });
  const ops2 = sideToEntryOps('slides', diffDecks(deck, n2).after, (k) => e0[k], () => Object.keys(e0));
  assert.ok(ops2.del.includes('i:s1/a') && ops2.del.includes('m:s1'));
  { // spreadsheets (diffBooks lives with the app's spreadsheet code)
    const w1 = structuredClone(wb); w1.sheets[0].cells.A1 = { v: '9' }; delete w1.sheets[0].cells.B2; w1.sheets[1].name = 'Renamed'; w1.names = { N: 'A!$A$1', M: 'A!$B$1' };
    const nw = normalizeWorkbook(w1); const s0 = toEntries('sheet', wb);
    const opsS = sideToEntryOps('sheet', diffBooks(wb, nw).after, (k) => s0[k], () => Object.keys(s0));
    assert.deepEqual(normalizeWorkbook(fromEntries('sheet', apply(s0, opsS))), nw);
  }
});
