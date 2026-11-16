import { SHAPE_LIB } from './shapes.mjs';
// Presentations, shared by the browser and the server: the deck format, themes, layouts,
// safe rich text, and slide/object-level change tracking (for live co-editing and undo).
//
// A deck: { ratio: '16:9' | '4:3', theme, slides: [{ id, layout, bg, notes, items: [item] }] }
// An item (positions on a 960 × 540 canvas, or 960 × 720 for 4:3):
//   { id, t: 'text' | 'shape' | 'image' | 'chart', x, y, w, h, z,
//     html (text), fs (font size), al (left|center|right), va (top|middle|bottom), color,
//     shape (rect|round|ellipse|triangle|arrow|line), fill, stroke, sw, src (image), spec (chart) }

import { cleanRef } from './embeds.mjs';
export const W = 960;
export const heightFor = (ratio) => (ratio === '4:3' ? 720 : 540);
export const MAX_SLIDES = 200;
export const MAX_ITEMS = 60;

export const THEMES = {
  light: { label: 'Light', bg: '#ffffff', ink: '#1f1f1f', muted: '#5f6368', accent: '#0b57d0', title: "'Figtree', system-ui, sans-serif", body: "'Figtree', system-ui, sans-serif" },
  dark: { label: 'Dark', bg: '#1f1e1d', ink: '#ececea', muted: '#b7b5ae', accent: '#8ab4f8', title: "'Figtree', system-ui, sans-serif", body: "'Figtree', system-ui, sans-serif" },
  blue: { label: 'Blue', bg: '#0b57d0', ink: '#ffffff', muted: '#d3e3fd', accent: '#ffd666', title: "'Figtree', system-ui, sans-serif", body: "'Figtree', system-ui, sans-serif" },
  warm: { label: 'Warm', bg: '#fbf3ea', ink: '#3d2a22', muted: '#7a5a4a', accent: '#c4643f', title: "Georgia, 'Times New Roman', serif", body: "'Figtree', system-ui, sans-serif" },
  minimal: { label: 'Minimal', bg: '#f6f6f4', ink: '#222222', muted: '#666666', accent: '#222222', title: "Georgia, 'Times New Roman', serif", body: "Georgia, 'Times New Roman', serif" },
};
export const SHAPES = Object.fromEntries(Object.entries(SHAPE_LIB).map(([k, v]) => [k, v.label]));
export { SHAPE_LIB, SHAPE_GROUPS, shapePath } from './shapes.mjs';
export const LAYOUTS = { title: 'Title slide', titleBody: 'Title and body', twoCol: 'Two columns', section: 'Section header', imageCaption: 'Image with caption', blank: 'Blank' };

