// Presentation engine: safe text, items, deck settings, co-editing merges, layouts, connectors, animations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../shared/slides-engine.mjs';

test('safe rich text keeps formatting and removes anything dangerous', () => {
  const out = S.sanitizeHtml('<s>a</s><sup>2</sup><a href="https://x.org" onclick="evil()">ok</a><a href="javascript:alert(1)">bad</a><img src=x onerror=alert(1)><script>alert(1)</script><span style="background-color:#ffff00;font-family:Georgia;position:fixed">hi</span>');
  assert.match(out, /<s>a<\/s><sup>2<\/sup>/); assert.match(out, /<a href="https:\/\/x.org">ok<\/a>/);
  assert.doesNotMatch(out, /onclick|javascript|<img|<script|position/i);
  assert.match(out, /background-color:#ffff00/);
});

test('reading text runs: background colour is not text colour', () => {
  const runs = S.htmlToParagraphs('<span style="background-color:#ffff00">hi</span>')[0].runs;
  assert.equal(runs[0].color ?? null, null); assert.equal(runs[0].highlight, '#ffff00');
});

test('items: old lines become real lines; tables, video, word art and image settings are kept', () => {
  const d = S.normalizeDeck({ slides: [{ items: [
    { t: 'shape', shape: 'line', x: 10, y: 100, w: 200, h: 20 },
    { t: 'table', x: 0, y: 0, w: 300, h: 80, rows: [[{ html: 'A' }, { html: 'B' }], [{ html: '1', cs: 2 }, { hide: 1 }]] },
    { t: 'video', yt: 'dQw4w9WgXcQ', x: 0, y: 0, w: 320, h: 180 }, { t: 'video', yt: 'not-valid', x: 0, y: 0, w: 1, h: 1 },
    { t: 'wordart', text: 'Hi', x: 0, y: 0, w: 100, h: 40 },
    { t: 'image', src: '/api/files/00000000-0000-0000-0000-000000000000', x: 0, y: 0, w: 10, h: 10, crop: { l: 0.1, r: 0.1 }, mask: 'ellipse', rc: 'gray' },
    { t: 'image', src: 'https://evil.example/x.png', x: 0, y: 0, w: 10, h: 10 }] }] });
  const it = d.slides[0].items;
  assert.deepEqual(it.map((x) => x.t), ['line', 'table', 'video', 'wordart', 'image']);
  assert.deepEqual([it[0].x1, it[0].y1, it[0].x2, it[0].y2], [10, 110, 210, 110]);
  assert.equal(it[1].rows[1][0].cs, 2); assert.equal(it[4].mask, 'ellipse');
});

test('deck-wide settings travel through co-editing changes', () => {
  const d = S.normalizeDeck({ custom: { accent: '#ff6600' }, slides: [{ id: 'a', items: [] }] });
  const d2 = structuredClone(d); d2.custom.accent = '#00aa00'; d2.num = { on: true }; d2.slides[0].tr = { type: 'fade', dur: 0.5 };
  const diff = S.diffDecks(d, d2); assert.ok(diff);
  const merged = S.applyDeckSide(d, diff.after);
  assert.equal(S.themeOf(merged).accent, '#00aa00'); assert.equal(merged.num.on, true); assert.equal(merged.slides[0].tr.type, 'fade');
});

test('merging keeps both people’s edits to different objects', () => {
  const base = S.normalizeDeck({ slides: [{ id: 's', items: [{ id: 'a', t: 'text', x: 0, y: 0, w: 10, h: 10, html: 'A' }, { id: 'b', t: 'text', x: 0, y: 0, w: 10, h: 10, html: 'B' }] }] });
  const mine = structuredClone(base); mine.slides[0].items[0].html = 'A mine';
  const theirs = structuredClone(base); theirs.slides[0].items[1].html = 'B theirs';
  const merged = S.applyDeckSide(theirs, S.diffDecks(base, mine).after);
  assert.deepEqual(merged.slides[0].items.map((x) => x.html), ['A mine', 'B theirs']);
});

test('apply layout keeps the slide’s text; connectors follow their shapes', () => {
  const sl = S.applyLayout({ id: 'x', layout: 'title', items: [{ id: 't1', t: 'text', role: 'title', html: 'My title', x: 0, y: 0, w: 10, h: 10 }] }, 'titleBody');
  assert.equal(sl.items.find((x) => x.role === 'title').html, 'My title');
  const routed = S.routeLines([{ id: 's1', t: 'shape', x: 0, y: 0, w: 100, h: 50 }, { id: 'l', t: 'line', x1: 0, y1: 0, x2: 300, y2: 300, from: { id: 's1', site: 'e' } }]);
  assert.deepEqual([routed[1].x1, routed[1].y1], [100, 25]);
});

test('animation steps: with/after join the current step, on click starts a new one', () => {
  const s = S.normalizeDeck({ slides: [{ id: 'a', items: [{ id: 't', t: 'text', x: 0, y: 0, w: 1, h: 1, html: 'x' }, { id: 'c', t: 'shape', x: 0, y: 0, w: 1, h: 1 }], anims: [{ item: 't', fx: 'fadeIn', start: 'with' }, { item: 'c', fx: 'flyInLeft' }, { item: 't', fx: 'spin', start: 'after' }, { item: 'gone', fx: 'fadeIn' }] }] }).slides[0];
  assert.deepEqual(S.animationSteps(s).map((st) => st.map((a) => `${a.item}:${a.fx}`)), [['t:fadeIn'], ['c:flyInLeft', 't:spin']]);
});

test('every shape draws a path', () => {
  for (const k of Object.keys(S.SHAPE_LIB)) assert.match(S.shapePath(k, 120, 80), /^M/, k);
});
