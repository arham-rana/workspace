// What changed between versions: documents, spreadsheets, presentations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../shared/sheet-engine.mjs';
import * as S from '../../shared/slides-engine.mjs';
import { diffWords, diffDocument, diffWorkbooks, diffDecks } from '../../shared/diff.mjs';

test('words: additions and deletions inside a sentence', () => {
  assert.deepEqual(diffWords('The quick brown fox', 'The slow brown fox jumps'), [{ op: 'same', text: 'The ' }, { op: 'del', text: 'quick' }, { op: 'add', text: 'slow' }, { op: 'same', text: ' brown fox' }, { op: 'add', text: ' jumps' }]);
});

test('documents: unchanged, added, removed and edited paragraphs', () => {
  const d = diffDocument('# Plan\n\nKeep this.\n\nOld paragraph here.\n\nRemove me.', '# Plan\n\nKeep this.\n\nNew paragraph here.\n\nAdded at the end.');
  assert.deepEqual(d.map((x) => x.op), ['same', 'same', 'edit', 'edit']);
  assert.equal(d[2].before, 'Old paragraph here.'); assert.equal(d[2].text, 'New paragraph here.');
  const d2 = diffDocument('A\n\nB', 'A\n\nB\n\nC'); assert.deepEqual(d2.map((x) => x.op), ['same', 'same', 'add']);
  const d3 = diffDocument('A\n\nB\n\nC', 'A\n\nC'); assert.deepEqual(d3.map((x) => x.op), ['same', 'del', 'same']);
});

test('spreadsheets: changed, added, removed and formatted cells; sheets added, renamed, removed', () => {
  const a = { sheets: [{ id: 's1', name: 'Q1', cells: { A1: { v: '1' }, B1: { v: '=A1*2' }, C1: { v: 'x' }, D1: { v: '5' } } }, { id: 's2', name: 'Old', cells: {} }] };
  const b = { sheets: [{ id: 's1', name: 'Quarter 1', cells: { A1: { v: '2' }, B1: { v: '=A1*2' }, D1: { v: '5', s: { b: 1 } }, E1: { v: 'new' } } }, { id: 's3', name: 'Extra', cells: {} }] };
  const d = diffWorkbooks(E, a, b);
  assert.equal(d.count, 4);
  const q = d.sheets.find((s) => s.name === 'Quarter 1');
  assert.equal(q.status, 'renamed from “Q1”');
  assert.deepEqual(q.cells.map((c) => `${c.cell}:${c.before}→${c.after}${c.format ? ' (format)' : ''}`), ['A1:1→2', 'C1:x→', 'D1:5→5 (format)', 'E1:→new']);
  assert.deepEqual(d.sheets.filter((s) => s.status === 'added' || s.status === 'removed').map((s) => `${s.name}:${s.status}`), ['Extra:added', 'Old:removed']);
});

test('presentations: slides added, removed, moved; objects added, edited, removed', () => {
  const a = { slides: [{ id: 'a', items: [{ id: 't', t: 'text', x: 0, y: 0, w: 10, h: 10, html: 'Hello' }, { id: 'p', t: 'shape', x: 0, y: 0, w: 10, h: 10 }] }, { id: 'b', items: [] }, { id: 'c', items: [] }] };
  const b = { slides: [{ id: 'b', items: [] }, { id: 'a', items: [{ id: 't', t: 'text', x: 0, y: 0, w: 10, h: 10, html: 'Hello world' }, { id: 'n', t: 'image', src: '/api/files/00000000-0000-0000-0000-000000000000', x: 0, y: 0, w: 5, h: 5 }] }, { id: 'd', items: [] }] };
  const d = diffDecks(S, a, b); const by = (id) => d.slides.find((s) => s.id === id);
  assert.equal(by('d').status, 'added'); assert.equal(by('c').status, 'removed'); assert.equal(by('b').status, 'moved');
  assert.equal(by('a').status, 'changed');
  assert.deepEqual(by('a').changes.map((c) => `${c.op}:${c.what}`), ['edit:Text box', 'add:Picture', 'del:Shape']);
  assert.equal(by('a').changes[0].before, 'Hello'); assert.equal(by('a').changes[0].text, 'Hello world');
});

test('search: inside spreadsheets, presentations, embedded blocks and uploads; where it was found', async () => {
  const { fileMatches, findInFile } = await import('../../shared/search.mjs');
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sheet = { id: 'n1', kind: 'sheet', title: 'Budget', updatedAt: '1', content: `[[sheet:${enc({ sheets: [{ id: 's1', name: 'Q1', cells: { A1: { v: 'Rent' }, B1: { v: '1500' } } }] })}]]` };
  assert.deepEqual(findInFile(sheet, '1500'), { label: 'Q1!B1', snippet: '1500', goto: { type: 'cell', sheet: 's1', cell: 'B1' } });
  const deck = { id: 'n2', kind: 'slides', title: 'Deck', updatedAt: '1', content: `[[slides:${enc({ slides: [{ id: 'a', items: [] }, { id: 'b', notes: 'Mention the hiring plan', items: [{ id: 't', t: 'text', html: '<p>Quarterly <b>results</b></p>' }] }] })}]]` };
  assert.equal(findInFile(deck, 'quarterly results').label, 'Slide 2'); assert.deepEqual(findInFile(deck, 'quarterly results').goto, { type: 'item', slide: 'b', item: 't' });
  assert.equal(findInFile(deck, 'hiring').label, 'Slide 2 notes');
  const doc = { id: 'n3', kind: 'note', title: 'Report', updatedAt: '1', content: `Intro text.\n\n[[sheet:${enc({ sheets: [{ id: 's', name: 'Data', cells: { C3: { v: 'Widgets' } } }] })}]]` };
  assert.ok(fileMatches(doc, 'widgets')); assert.equal(findInFile(doc, 'widgets').goto, null); // inside a document: opens the document
  assert.equal(fileMatches(doc, 'sheet:'), false); // the stored data itself isn't searchable
  const up = { id: 'n4', kind: 'upload', title: 'scan.pdf', updatedAt: '1', content: `[[upload:${enc({ src: '/api/files/x', name: 'scan.pdf' })}]]` };
  assert.ok(fileMatches(up, 'scan'));
  assert.equal(findInFile(sheet, 'budget').label, ''); // the title comes first
});