let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ---------- Safe rich text: only simple formatting survives ---------- */
const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sup', 'sub', 'a', 'br', 'p', 'div', 'ul', 'ol', 'li', 'span']);
export const FONTS = ['Figtree', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Garamond', 'Tahoma', 'Impact', 'Comic Sans MS'];
const escText = (s) => String(s).replace(/&(?!(?:[a-z]+|#\d+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function sanitizeHtml(html) {
  const src = String(html || '').slice(0, 20000).replace(/<(script|style|iframe|object|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  let out = '';
  const re = /<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[3] !== undefined) { out += escText(m[3]); continue; }
    const tag = m[1].toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    const closing = m[0].startsWith('</');
    if (closing) { if (tag !== 'br') out += `</${tag}>`; continue; }
    if (tag === 'br') { out += '<br>'; continue; }
    if (tag === 'span') {
      const style = (/style\s*=\s*"([^"]*)"/i.exec(m[2]) || [])[1] || '';
      const keep = [];
      const color = /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\))/i.exec(style);
      const size = /(?:^|;)\s*font-size\s*:\s*(\d{1,3}(?:\.\d+)?)px/i.exec(style);
      const bg = /(?:^|;)\s*background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\))/i.exec(style);
      const ff = /(?:^|;)\s*font-family\s*:\s*([^;]+)/i.exec(style);
      if (color) keep.push(`color:${color[1]}`);
      if (size && Number(size[1]) >= 6 && Number(size[1]) <= 200) keep.push(`font-size:${size[1]}px`);
      if (bg) keep.push(`background-color:${bg[1]}`);
      if (ff) { const name = ff[1].split(',')[0].replace(/['"]/g, '').trim(); if (FONTS.includes(name)) keep.push(`font-family:'${name}'`); }
      out += keep.length ? `<span style="${keep.join(';')}">` : '<span>';
      continue;
    }
    if (tag === 'a') { // links: web, email, or another slide (#slide=3)
      const href = (/href\s*=\s*"([^"]*)"/i.exec(m[2]) || [])[1] || '';
      if (/^(https?:\/\/|mailto:|#slide=\d+$)/i.test(href)) { out += `<a href="${escText(href).replace(/"/g, '&quot;')}">`; } else out += '<a>';
      continue;
    }
    if (tag === 'ul' || tag === 'ol') { // bullet and numbering styles
      const style = (/style\s*=\s*"([^"]*)"/i.exec(m[2]) || [])[1] || '';
      const t = /list-style-type\s*:\s*(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman)/i.exec(style);
      out += t ? `<${tag} style="list-style-type:${t[1].toLowerCase()}">` : `<${tag}>`;
      continue;
    }
    out += `<${tag}>`;
  }
  return out;
}
const decodeEntities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const rgbToHex = (c) => { const m = /rgb\((\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c || ''); return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : c; };

/** Safe HTML → paragraphs of styled runs (for PowerPoint, Word and Markdown). */
export function htmlToParagraphs(html) {
  const paras = [];
  let cur = null;
  const style = [{ b: false, i: false, u: false, color: null, size: null }];
  const listTypes = [];
  const list = [];
  const start = (bullet = null) => { cur = { bullet, level: Math.max(0, list.length - 1), ...(listTypes[listTypes.length - 1] ? { listType: listTypes[listTypes.length - 1] } : {}), runs: [] }; paras.push(cur); };
  const re = /<\/?([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m;
  start();
  while ((m = re.exec(sanitizeHtml(html)))) {
    if (m[3] !== undefined) {
      const text = decodeEntities(m[3]);
      if (!cur) start(list.length ? list[list.length - 1] : null);
      cur.runs.push({ text, ...style[style.length - 1] });
      continue;
    }
    const tag = m[1].toLowerCase();
    const closing = m[0].startsWith('</');
    const top = style[style.length - 1];
    if (tag === 'br') { start(cur?.bullet || null); continue; }
    if (['p', 'div'].includes(tag)) { if (!closing) { if (cur && cur.runs.length) start(list.length ? list[list.length - 1] : null); } else cur = null; continue; }
    if (tag === 'ul' || tag === 'ol') { if (closing) { list.pop(); listTypes.pop(); } else { list.push(tag); listTypes.push((/list-style-type:([a-z-]+)/i.exec(m[2]) || [])[1] || null); } cur = null; continue; }
    if (tag === 'li') { if (!closing) start(list[list.length - 1] || 'ul'); else cur = null; continue; }
    if (closing) { if (style.length > 1) style.pop(); continue; }
    const next = { ...top };
    if (tag === 'b' || tag === 'strong') next.b = true;
    if (tag === 'i' || tag === 'em') next.i = true;
    if (tag === 'u') next.u = true;
    if (tag === 's' || tag === 'strike') next.s = true;
    if (tag === 'sup') next.sup = true;
    if (tag === 'sub') next.sub = true;
    if (tag === 'a') { const h = (/href="([^"]*)"/i.exec(m[2]) || [])[1]; if (h) next.link = decodeEntities(h); }
    if (tag === 'span') {
      const st = (/style="([^"]*)"/i.exec(m[2]) || [])[1] || '';
      const c = /(?:^|;)\s*color:([^;]+)/i.exec(st); const z = /font-size:([\d.]+)px/i.exec(st);
      if (c) next.color = rgbToHex(c[1].trim());
      if (z) next.size = Number(z[1]);
      const hl = /background-color:([^;]+)/i.exec(st); if (hl) next.highlight = rgbToHex(hl[1].trim());
      const ffm = /font-family:'?([^';]+)/i.exec(st); if (ffm) next.font = ffm[1].trim();
    }
    style.push(next);
  }
  return paras.filter((p, i, all) => p.runs.some((r) => r.text.trim()) || (i > 0 && i < all.length - 1));
}
/** Plain text of a slide (for search, Word and Markdown outlines). */
export const plainText = (html) => htmlToParagraphs(html).map((p) => p.runs.map((r) => r.text).join('')).join('\n');

/* ---------- Layouts: starting points (everything can be moved afterwards) ---------- */
const textItem = (props) => ({ id: newId(), t: 'text', z: 1, al: 'left', va: 'top', fs: 24, html: '', ...props });
export function layoutItems(layout, ratio = '16:9', deck = null) {
  const edited = deck?.layouts?.[layout]?.items;
  if (edited?.length) return edited.map((x) => ({ ...structuredClone(x), id: newId() })); // as set in the theme builder
  const H = heightFor(ratio);
  const mid = H / 2;
  switch (layout) {
    case 'title': return [
      textItem({ x: 80, y: mid - 110, w: 800, h: 120, fs: 52, al: 'center', va: 'bottom', role: 'title', html: '' }),
      textItem({ x: 120, y: mid + 20, w: 720, h: 70, fs: 24, al: 'center', role: 'subtitle', html: '' })];
    case 'titleBody': return [
      textItem({ x: 60, y: 40, w: 840, h: 80, fs: 38, va: 'middle', role: 'title' }),
      textItem({ x: 60, y: 140, w: 840, h: H - 190, fs: 22, role: 'body', html: '<ul><li></li></ul>' })];
    case 'twoCol': return [
      textItem({ x: 60, y: 40, w: 840, h: 80, fs: 38, va: 'middle', role: 'title' }),
      textItem({ x: 60, y: 140, w: 405, h: H - 190, fs: 22, role: 'body', html: '<ul><li></li></ul>' }),
      textItem({ x: 495, y: 140, w: 405, h: H - 190, fs: 22, role: 'body', html: '<ul><li></li></ul>' })];
    case 'section': return [
      textItem({ x: 80, y: mid - 70, w: 800, h: 100, fs: 46, va: 'bottom', role: 'title' }),
      textItem({ x: 80, y: mid + 40, w: 800, h: 50, fs: 22, role: 'subtitle' })];
    case 'imageCaption': return [
      { id: newId(), t: 'shape', shape: 'rect', x: 60, y: 40, w: 840, h: H - 170, z: 0, fill: '#e8eaed', stroke: '', sw: 0, role: 'imageSlot' },
      textItem({ x: 60, y: H - 115, w: 840, h: 70, fs: 22, al: 'center', role: 'caption' })];
    default: return [];
  }
}
/* Slideshow motion: transitions between slides and object animations (Google Slides' Motion panel). */
export const TRANSITIONS = { none: 'None', fade: 'Dissolve', fadeBlack: 'Fade', slideRight: 'Slide from right', slideLeft: 'Slide from left', flip: 'Flip', cube: 'Cube', gallery: 'Gallery' };
export const EFFECTS = {
  appear: { label: 'Appear', kind: 'in' }, fadeIn: { label: 'Fade in', kind: 'in' }, flyInLeft: { label: 'Fly in from left', kind: 'in' }, flyInRight: { label: 'Fly in from right', kind: 'in' }, flyInTop: { label: 'Fly in from top', kind: 'in' }, flyInBottom: { label: 'Fly in from bottom', kind: 'in' }, zoomIn: { label: 'Zoom in', kind: 'in' },
  spin: { label: 'Spin', kind: 'emphasis' },
  disappear: { label: 'Disappear', kind: 'out' }, fadeOut: { label: 'Fade out', kind: 'out' }, flyOutLeft: { label: 'Fly out to left', kind: 'out' }, flyOutRight: { label: 'Fly out to right', kind: 'out' }, zoomOut: { label: 'Zoom out', kind: 'out' },
};
/** A slide's animations in click steps: step 0 plays on arrival (animations before the first "on click"), each click plays the next step. */
export function animationSteps(slide) {
  const ids = new Set(slide.items.map((x) => x.id)); const steps = [[]];
  for (const a of slide.anims || []) { if (!ids.has(a.item)) continue; if (a.start === 'click') steps.push([a]); else steps[steps.length - 1].push(a); }
  return steps;
}
export const PLACEHOLDER = { title: 'Click to add title', subtitle: 'Click to add subtitle', body: 'Click to add text', caption: 'Click to add a caption' };

export function newSlide(layout = 'titleBody', ratio = '16:9', deck = null) { return { id: newId(), layout, bg: null, notes: '', items: layoutItems(layout, ratio, deck) }; }
export function emptyDeck() { return { ratio: '16:9', theme: 'light', slides: [newSlide('title')] }; }

/* ---------- Cleaning anything loaded or imported ---------- */
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const color = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : null);
const DASHES = ['solid', 'dash', 'dot', 'dashDot', 'longDash'];
const HEADS = ['none', 'arrow', 'triangle', 'oval', 'diamond'];
const SITES = ['n', 'e', 's', 'w'];
const fileUrl = (u) => /^\/api\/files\/[0-9a-f-]{36}$/.test(u || '');
export function normalizeItem(it, H, fallbackId = null) {
  if (it && it.t === 'shape' && it.shape === 'line') { // older horizontal lines become real lines
    const y = (Number(it.y) || 0) + (Number(it.h) || 0) / 2;
    it = { ...it, t: 'line', x1: Number(it.x) || 0, y1: y, x2: (Number(it.x) || 0) + (Number(it.w) || 100), y2: y };
  }
  if (!it || !['text', 'shape', 'image', 'chart', 'line', 'table', 'video', 'wordart', 'file'].includes(it.t)) return null;
  if (it.t === 'line') { // a line's box follows its two ends
    const x1 = num(it.x1, -W, W * 2, 0), y1 = num(it.y1, -H, H * 2, 0), x2 = num(it.x2, -W, W * 2, 100), y2 = num(it.y2, -H, H * 2, 0);
    it = { ...it, x1, y1, x2, y2, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(4, Math.abs(x2 - x1)), h: Math.max(4, Math.abs(y2 - y1)) };
  }
  const out = {
    id: String(it.id || fallbackId || newId()).slice(0, 40), t: it.t,
    x: num(it.x, -W, W * 2, 60), y: num(it.y, -H, H * 2, 60), w: num(it.w, 4, W * 2, 300), h: num(it.h, 4, H * 2, 120), z: num(it.z, 0, 999, 1),
  };
  if (it.role) out.role = String(it.role).slice(0, 20);
  const rot = ((Number(it.rot) || 0) % 360 + 360) % 360; if (rot) out.rot = Math.round(rot * 10) / 10;
  if (it.fh) out.fh = 1; if (it.fv) out.fv = 1;
  if (typeof it.g === 'string' && /^[\w-]{1,40}$/.test(it.g)) out.g = it.g; // group
  if (it.lock) out.lock = 1;
  if (it.t === 'text' || (it.t === 'shape' && it.html)) {
    if (['shrink', 'resize'].includes(it.af)) out.af = it.af; // autofit: shrink text on overflow, or resize the box to fit
    if (Number.isFinite(Number(it.pad)) && it.pad !== undefined && it.pad !== null) out.pad = num(it.pad, 0, 80, 8);
    if (Number(it.lh)) out.lh = num(it.lh, 0.8, 3, 1.25);
    if (Number(it.ps)) out.ps = num(it.ps, 0, 80, 0);
    if (FONTS.includes(it.ff)) out.ff = it.ff;
  }
  if (it.t === 'text') Object.assign(out, { html: sanitizeHtml(it.html), fs: num(it.fs, 8, 160, 24), al: ['left', 'center', 'right'].includes(it.al) ? it.al : 'left', va: ['top', 'middle', 'bottom'].includes(it.va) ? it.va : 'top', ...(color(it.color) ? { color: color(it.color) } : {}), ...(color(it.fill) ? { fill: color(it.fill) } : {}) });
  if (it.shadow) out.shadow = 1;
  if (['shape', 'line'].includes(it.t) && DASHES.includes(it.dash) && it.dash !== 'solid') out.dash = it.dash;
  if (it.t === 'line') {
    Object.assign(out, { x1: Math.round(it.x1), y1: Math.round(it.y1), x2: Math.round(it.x2), y2: Math.round(it.y2), kind: ['elbow', 'curved'].includes(it.kind) ? it.kind : 'straight', stroke: color(it.stroke) || '#1f1f1f', sw: num(it.sw, 0.5, 24, 2) });
    if (HEADS.includes(it.a1) && it.a1 !== 'none') out.a1 = it.a1;
    if (HEADS.includes(it.a2) && it.a2 !== 'none') out.a2 = it.a2;
    for (const k of ['from', 'to']) if (it[k] && typeof it[k].id === 'string' && SITES.includes(it[k].site)) out[k] = { id: it[k].id.slice(0, 40), site: it[k].site };
    delete out.rot; delete out.fh; delete out.fv;
  }
  if (it.t === 'table') {
    const rows = (Array.isArray(it.rows) ? it.rows : [[{}]]).slice(0, 30).map((row) => (Array.isArray(row) ? row : []).slice(0, 20));
    const nc = Math.max(1, ...rows.map((r) => r.length));
    out.rows = rows.map((row) => Array.from({ length: nc }, (_, j) => { const c = row[j] || {}; return { html: sanitizeHtml(c.html || ''), ...(color(c.bg) ? { bg: color(c.bg) } : {}), ...(Number(c.cs) > 1 ? { cs: Math.min(nc - j, Math.round(c.cs)) } : {}), ...(Number(c.rs) > 1 ? { rs: Math.min(30, Math.round(c.rs)) } : {}), ...(c.hide ? { hide: 1 } : {}) }; }));
    const cw = Array.isArray(it.colW) && it.colW.length === nc ? it.colW.map((v) => num(v, 10, W * 2, 100)) : Array(nc).fill(Math.round(out.w / nc));
    const rh = Array.isArray(it.rowH) && it.rowH.length === out.rows.length ? it.rowH.map((v) => num(v, 10, H * 2, 40)) : Array(out.rows.length).fill(Math.round(out.h / out.rows.length));
    Object.assign(out, { colW: cw, rowH: rh, bc: color(it.bc) || '#9aa0a6', bw: num(it.bw, 0, 8, 1), fs: num(it.fs, 8, 72, 16), ...(it.hdr ? { hdr: 1 } : {}), ...(color(it.color) ? { color: color(it.color) } : {}) });
    out.w = cw.reduce((a, b) => a + b, 0); out.h = rh.reduce((a, b) => a + b, 0);
  }
  if (it.t === 'file') { const ref = cleanRef(it.ref); if (!ref) return null; out.ref = ref; } // a linked file from the app
  if (it.t === 'video') { if (!/^[\w-]{11}$/.test(it.yt || '')) return null; out.yt = it.yt; if (Number(it.start) > 0) out.start = Math.round(num(it.start, 0, 86400, 0)); }
  if (it.t === 'wordart') Object.assign(out, { text: String(it.text || 'Word Art').slice(0, 200), fill: color(it.fill) || '#0b57d0', stroke: color(it.stroke) || '', sw: num(it.sw, 0, 12, 0), ...(FONTS.includes(it.ff) ? { ff: it.ff } : {}), ...(it.b !== false && it.b !== 0 ? { b: 1 } : {}), ...(it.i ? { i: 1 } : {}) });
  if (it.t === 'shape') Object.assign(out, { shape: SHAPE_LIB[it.shape] ? it.shape : 'rect', fill: color(it.fill) || (it.fill === '' ? '' : '#cfe2ff'), stroke: color(it.stroke) || '', sw: num(it.sw, 0, 20, 0), ...(it.html ? { html: sanitizeHtml(it.html), fs: num(it.fs, 8, 160, 20), al: 'center', va: 'middle' } : {}) });
  if (it.t === 'image') {
    if (!fileUrl(it.src)) return null; out.src = it.src;
    const c = it.crop || {}; const cl = num(c.l, 0, 0.9, 0), cr = num(c.r, 0, 0.9, 0), ct = num(c.t, 0, 0.9, 0), cb = num(c.b, 0, 0.9, 0);
    if ((cl || cr || ct || cb) && cl + cr < 0.95 && ct + cb < 0.95) out.crop = { l: cl, t: ct, r: cr, b: cb };
    if (SHAPE_LIB[it.mask] && it.mask !== 'rect') out.mask = it.mask;
    if (Number(it.op) && Number(it.op) < 1) out.op = num(it.op, 0.05, 1, 1);
    if (Number(it.br)) out.br = num(it.br, -100, 100, 0);
    if (Number(it.ct)) out.ct = num(it.ct, -100, 100, 0);
    if (['gray', 'sepia', 'light', 'dark', 'invert'].includes(it.rc)) out.rc = it.rc;
    if (it.alt) out.alt = String(it.alt).slice(0, 300);
  }
  if (it.t === 'chart') { out.spec = it.spec && typeof it.spec === 'object' ? it.spec : {}; if (it.link && /^[\w-]{6,64}$/.test(it.link.noteId || '') && typeof it.link.range === 'string') out.link = { noteId: it.link.noteId, sheet: String(it.link.sheet || '').slice(0, 100), range: it.link.range.slice(0, 40), ...(it.link.byRow ? { byRow: true } : {}) }; }
  return out;
}
export function normalizeDeck(d) {
  const ratio = d?.ratio === '4:3' ? '4:3' : '16:9';
  const H = heightFor(ratio);
  // Slides and objects saved without ids get predictable ones, so every copy of the same data agrees on them.
  const slides = (Array.isArray(d?.slides) ? d.slides : []).slice(0, MAX_SLIDES).map((s, si) => ({
    id: String(s?.id || `slide-${si + 1}`).slice(0, 40),
    layout: LAYOUTS[s?.layout] ? s.layout : 'blank',
    bg: color(s?.bg),
    ...(s?.bgGrad && color(s.bgGrad.a) && color(s.bgGrad.b) ? { bgGrad: { a: color(s.bgGrad.a), b: color(s.bgGrad.b), ang: num(s.bgGrad.ang, 0, 360, 180) } } : {}),
    ...(fileUrl(s?.bgImg) ? { bgImg: s.bgImg } : {}),
    notes: String(s?.notes || '').slice(0, 20000),
    ...(s?.skip ? { skip: true } : {}),
    ...(TRANSITIONS[s?.tr?.type] && s.tr.type !== 'none' ? { tr: { type: s.tr.type, dur: num(s.tr.dur, 0.1, 5, 0.5) } } : {}),
    ...(Array.isArray(s?.anims) && s.anims.length ? { anims: s.anims.filter((a) => a && EFFECTS[a.fx] && typeof a.item === 'string').slice(0, 100).map((a, ai) => ({ id: String(a.id || `${s?.id || si}-anim-${ai + 1}`).slice(0, 40), item: a.item.slice(0, 40), fx: a.fx, start: ['click', 'with', 'after'].includes(a.start) ? a.start : 'click', dur: num(a.dur, 0.1, 10, 0.5) })) } : {}),
    items: (Array.isArray(s?.items) ? s.items : []).slice(0, MAX_ITEMS).map((it, ii) => normalizeItem(it, H, `${s?.id || `slide-${si + 1}`}-item-${ii + 1}`)).filter(Boolean),
  }));
  const meta = normalizeMeta(d, H);
  return { ratio, theme: THEMES[d?.theme] ? d.theme : 'light', ...meta, slides: slides.length ? slides : [newSlide('title', ratio)] };
}
/** Deck-wide settings: custom theme colours and fonts, the master (objects on every slide), edited layouts, slide numbers. */
function normalizeMeta(d, H) {
  const out = {};
  const c = d?.custom;
  if (c && typeof c === 'object') { const x = {}; for (const k of ['bg', 'ink', 'muted', 'accent']) if (color(c[k])) x[k] = color(c[k]); for (const k of ['title', 'body']) if (FONTS.includes(c[k])) x[k] = c[k]; if (Object.keys(x).length) out.custom = x; }
  const items = (list, pre) => (Array.isArray(list) ? list : []).slice(0, MAX_ITEMS).map((it, i) => normalizeItem(it, H, `${pre}-${i + 1}`)).filter(Boolean);
  if (d?.master?.items?.length) out.master = { items: items(d.master.items, 'master') };
  if (d?.layouts && typeof d.layouts === 'object') { const l = {}; for (const [k, v] of Object.entries(d.layouts)) if (LAYOUTS[k] && v?.items) l[k] = { items: items(v.items, `layout-${k}`) }; if (Object.keys(l).length) out.layouts = l; }
  if (d?.num?.on) out.num = { on: true, ...(d.num.skipTitle ? { skipTitle: true } : {}) };
  return out;
}
/** The theme in effect: the chosen theme with any custom colours and fonts. */
export function themeOf(deck) {
  const base = THEMES[deck?.theme] || THEMES.light; const c = deck?.custom || {};
  const font = (f) => `'${f}', system-ui, sans-serif`;
  return { ...base, ...(c.bg ? { bg: c.bg } : {}), ...(c.ink ? { ink: c.ink } : {}), ...(c.muted ? { muted: c.muted } : {}), ...(c.accent ? { accent: c.accent } : {}), ...(c.title ? { title: font(c.title) } : {}), ...(c.body ? { body: font(c.body) } : {}) };
}
/** Give a slide another layout: its title/body/subtitle/caption text moves into the new layout's places (Google Slides' "Apply layout"). */
export function applyLayout(slide, layout, ratio = '16:9', deck = null) {
  const fresh = layoutItems(layout, ratio, deck);
  const old = [...slide.items];
  const items = fresh.map((ph) => {
    const i = old.findIndex((x) => x.role === ph.role || (ph.role === 'subtitle' && x.role === 'body') || (ph.role === 'body' && x.role === 'subtitle'));
    if (i < 0) return ph;
    const [x] = old.splice(i, 1);
    return { ...ph, id: x.id, ...(x.html ? { html: x.html } : {}), ...(x.t === 'image' ? x : {}) };
  });
  return { ...slide, layout, items: [...items, ...old.filter((x) => x.role !== 'imageSlot' && !(x.role && !S_PH_HAS_TEXT(x)))] };
}
const S_PH_HAS_TEXT = (x) => x.t !== 'text' || plainText(x.html || '').trim().length > 0;
/** Connection points of a shape: the middle of each side (rotated with it). */
export function sitePoint(it, site) {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2; const off = { n: [0, -it.h / 2], e: [it.w / 2, 0], s: [0, it.h / 2], w: [-it.w / 2, 0] }[site] || [0, 0];
  const a = ((it.rot || 0) * Math.PI) / 180; return [cx + off[0] * Math.cos(a) - off[1] * Math.sin(a), cy + off[0] * Math.sin(a) + off[1] * Math.cos(a)];
}
/** Lines attached to shapes follow them (connectors). Returns the items with attached ends moved. */
export function routeLines(items) {
  const byId = new Map(items.map((x) => [x.id, x]));
  return items.map((x) => {
    if (x.t !== 'line' || (!x.from && !x.to)) return x;
    const n = { ...x };
    if (x.from && byId.get(x.from.id)) [n.x1, n.y1] = sitePoint(byId.get(x.from.id), x.from.site).map(Math.round); else delete n.from;
    if (x.to && byId.get(x.to.id)) [n.x2, n.y2] = sitePoint(byId.get(x.to.id), x.to.site).map(Math.round); else delete n.to;
    n.x = Math.min(n.x1, n.x2); n.y = Math.min(n.y1, n.y2); n.w = Math.max(4, Math.abs(n.x2 - n.x1)); n.h = Math.max(4, Math.abs(n.y2 - n.y1));
    return n;
  });
}

/* ---------- Changes at slide/object level (co-editing and undo) ---------- */
const flatten = (deck) => {
  const slides = {}, items = {};
  for (const s of deck.slides) {
    slides[s.id] = { layout: s.layout, bg: s.bg, notes: s.notes, ...(s.bgGrad ? { bgGrad: s.bgGrad } : {}), ...(s.bgImg ? { bgImg: s.bgImg } : {}), ...(s.skip ? { skip: true } : {}), ...(s.tr ? { tr: s.tr } : {}), ...(s.anims ? { anims: s.anims } : {}) };
    for (const it of s.items) items[`${s.id}/${it.id}`] = it;
  }
  const meta = JSON.stringify({ custom: deck.custom || null, master: deck.master || null, layouts: deck.layouts || null, num: deck.num || null });
  return { ratio: deck.ratio, theme: deck.theme, meta, order: deck.slides.map((s) => s.id), slides, items };
};
export function diffDecks(a, b) {
  const A = flatten(a), B = flatten(b);
  const side = (X) => ({ ratio: X.ratio, theme: X.theme, ...(A.meta !== B.meta ? { meta: X.meta } : {}), order: X.order, slides: {}, items: {} });
  const before = side(A), after = side(B);
  for (const k of new Set([...Object.keys(A.slides), ...Object.keys(B.slides)])) {
    if (JSON.stringify(A.slides[k] || null) !== JSON.stringify(B.slides[k] || null)) { before.slides[k] = A.slides[k] || null; after.slides[k] = B.slides[k] || null; }
  }
  for (const k of new Set([...Object.keys(A.items), ...Object.keys(B.items)])) {
    if (JSON.stringify(A.items[k] || null) !== JSON.stringify(B.items[k] || null)) { before.items[k] = A.items[k] || null; after.items[k] = B.items[k] || null; }
  }
  const changed = Object.keys(after.slides).length || Object.keys(after.items).length || A.ratio !== B.ratio || A.theme !== B.theme || A.meta !== B.meta || A.order.join() !== B.order.join();
  return changed ? { before, after } : null;
}
/** Apply one side of a change to the latest deck, keeping everyone else's edits. */
export function applyDeckSide(cur, side) {
  const C = flatten(normalizeDeck(cur));
  for (const [k, v] of Object.entries(side.slides)) { if (v) C.slides[k] = v; else delete C.slides[k]; }
  for (const [k, v] of Object.entries(side.items)) { if (v) C.items[k] = v; else delete C.items[k]; }
  // Slide order: the order from this change, plus slides others added meanwhile (kept in place after their neighbour).
  const order = side.order.filter((id) => C.slides[id]);
  C.order.forEach((id, i) => { if (!order.includes(id) && C.slides[id] && !(id in side.slides && side.slides[id] === null)) { const prev = C.order[i - 1]; const at = prev ? order.indexOf(prev) : -1; order.splice(at + 1, 0, id); } });
  const slides = order.map((id) => ({ id, ...C.slides[id], items: Object.entries(C.items).filter(([k]) => k.startsWith(`${id}/`)).map(([, it]) => it).sort((x, y) => x.z - y.z) }));
  const meta = JSON.parse(side.meta ?? C.meta);
  return normalizeDeck({ ratio: side.ratio, theme: side.theme, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v)), slides });
}
