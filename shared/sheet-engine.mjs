// Spreadsheet engine shared by the browser and the server: the data model, Excel-compatible
// formulas (via fast-formula-parser), number formats, and sheet operations.
//
// A sheet is stored as JSON:
//   { r: rows, c: columns, cells: { A1: { v: '=SUM(B1:B3)', s: { b, i, al, fg, bg, f } } }, w: { A: 120 } }
// v is what was typed (a formula starts with "="); s is the cell's style.
import FormulaParser from 'fast-formula-parser';
import * as FormulaJS from '@formulajs/formulajs';
import FormulaOperators from 'fast-formula-parser/formulas/operators.js';

/* Element-wise array maths, as in Excel 365: B2:B5>2 gives {TRUE;FALSE;TRUE;FALSE}, B2:B5*C2:C5 multiplies pairs.
   (The formula reader only looks at the first element of an array; its operators are wrapped once here.) */
(() => {
  const Infix = FormulaOperators?.Infix; if (!Infix || Infix.__elementwise) return;
  for (const name of ['compareOp', 'concatOp', 'mathOp']) {
    const orig = Infix[name];
    Infix[name] = (v1, op, v2, a1, a2) => {
      a1 = a1 || Array.isArray(v1); a2 = a2 || Array.isArray(v2); // ranges arrive as grids without the array flag
      if (!a1 && !a2) return orig(v1, op, v2, false, false);
      const g1 = a1 ? (Array.isArray(v1[0]) ? v1 : [v1]) : [[v1]], g2 = a2 ? (Array.isArray(v2[0]) ? v2 : [v2]) : [[v2]];
      const R = Math.max(g1.length, g2.length), C = Math.max(g1[0].length, g2[0].length);
      const pick = (g, i, j) => { const row = g.length === 1 ? g[0] : g[i]; return row === undefined ? undefined : row.length === 1 ? row[0] : row[j]; };
      return Array.from({ length: R }, (_, i) => Array.from({ length: C }, (__, j) => {
        const x = pick(g1, i, j), y = pick(g2, i, j);
        if ((g1.length !== 1 && i >= g1.length) || (g2.length !== 1 && i >= g2.length) || (g1[0].length !== 1 && j >= g1[0].length) || (g2[0].length !== 1 && j >= g2[0].length)) return new FormulaParser.FormulaError('#N/A');
        if (x instanceof FormulaParser.FormulaError) return x; if (y instanceof FormulaParser.FormulaError) return y;
        try { return orig(x, op, y, false, false); } catch (e) { return e instanceof FormulaParser.FormulaError ? e : new FormulaParser.FormulaError('#VALUE!'); }
      }));
    };
  }
  Infix.__elementwise = true;
})();

/* ---------- Functions: fast-formula-parser's own, plus Formula.js for everything it lacks ---------- */
const toSerial = (d) => d.getTime() / 86400000 + 25569; // Date -> Excel date number
const fromParam = (p) => (p && typeof p === 'object' && 'value' in p ? p.value : p);
function toResult(v) {
  if (v instanceof Error) return new FormulaParser.FormulaError(/^#/.test(v.message) ? v.message : '#VALUE!');
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? new FormulaParser.FormulaError('#VALUE!') : toSerial(v);
  return v;
}
const flat = (v) => (Array.isArray(v) ? v.flat(Infinity) : [v]);
/* Excel 365's dynamic-array functions (results spill into neighbouring cells) */
const grid2 = (p) => { const v = fromParam(p); return Array.isArray(v) ? (Array.isArray(v[0]) ? v : [v]) : [[v]]; };
const num = (p, d) => { const v = fromParam(p); return v === undefined || v === null || v === '' ? d : Number(v); };
const cmpVals = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' }));
const transpose = (g) => g[0].map((_, j) => g.map((row) => row[j]));
const ARRAY_FUNCTIONS = {
  UNIQUE: (array, byCol, once) => {
    let g = grid2(array); const bc = !!fromParam(byCol); if (bc) g = transpose(g);
    const counts = new Map(); for (const row of g) { const k = JSON.stringify(row.map((x) => (typeof x === 'string' ? x.toLowerCase() : x))); counts.set(k, (counts.get(k) || 0) + 1); }
    const seen = new Set(); const out = [];
    for (const row of g) { const k = JSON.stringify(row.map((x) => (typeof x === 'string' ? x.toLowerCase() : x))); if (seen.has(k)) continue; seen.add(k); if (fromParam(once) && counts.get(k) > 1) continue; out.push(row); }
    if (!out.length) return new FormulaParser.FormulaError('#CALC!');
    return bc ? transpose(out) : out;
  },
  SORT: (array, index, order, byCol) => {
    let g = grid2(array); const bc = !!fromParam(byCol); if (bc) g = transpose(g);
    const i = num(index, 1) - 1, dir = num(order, 1) < 0 ? -1 : 1;
    const out = [...g].sort((a, b) => dir * cmpVals(a[i], b[i]));
    return bc ? transpose(out) : out;
  },
  SORTBY: (array, ...pairs) => {
    const g = grid2(array); const keys = [];
    for (let i = 0; i < pairs.length; i += 2) keys.push({ col: grid2(pairs[i]).map((r) => r[0]), dir: num(pairs[i + 1], 1) < 0 ? -1 : 1 });
    const idx = g.map((_, i) => i).sort((a, b) => { for (const k of keys) { const c = k.dir * cmpVals(k.col[a], k.col[b]); if (c) return c; } return 0; });
    return idx.map((i) => g[i]);
  },
  FILTER: (array, include, ifEmpty) => {
    const g = grid2(array); const inc = grid2(include);
    const byRow = inc.length === g.length;
    const keep = byRow ? inc.map((r) => !!r[0] && !(r[0] instanceof FormulaParser.FormulaError)) : inc[0].map((x) => !!x);
    const out = byRow ? g.filter((_, i) => keep[i]) : g.map((row) => row.filter((_, j) => keep[j]));
    if (!out.length || !out[0]?.length) return ifEmpty !== undefined ? fromParam(ifEmpty) : new FormulaParser.FormulaError('#CALC!');
    return out;
  },
  SEQUENCE: (rows, cols, start, step) => {
    const R = Math.max(1, Math.floor(num(rows, 1))), C = Math.max(1, Math.floor(num(cols, 1))), s0 = num(start, 1), st = num(step, 1);
    if (R * C > 100000) return new FormulaParser.FormulaError('#NUM!');
    return Array.from({ length: R }, (_, i) => Array.from({ length: C }, (__, j) => s0 + (i * C + j) * st));
  },
  RANDARRAY: (rows, cols, min, max, whole) => {
    const R = Math.max(1, Math.floor(num(rows, 1))), C = Math.max(1, Math.floor(num(cols, 1))), lo = num(min, 0), hi = num(max, 1), w = !!fromParam(whole);
    return Array.from({ length: R }, () => Array.from({ length: C }, () => (w ? Math.floor(lo + Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo))));
  },
};
const EXTRA_FUNCTIONS = {
  ...ARRAY_FUNCTIONS,
  // EDATE as Excel does it: adding months stops at the end of a shorter month (31 Jan + 1 month = 28 Feb).
  EDATE: (start, months) => {
    const n = Number(fromParam(start)), m = Math.trunc(Number(fromParam(months)));
    if (!Number.isFinite(n) || !Number.isFinite(m)) return new FormulaParser.FormulaError('#VALUE!');
    const d = new Date(Math.round((n - 25569) * 86400000));
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + m, day = d.getUTCDate();
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return toSerial(new Date(Date.UTC(y, mo, Math.min(day, last))));
  },
  // XLOOKUP(lookup, lookup_array, return_array, [if_not_found])
  XLOOKUP: (lookup, lookupArray, returnArray, notFound) => {
    const want = fromParam(lookup), keys = flat(fromParam(lookupArray)), vals = flat(fromParam(returnArray));
    const i = keys.findIndex((k) => (typeof k === 'string' && typeof want === 'string' ? k.toLowerCase() === want.toLowerCase() : k === want));
    if (i >= 0) return vals[i] ?? null;
    return notFound !== undefined ? fromParam(notFound) : new FormulaParser.FormulaError('#N/A');
  },
};
(() => {
  const probe = new FormulaParser({ onCell: () => 1, onRange: () => [[1]] });
  for (const [name, fn] of Object.entries(FormulaJS)) {
    if (typeof fn !== 'function' || !/^[A-Z][A-Z0-9.]*$/.test(name) || EXTRA_FUNCTIONS[name]) continue;
    let missing = false;
    try { probe.parse(`${name}()`, { sheet: 'Sheet1', row: 1, col: 1 }); } catch (e) { missing = /not implemented/i.test(String(e?.message || e?.details || e)); }
    if (missing) EXTRA_FUNCTIONS[name] = (...params) => { try { return toResult(fn(...params.map(fromParam))); } catch { return new FormulaParser.FormulaError('#VALUE!'); } };
  }
})();
export const FUNCTION_COUNT = () => Object.keys(EXTRA_FUNCTIONS).length;

/* =====================================================================
   Workbooks: one or more sheets.
   { sheets: [{ id, name, r, c, cells: { A1: { v, s } }, w: { A: px }, h: { 0: px }, merges: ['A1:B2'],
                freeze: { r: 0|1, c: 0|1 }, filter: { range, crit: { col: { vals, op, val } } } | null,
                cf: [{ range, type: gt|lt|eq|contains|scale, value, bg, fg, lo, hi }] }] }
   v is what was typed (a formula starts with "="); s is the cell style:
   { b, i, u, al, va, fg, bg, f (format), dp (decimals), ff (font), fz (size), wr (wrap), bd: { t, r, b, l } }
   ===================================================================== */
export const MAX_ROWS = 100000;
export const MAX_COLS = 702; // A..ZZ
export const DEF_W = 64; // Excel's default column width (px)
export const DEF_H = 20; // and row height
export const MAX_SHEETS = 30;
export const FORMATS = { general: 'General', number: 'Number', currency: 'Currency', percent: 'Percent', date: 'Date', time: 'Time', text: 'Text' };
export const FONTS = { '': 'Default', Arial: 'Arial', Georgia: 'Georgia', 'Times New Roman': 'Times New Roman', 'Courier New': 'Courier New', Verdana: 'Verdana', 'Trebuchet MS': 'Trebuchet MS' };

export const colName = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
export const colIndex = (name) => { let n = 0; for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
export const cellKey = (row, col) => `${colName(col)}${row + 1}`;
export const parseKey = (key) => { const m = /^\$?([A-Z]{1,2})\$?(\d+)$/.exec(String(key).toUpperCase()); return m ? { row: Number(m[2]) - 1, col: colIndex(m[1]) } : null; };
export const parseRange = (ref) => {
  const [a, b] = String(ref || '').toUpperCase().split(':'); const p = parseKey(a), q = parseKey(b || a);
  return p && q ? { r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) } : null;
};
export const rangeRef = (g) => (g.r1 === g.r2 && g.c1 === g.c2 ? cellKey(g.r1, g.c1) : `${cellKey(g.r1, g.c1)}:${cellKey(g.r2, g.c2)}`);
let seq = 0;
const sheetId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptySheet(rows = MAX_ROWS, cols = MAX_COLS, name = 'Sheet1') { return normalizeSheet({ id: sheetId(), name }, name); } // the same shape as any loaded sheet
export function emptyWorkbook() { return { sheets: [emptySheet()] }; }

const color = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : null);
function cleanStyle(st) {
  if (!st || typeof st !== 'object') return null;
  const s = {};
  if (st.b) s.b = 1; if (st.i) s.i = 1; if (st.u) s.u = 1; if (st.wr) s.wr = 1;
  if (['left', 'center', 'right'].includes(st.al)) s.al = st.al;
  if (['top', 'middle', 'bottom'].includes(st.va)) s.va = st.va;
  if (color(st.fg)) s.fg = color(st.fg); if (color(st.bg)) s.bg = color(st.bg);
  if (FORMATS[st.f] && st.f !== 'general') s.f = st.f;
  if (Number.isInteger(st.dp) && st.dp >= 0 && st.dp <= 10) s.dp = st.dp;
  if (typeof st.ff === 'string' && FONTS[st.ff] && st.ff) s.ff = st.ff;
  if (Number(st.fz) >= 6 && Number(st.fz) <= 72) s.fz = Math.round(Number(st.fz));
  if (st.bd && typeof st.bd === 'object') { const bd = {}; for (const k of ['t', 'r', 'b', 'l']) { const v = Number(st.bd[k]); if (v >= 1 && v <= 6) bd[k] = Math.round(v); } if (Object.keys(bd).length) s.bd = bd; } // 1 thin, 2 medium, 3 double, 4 dashed, 5 dotted, 6 thick
  if (color(st.bc)) s.bc = color(st.bc);
  if (typeof st.nf === 'string' && st.nf.trim() && st.nf.length <= 200) s.nf = st.nf;
  if (Number.isFinite(Number(st.rot)) && st.rot !== undefined && st.rot !== null && (Number(st.rot) === 255 || Math.abs(Number(st.rot)) <= 90) && Number(st.rot) !== 0) s.rot = Math.round(Number(st.rot));
  if (st.st) s.st = 1;
  if (st.vs === 'sup' || st.vs === 'sub') s.vs = st.vs;
  if (Number(st.ind) >= 1 && Number(st.ind) <= 15) s.ind = Math.round(Number(st.ind));
  if (st.unl) s.unl = 1; // unlocked (for sheet protection)
  if (st.hf) s.hf = 1; // formula hidden (for sheet protection)
  return Object.keys(s).length ? s : null;
}
/** Clean up one sheet loaded from storage or a file. */
/* Tidy cells are frozen and shared between versions of a workbook (copy-on-write): an edit copies only what it changes.
   Frozen means code that tries to change a cell in place fails loudly instead of silently changing earlier versions too. */
const TIDY = new WeakSet();
function tidyCell(cell) {
  if (cell.s) { if (cell.s.bd) Object.freeze(cell.s.bd); Object.freeze(cell.s); }
  if (cell.n) Object.freeze(cell.n);
  TIDY.add(Object.freeze(cell)); return cell;
}
export function normalizeSheet(d, fallbackName = 'Sheet1', fallbackId = null) {
  const r = MAX_ROWS, c = MAX_COLS; // every sheet is a full grid, as in Excel
  const cells = {};
  for (const [k, cell] of Object.entries(d?.cells || {})) {
    const p = parseKey(k);
    if (!p || p.row >= r || p.col >= c || !cell) continue;
    if (TIDY.has(cell)) { cells[cellKey(p.row, p.col)] = cell; continue; } // already tidy (and frozen): shared between versions
    const v = cell.v == null ? '' : String(cell.v).slice(0, 5000);
    const s = cleanStyle(cell.s);
    const n = cell.n && typeof cell.n === 'object' && String(cell.n.t || '').trim() ? { t: String(cell.n.t).slice(0, 5000), ...(cell.n.a ? { a: String(cell.n.a).slice(0, 80) } : {}), ...(cell.n.d ? { d: String(cell.n.d).slice(0, 30) } : {}) } : null; // note
    const l = typeof cell.l === 'string' && /^(https?:\/\/|mailto:|#)/i.test(cell.l) ? cell.l.slice(0, 2000) : null; // hyperlink
    if (v || s || n || l) cells[cellKey(p.row, p.col)] = tidyCell({ v, ...(s ? { s } : {}), ...(n ? { n } : {}), ...(l ? { l } : {}), ...(cell.ig ? { ig: 1 } : {}) }); // ig: error indicator ignored
  }
  const w = {}; for (const [k, px] of Object.entries(d?.w || {})) if (/^[A-Z]{1,2}$/.test(k) && Number(px) >= 8 && Number(px) <= 1200) w[k] = Math.round(Number(px));
  const h = {}; for (const [k, px] of Object.entries(d?.h || {})) if (/^\d+$/.test(k) && Number(k) < r && Number(px) >= 8 && Number(px) <= 600) h[k] = Math.round(Number(px));
  const cs = {}; for (const [k, st] of Object.entries(d?.cs || {})) { const x = cleanStyle(st); if (/^[A-Z]{1,2}$/.test(k) && x) cs[k] = x; }
  const rs = {}; for (const [k, st] of Object.entries(d?.rs || {})) { const x = cleanStyle(st); if (/^\d+$/.test(k) && Number(k) < r && x) rs[k] = x; }
  const hr = [...new Set((Array.isArray(d?.hr) ? d.hr : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < r))].sort((a, b) => a - b).slice(0, 20000);
  const hc = [...new Set((Array.isArray(d?.hc) ? d.hc : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < c))].sort((a, b) => a - b);
  const merges = (Array.isArray(d?.merges) ? d.merges : []).map(parseRange).filter((g) => g && g.r2 < r && g.c2 < c && (g.r2 > g.r1 || g.c2 > g.c1)).map(rangeRef).slice(0, 500);
  const freeze = { r: Math.max(0, Math.min(200, Math.floor(Number(d?.freeze?.r) || 0))), c: Math.max(0, Math.min(50, Math.floor(Number(d?.freeze?.c) || 0))) };
  const view = { ...(d?.view?.grid === false ? { grid: false } : {}), ...(d?.view?.heads === false ? { heads: false } : {}), ...(Number(d?.view?.zoom) >= 0.5 && Number(d?.view?.zoom) <= 2 ? { zoom: Math.round(Number(d.view.zoom) * 100) / 100 } : {}) };
  const tab = color(d?.tab);
  let filter = null;
  if (d?.filter && parseRange(d.filter.range)) {
    const crit = {};
    for (const [col, cr] of Object.entries(d.filter.crit || {})) if (/^\d+$/.test(col) && cr) crit[col] = { ...(Array.isArray(cr.vals) ? { vals: cr.vals.map(String).slice(0, 1000) } : {}), ...(['gt', 'lt', 'eq', 'ne', 'contains'].includes(cr.op) ? { op: cr.op, val: String(cr.val ?? '') } : {}) };
    filter = { range: rangeRef(parseRange(d.filter.range)), crit };
  }
  const cf = (Array.isArray(d?.cf) ? d.cf : []).filter((x) => x && parseRange(x.range) && ['gt', 'lt', 'eq', 'contains', 'scale'].includes(x.type)).slice(0, 50).map((x) => ({
    range: rangeRef(parseRange(x.range)), type: x.type, value: String(x.value ?? ''),
    ...(color(x.bg) ? { bg: color(x.bg) } : {}), ...(color(x.fg) ? { fg: color(x.fg) } : {}), ...(color(x.lo) ? { lo: color(x.lo) } : {}), ...(color(x.hi) ? { hi: color(x.hi) } : {}),
  }));
  const dv = (Array.isArray(d?.dv) ? d.dv : []).filter((x) => x && String(x.range || '').split(/[ ,]+/).some((part) => parseRange(part)) && ['list', 'whole', 'decimal', 'date', 'textlen', 'custom'].includes(x.type)).slice(0, 200).map((x) => ({
    range: String(x.range).split(/[ ,]+/).map(parseRange).filter(Boolean).map(rangeRef).join(' '), type: x.type,
    ...(['between', 'notbetween', 'eq', 'ne', 'gt', 'lt', 'ge', 'le'].includes(x.op) ? { op: x.op } : {}),
    v1: String(x.v1 ?? '').slice(0, 2000), v2: String(x.v2 ?? '').slice(0, 500), blank: x.blank !== false, drop: x.drop !== false,
    ...(x.msg && (x.msg.title || x.msg.text) ? { msg: { title: String(x.msg.title || '').slice(0, 100), text: String(x.msg.text || '').slice(0, 1000) } } : {}),
    err: { style: ['stop', 'warning', 'info'].includes(x.err?.style) ? x.err.style : 'stop', title: String(x.err?.title || '').slice(0, 100), text: String(x.err?.text || '').slice(0, 1000) },
  }));
  const name = String(d?.name || fallbackName).replace(/[[\]:*?/\\']/g, '').trim().slice(0, 31) || fallbackName;
  // A sheet saved without an id gets a predictable one, so every copy of the same data agrees on it.
  const wa = [...new Set((Array.isArray(d?.wa) ? d.wa : []).filter((k) => w[k]))]; // widths Excel-style auto-widening set (not the user)
  const TOTAL_FNS = ['none', 'sum', 'average', 'count', 'counta', 'max', 'min'];
  const tables = (Array.isArray(d?.tables) ? d.tables : []).filter((t) => t && isValidName(t.name) && parseRange(t.range)).slice(0, 100).map((t) => ({
    name: String(t.name), range: rangeRef(parseRange(t.range)), style: /^(light|medium|dark)\d{1,2}$/.test(t.style || '') ? t.style : 'medium2',
    header: t.header !== false, total: !!t.total, banded: t.banded !== false, bandedCols: !!t.bandedCols, firstCol: !!t.firstCol, lastCol: !!t.lastCol, filterBtn: t.filterBtn !== false,
    totals: Object.fromEntries(Object.entries(t.totals || {}).filter(([k, v]) => /^\d+$/.test(k) && TOTAL_FNS.includes(v))),
    ...(t.sort && Number.isInteger(t.sort.col) ? { sort: { col: t.sort.col, dir: t.sort.dir === 'desc' ? 'desc' : 'asc' } } : {}),
  }));
  const FNS = ['sum', 'count', 'average', 'max', 'min'];
  const pivots = (Array.isArray(d?.pivots) ? d.pivots : []).filter((pv) => pv && typeof pv.src === 'string' && parseKey(String(pv.at || ''))).slice(0, 50).map((pv) => ({
    id: String(pv.id || sheetId()).slice(0, 40), name: String(pv.name || 'PivotTable1').slice(0, 60), src: String(pv.src).slice(0, 300), at: String(pv.at).toUpperCase(),
    rows: (Array.isArray(pv.rows) ? pv.rows : []).map(String).slice(0, 6), cols: (Array.isArray(pv.cols) ? pv.cols : []).map(String).slice(0, 4),
    vals: (Array.isArray(pv.vals) ? pv.vals : []).filter((v) => v && v.f).map((v) => ({ f: String(v.f), fn: FNS.includes(v.fn) ? v.fn : 'sum' })).slice(0, 8),
    filters: Object.fromEntries(Object.entries(pv.filters || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : null])),
    out: parseRange(pv.out || '') ? rangeRef(parseRange(pv.out)) : null, grand: pv.grand !== false,
  }));
  const charts = (Array.isArray(d?.charts) ? d.charts : []).filter((ch) => ch && parseRange(String(ch.range || '').split('!').pop())).slice(0, 50).map((ch) => ({
    id: String(ch.id || sheetId()).slice(0, 40), t: ['column', 'bar', 'line', 'pie'].includes(ch.t) ? ch.t : 'column', range: String(ch.range).slice(0, 200), title: String(ch.title ?? '').slice(0, 200),
    x: Math.max(0, Math.round(Number(ch.x) || 0)), y: Math.max(0, Math.round(Number(ch.y) || 0)), w: Math.max(120, Math.min(2000, Math.round(Number(ch.w) || 480))), h: Math.max(90, Math.min(1500, Math.round(Number(ch.h) || 288))),
    legend: ch.legend !== false, byRow: !!ch.byRow,
  }));
  const protect = d?.protect && d.protect.on ? { on: true, ...(typeof d.protect.pw === 'string' && d.protect.pw ? { pw: d.protect.pw.slice(0, 64) } : {}), allow: Object.fromEntries(['format', 'insert', 'delete', 'sort', 'filter', 'selectLocked'].map((k) => [k, k === 'selectLocked' ? d.protect.allow?.[k] !== false : !!d.protect.allow?.[k]])) } : null;
  const pr = d?.print || {};
  const print = { ...(parseRange(pr.area || '') ? { area: rangeRef(parseRange(pr.area)) } : {}), ...(/^\d+:\d+$/.test(pr.titles || '') ? { titles: pr.titles } : {}), ...(pr.grid === false ? { grid: false } : {}), ...(pr.heads ? { heads: true } : {}), ...(['width', 'page'].includes(pr.fit) ? { fit: pr.fit } : {}) };
  return { id: String(d?.id || fallbackId || sheetId()).slice(0, 40), name, r, c, cells, w, wa, h, cs, rs, hr, hc, merges, freeze, filter, cf, dv, view, tab, tables, pivots, charts, ...(protect ? { protect } : {}), ...(d?.hidden ? { hidden: true } : {}), print };
}
/** Clean up a workbook; an older single-sheet spreadsheet becomes a workbook with one sheet. */
export function normalizeWorkbook(d) {
  const raw = Array.isArray(d?.sheets) ? d.sheets : [d || {}];
  const seen = new Set();
  const sheets = raw.slice(0, MAX_SHEETS).map((s, i) => {
    const sh = normalizeSheet(s, `Sheet${i + 1}`, `sheet-${i + 1}`);
    let name = sh.name, n = 2;
    while (seen.has(name.toLowerCase())) name = `${sh.name} (${n++})`;
    seen.add(name.toLowerCase());
    return { ...sh, name };
  });
  const names = {};
  for (const [k, ref] of Object.entries(d?.names || {})) if (isValidName(k) && typeof ref === 'string' && /!/.test(ref) && Object.keys(names).length < 500) names[k] = ref.slice(0, 300);
  if (sheets.length && sheets.every((x) => x.hidden)) delete sheets[0].hidden;
  return { sheets: sheets.length ? sheets : [emptySheet()], names };
}
/** A defined name: starts with a letter or _, letters/digits/_/., and must not look like a cell reference. */
export function isValidName(n) { return typeof n === 'string' && /^[A-Za-z_\\][\w.]{0,254}$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) && !/^(R\d*C\d*|TRUE|FALSE)$/i.test(n); }

/** The style a cell shows: its column's, then its row's, then its own (as in Excel). */
export function styleAt(sheet, r, c) {
  const col = sheet.cs?.[colName(c)], row = sheet.rs?.[r], own = sheet.cells[cellKey(r, c)]?.s;
  if (!col && !row) return own || null;
  return { ...(col || {}), ...(row || {}), ...(own || {}) };
}

/** A typed value: number, boolean or text (formulas are evaluated separately). */
function literal(v) {
  const t = String(v).trim();
  if (t === '') return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return Number(t);
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^[-+]?(\d+\.?\d*)%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  return String(v);
}
const toDateSerial = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 25569;
/** What someone typed, as Excel would store it: "$1,200" is 1200 as currency, "50%" is 0.5 as a percentage, dates become dates. */
export function parseInput(raw) {
  const t = String(raw ?? '');
  const s = t.trim();
  if (!s || s.startsWith('=') || s.startsWith("'")) return { v: s.startsWith("'") ? t : t };
  let m;
  if ((m = /^-?\$\s?(-?\d{1,3}(,\d{3})*(\.\d+)?|-?\d+(\.\d+)?)$/.exec(s))) return { v: String(Number((s.startsWith('-') ? '-' : '') + m[1].replace(/[,-]/g, '').replace(/^/, ''))), f: 'currency' };
  if ((m = /^(-?\d+(\.\d+)?)\s?%$/.exec(s))) return { v: String(Number(m[1]) / 100), f: 'percent' };
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { v: String(toDateSerial(y, mo, d)), f: 'date' }; }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { v: String(toDateSerial(y, mo, d)), f: 'date' }; }
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return { v: s.replace(/,/g, ''), f: 'number', dp: (s.split('.')[1] || '').length };
  if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i.exec(s))) { // a time, as a fraction of a day
    let h = Number(m[1]); const mi = Number(m[2]), se = Number(m[3] || 0); const ap = (m[4] || '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12; if (ap.startsWith('a') && h === 12) h = 0;
    if (h < 24 && mi < 60 && se < 60) return { v: String(Number(((h * 3600 + mi * 60 + se) / 86400).toPrecision(15))), f: 'time', ...(ap ? { nf: m[3] ? 'h:mm:ss AM/PM' : 'h:mm AM/PM' } : { nf: m[3] ? 'h:mm:ss' : 'h:mm' }) };
  }
  return { v: t };
}

/** Replace defined names in a formula with their references (outside quoted text; not function names). */
export function expandNames(formula, names) {
  const keys = Object.keys(names || {}); if (!keys.length) return formula;
  const map = new Map(keys.map((k) => [k.toLowerCase(), names[k]]));
  return String(formula).split('"').map((part, i) => (i % 2 ? part : part.replace(/(^|[^\w.!'$\\])([A-Za-z_\\][\w.]*)(?![\w.!(])/g, (m, pre, name) => (map.has(name.toLowerCase()) ? `${pre}${map.get(name.toLowerCase())}` : m)))).join('"');
}
/** The calculation chain (as in Excel): formula cells ordered so that each comes after the formula cells it reads.
 *  Built without recursion, so very long chains (running totals) can't overflow the stack. Formulas whose inputs are
 *  only known while calculating (INDIRECT, OFFSET) and circular references are still handled during calculation. */
export function calcChain(wb) {
  const formulas = new Map(); const bySheet = new Map();
  for (const sh of wb.sheets) {
    const list = [];
    for (const [k, c] of Object.entries(sh.cells)) if (String(c.v ?? '').startsWith('=')) { const p = parseKey(k); const id = `${sh.name}!${k}`; formulas.set(id, { sh, key: k }); list.push({ row: p.row, col: p.col, id }); }
    bySheet.set(sh.name.toLowerCase(), { sh, list });
  }
  const depsOf = (id) => {
    const { sh, key } = formulas.get(id); const out = [];
    let refs = []; try { refs = precedents(wb, sh, key); } catch { refs = []; }
    refsById.set(id, refs.map(({ sheet, g }) => ({ sheet: String(sheet).toLowerCase(), g })));
    for (const { sheet, g } of refs) {
      const target = bySheet.get(String(sheet).toLowerCase()); if (!target) continue;
      const area = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
      if (area <= target.list.length) { for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const d = `${target.sh.name}!${cellKey(r, c)}`; if (formulas.has(d)) out.push(d); } }
      else for (const f of target.list) if (f.row >= g.r1 && f.row <= g.r2 && f.col >= g.c1 && f.col <= g.c2) out.push(f.id);
    }
    return out;
  };
  const order = []; const state = new Map(); // 1: being visited, 2: placed
  const depsById = new Map(); const refsById = new Map(); // formula → formulas it reads; formula → every range it reads
  for (const start of formulas.keys()) {
    if (state.has(start)) continue;
    const stack = [{ id: start, deps: null, i: 0 }]; state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (!top.deps) { top.deps = depsOf(top.id); depsById.set(top.id, top.deps); }
      if (top.i < top.deps.length) { const d = top.deps[top.i++]; if (!state.has(d)) { state.set(d, 1); stack.push({ id: d, deps: null, i: 0 }); } continue; }
      stack.pop(); state.set(top.id, 2); order.push({ ...formulas.get(top.id), id: top.id });
    }
  }
  order.deps = depsById; order.refs = refsById;
  return order;
}
/** Work out every cell's value in every sheet. Returns { sheetName: { key: { value, error, spill? } } }.
 *  Formulas that return several values "spill" into the empty cells beside/below them (Excel 365). */
export function evaluateWorkbook(data, reuse = null) {
  const wb = reuse?.wb || normalizeWorkbook(data);
  const byName = new Map(wb.sheets.map((s) => [s.name.toLowerCase(), s]));
  const findSheet = (name, fallback) => (name ? byName.get(String(name).replace(/^'|'$/g, '').toLowerCase()) : fallback) || null;
  const run = (spillMap, spillRanges) => {
    const memo = new Map(), stack = new Set(), cycle = new Set(), spills = [];
    const prevOf = reuse ? (name, key, id) => { if (reuse.dirty.has(id)) return undefined; const v = reuse.values[name]?.[key]; return v && !v.spill ? v : undefined; } : null; // unaffected cells keep their values
    const valueOf = (sheet, key) => {
      const id = `${sheet.name}!${key}`;
      if (memo.has(id)) return memo.get(id);
      if (prevOf) { const prev = prevOf(sheet.name, key, id); if (prev !== undefined) return prev; }
      const raw = sheet.cells[key]?.v ?? '';
      if (!String(raw).startsWith('=')) {
        if (raw === '' && spillMap.has(id)) return spillMap.get(id);
        const out = { value: String(raw).startsWith("'") ? String(raw).slice(1) : literal(raw) }; memo.set(id, out); return out;
      }
      if (stack.has(id)) { let on = false; for (const k of stack) { if (k === id) on = true; if (on) cycle.add(k); } return { value: null, error: '#CYCLE!' }; }
      stack.add(id);
      let out;
      try {
        const p = parseKey(key);
        let f = expandStructured(expandNames(String(raw).slice(1), wb.names), wb, sheet, p.row);
        f = f.replace(/((?:'[^']+'|[A-Za-z_][\w.]*)!)?(\$?[A-Z]{1,2}\$?\d+)#/g, (m, sh, ref) => { const sname = sh ? sh.slice(0, -1).replace(/^'|'$/g, '') : sheet.name; return `${sh || ''}${spillRanges.get(`${sname}!${ref.replace(/\$/g, '')}`) || ref}`; });
        const res = parserAt(stack.size - 1, sheet).parse(f, { sheet: sheet.name, row: p.row + 1, col: p.col + 1 }, true); // arrays allowed: they spill
        if (res instanceof FormulaParser.FormulaError || (res && res.error && typeof res.error === 'string')) out = { value: null, error: res.error || String(res) };
        else if (Array.isArray(res)) {
          const grid = Array.isArray(res[0]) ? res : [res];
          const first = grid[0]?.[0];
          if (grid.length * (grid[0]?.length || 0) > 1) spills.push({ sheet, key, grid });
          out = first instanceof FormulaParser.FormulaError ? { value: null, error: first.error } : { value: first === undefined ? null : first };
        } else out = { value: res === undefined ? null : res };
      } catch (err) {
        out = { value: null, error: err?.error || (/cycle/i.test(String(err?.message)) ? '#CYCLE!' : /sheet/i.test(String(err?.message)) ? '#REF!' : /name/i.test(String(err?.message)) ? '#NAME?' : '#ERROR!') };
      }
      stack.delete(id); memo.set(id, out); return out;
    };
    const cellValue = (sheet, row, col) => {
      if (!sheet) return new FormulaParser.FormulaError('#REF!');
      if (row - 1 >= sheet.r || col - 1 >= sheet.c) return undefined;
      const r = valueOf(sheet, cellKey(row - 1, col - 1));
      if (r.error) return new FormulaParser.FormulaError(r.error === '#CYCLE!' || r.error === '#SPILL!' ? (r.error === '#SPILL!' ? '#SPILL!' : '#REF!') : r.error);
      return r.value ?? undefined;
    };
    // The last used row of each sheet (cells and spilled results): the sheet doesn't change while calculating.
    const lastRows = new Map(); const rangeCache = new Map();
    const inRange = (id, ref) => { const p = parseKey(id.slice(id.lastIndexOf('!') + 1)); return p && p.row + 1 >= ref.from.row && p.row + 1 <= ref.to.row && p.col + 1 >= ref.from.col && p.col + 1 <= ref.to.col; };
    const lastRowOf = (sh) => {
      if (lastRows.has(sh)) return lastRows.get(sh);
      let last = usedRange(sh).rows; const pre = `${sh.name}!`;
      for (const k of spillMap.keys()) if (k.startsWith(pre)) last = Math.max(last, (parseKey(k.slice(pre.length))?.row ?? 0) + 1);
      lastRows.set(sh, last); return last;
    };
    const parsers = [];
    const parserAt = (depth, sheet) => {
      const p = (parsers[depth] ||= { cur: null, parser: null });
      p.cur = sheet;
      p.parser ||= new FormulaParser({
        functions: EXTRA_FUNCTIONS,
        onCell: ({ sheet: name, row, col }) => cellValue(findSheet(name && name !== p.cur.name ? name : null, p.cur), row, col),
        onRange: (ref) => {
          const sh = findSheet(ref.sheet && ref.sheet !== p.cur.name ? ref.sheet : null, p.cur);
          if (!sh) return [[new FormulaParser.FormulaError('#REF!')]];
          const rkey = `${sh.name}!${ref.from.row},${ref.from.col}:${ref.to.row},${ref.to.col}`;
          if (rangeCache.has(rkey)) return rangeCache.get(rkey); // the same range read by several formulas (e.g. SUMIFs) is built once
          const lastRow = lastRowOf(sh); // worked out once per calculation, not once per range read
          const out = [];
          const toRow = Math.min(ref.to.row, sh.r, Math.max(ref.from.row, lastRow)), toCol = Math.min(ref.to.col, sh.c);
          for (let r = ref.from.row; r <= toRow; r++) { const row = []; for (let c = ref.from.col; c <= toCol; c++) row.push(cellValue(sh, r, c)); out.push(row); }
          if (!stack.size || [...stack].every((id) => !id.startsWith(`${sh.name}!`) || !inRange(id, ref))) rangeCache.set(rkey, out); // never cache a range a formula being calculated sits in
          return out;
        },
      });
      return p.parser;
    };
    const result = {};
    for (const { sh, key, id } of chain) if (!reuse || reuse.dirty.has(id)) valueOf(byName.get(sh.name.toLowerCase()) || sh, key); // this version's sheet (a remembered chain may come from the previous one) // formulas in dependency order: each one's inputs are ready, so nesting stays shallow
    if (reuse && reuse.values && Object.keys(reuse.values).length && !spillMap.size) {
      for (const sh of wb.sheets) result[sh.name] = { ...(reuse.values[sh.name] || {}) };
      for (const id of reuse.dirty) { const i = id.lastIndexOf('!'); const name = id.slice(0, i), key = id.slice(i + 1); const sh = byName.get(name.toLowerCase()); if (!sh) continue; if (sh.cells[key]) result[sh.name][key] = valueOf(sh, key); else delete result[sh.name][key]; }
    } else for (const sh of wb.sheets) { result[sh.name] = {}; for (const key of Object.keys(sh.cells)) result[sh.name][key] = valueOf(sh, key); }
    for (const id of cycle) { const i = id.lastIndexOf('!'); const name = id.slice(0, i); if (result[name]) result[name][id.slice(i + 1)] = { value: null, error: '#CYCLE!' }; }
    return { result, spills };
  };
  const chain = reuse?.chain || calcChain(wb);
  // Pass 1 finds the formulas that spill; pass 2 lets other formulas read the spilled values.
  let { result, spills } = run(new Map(), new Map());
  if (!spills.length) return result;
  const place = (list) => {
    const map = new Map(), ranges = new Map(), blocked = new Set();
    for (const { sheet, key, grid } of list) {
      const p = parseKey(key); const rows = grid.length, cols = Math.max(...grid.map((r) => r.length));
      let ok = p.row + rows <= sheet.r && p.col + cols <= sheet.c;
      for (let i = 0; ok && i < rows; i++) for (let j = 0; j < cols; j++) { if (!i && !j) continue; const k = cellKey(p.row + i, p.col + j); if ((sheet.cells[k]?.v ?? '') !== '' || map.has(`${sheet.name}!${k}`)) { ok = false; break; } }
      if (!ok) { blocked.add(`${sheet.name}!${key}`); continue; }
      ranges.set(`${sheet.name}!${key}`, rangeRef({ r1: p.row, c1: p.col, r2: p.row + rows - 1, c2: p.col + cols - 1 }));
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        if (!i && !j) continue; const v = grid[i]?.[j];
        map.set(`${sheet.name}!${cellKey(p.row + i, p.col + j)}`, v instanceof FormulaParser.FormulaError ? { value: null, error: v.error, spill: key } : { value: v === undefined ? null : v, spill: key });
      }
    }
    return { map, ranges, blocked };
  };
  let placed = place(spills);
  ({ result, spills } = run(placed.map, placed.ranges));
  placed = place(spills);
  for (const [id, v] of placed.map) { const i = id.lastIndexOf('!'); (result[id.slice(0, i)] ||= {})[id.slice(i + 1)] = v; }
  for (const id of placed.blocked) { const i = id.lastIndexOf('!'); result[id.slice(0, i)][id.slice(i + 1)] = { value: null, error: '#SPILL!' }; }
  for (const [id, ref] of placed.ranges) { const i = id.lastIndexOf('!'); result[id.slice(0, i)][id.slice(i + 1)].spillRange = ref; }
  return result;
}
/** Single-sheet helpers (older callers): treat the data as a one-sheet workbook. */
export function evaluateSheet(data) { const wb = normalizeWorkbook(data); return evaluateWorkbook(wb)[wb.sheets[0].name]; }

const fromSerial = (n) => new Date(Math.round((n - 25569) * 86400000));
/** What a cell shows. */
export function formatValue(value, fmt = 'general', dp, nf) {
  if (value === null || value === undefined || value === '') return '';
  if (nf) return formatCode(value, nf).text;
  if (fmt === 'time' && typeof value === 'number') return formatCode(value, 'h:mm:ss').text;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '#NUM!';
    const d = Number.isInteger(dp) ? dp : null;
    switch (fmt) {
      case 'number': return value.toLocaleString('en-US', { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
      case 'currency': return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
      case 'percent': return `${(value * 100).toLocaleString('en-US', { minimumFractionDigits: d ?? 0, maximumFractionDigits: d ?? 2 })}%`;
      case 'date': { const dt = fromSerial(value); return Number.isNaN(dt.getTime()) ? String(value) : dt.toISOString().slice(0, 10); }
      case 'text': return String(value);
      default: return d !== null ? value.toFixed(d) : Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(10)));
    }
  }
  return String(value);
}
/** Display text for every used cell of one sheet: { key: { text, error, number, value } }. */
export function displayFrom(sheet, values) {
  const out = {};
  const withLines = hasLineStyles(sheet);
  const keys = new Set([...Object.keys(sheet.cells), ...Object.keys(values).filter((k) => values[k]?.spill)]);
  for (const key of keys) out[key] = displayCellOf(sheet, values, key, withLines);
  return out;
}
const hasLineStyles = (sheet) => !!(sheet.cs && Object.keys(sheet.cs).length) || !!(sheet.rs && Object.keys(sheet.rs).length);
/** What one cell shows (undefined for an empty cell). The grid asks for the cells on screen only. */
export function displayCellOf(sheet, values, key, withLines = hasLineStyles(sheet)) {
  const r0 = values[key];
  if (!sheet.cells[key] && !r0?.spill) return undefined;
  const r = r0 || { value: null };
  const p = parseKey(key); if (!p) return undefined;
  const st = withLines || !sheet.cells[key] ? styleAt(sheet, p.row, p.col) : sheet.cells[key].s;
  if (r.error) return { text: r.error, error: true, ...(r.spill ? { spill: r.spill } : {}) };
  const fc = st?.nf && r.value !== null && r.value !== undefined && r.value !== '' ? formatCode(r.value, st.nf) : null;
  return { text: fc ? fc.text : formatValue(r.value, st?.f, st?.dp), number: typeof r.value === 'number', value: r.value, ...(fc?.color ? { color: fc.color } : {}), ...(r.spill ? { spill: r.spill } : {}), ...(r.spillRange ? { spillRange: r.spillRange } : {}) };
}
export function displayWorkbook(data) {
  const wb = normalizeWorkbook(data);
  const values = evaluateWorkbook(wb);
  return Object.fromEntries(wb.sheets.map((s) => [s.name, displayFrom(s, values[s.name] || {})]));
}
export function displaySheet(data) { const wb = normalizeWorkbook(data); return displayWorkbook(wb)[wb.sheets[0].name]; }

/** The used area of a sheet: { rows, cols } (at least 1×1). */
export function usedRange(sheet, values = null) {
  let rows = 0, cols = 0;
  for (const k of [...Object.keys(sheet.cells || {}), ...Object.keys(values || {}).filter((x) => values[x]?.spill)]) {
    if (!sheet.cells?.[k] && values?.[k]?.spill) { const p = parseKey(k); rows = Math.max(rows, p.row + 1); cols = Math.max(cols, p.col + 1); continue; }
    const p = parseKey(k);
    if (p && sheet.cells[k].v !== '' && sheet.cells[k].v != null) { rows = Math.max(rows, p.row + 1); cols = Math.max(cols, p.col + 1); }
  }
  return { rows: Math.max(rows, 1), cols: Math.max(cols, 1) };
}
/** Rows of display text for the used area of each sheet: [{ name, rows }]. */
export function workbookRows(data) {
  const wb = normalizeWorkbook(data);
  const shown = displayWorkbook(wb);
  const vals = evaluateWorkbook(wb);
  return wb.sheets.map((s) => {
    const { rows, cols } = usedRange(s, vals[s.name]);
    const out = [];
    for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) row.push(shown[s.name][cellKey(r, c)]?.text ?? ''); out.push(row); }
    return { name: s.name, rows: out };
  });
}
export function sheetRows(data) { return workbookRows(data)[0].rows; }

/* ---------- Formulas when copying, filling, and inserting/deleting rows or columns ---------- */
const REF_RE = /((?:'[^']+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Z]{1,2})(\$?)(\d+)(?![\w(])/g;
/** Move relative references by (dr, dc) as Excel does when a formula is copied or filled. */
export function shiftRefs(formula, dr, dc) {
  if (!String(formula).startsWith('=')) return formula;
  let inStr = false;
  return String(formula).split('"').map((part, i) => {
    inStr = i % 2 === 1;
    if (inStr) return part;
    return part.replace(REF_RE, (m, sh = '', d1, col, d2, row) => {
      let c = colIndex(col), r = Number(row) - 1;
      if (!d1) c += dc; if (!d2) r += dr;
      if (c < 0 || r < 0 || c >= MAX_COLS || r >= MAX_ROWS) return '#REF!';
      return `${sh}${d1}${colName(c)}${d2}${r + 1}`;
    });
  }).join('"');
}
/** Shift references to `sheetName` when its rows/columns change (by > 0 inserted, by < 0 deleted at `at`). */
const RANGE_RE = /((?:'[^']+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Z]{1,2})(\$?)(\d+):(\$?)([A-Z]{1,2})(\$?)(\d+)(?![\w(])/g;
function shiftForChange(formula, opts) {
  if (!String(formula).startsWith('=')) return formula;
  const { axis, at, by, sheetName, sameSheet } = opts;
  // Ranges first, as a whole: deleting part of a range shrinks it (Excel); only deleting all of it gives #REF!.
  const held = [];
  const text = String(formula).split('"').map((part, i) => (i % 2 ? part : part.replace(RANGE_RE, (m, sh, a1, c1, a2, r1, b1, c2, b2, r2) => {
    const target = sh ? sh.slice(0, -1).replace(/^'|'$/g, '') : null;
    if (!(target ? target.toLowerCase() === sheetName.toLowerCase() : sameSheet)) { held.push(m); return `\u0000${held.length - 1}\u0000`; }
    const g = { r1: Number(r1) - 1, c1: colIndex(c1), r2: Number(r2) - 1, c2: colIndex(c2) };
    const moved = moveRange(rangeRef(g), axis, at, by);
    if (!moved) { held.push('#REF!'); return `\u0000${held.length - 1}\u0000`; }
    const n = parseRange(moved);
    held.push(`${sh || ''}${a1}${colName(n.c1)}${a2}${n.r1 + 1}:${b1}${colName(n.c2)}${b2}${n.r2 + 1}`);
    return `\u0000${held.length - 1}\u0000`;
  }))).join('"');
  return shiftSingles(text, opts).replace(/\u0000(\d+)\u0000/g, (m, i) => held[Number(i)]);
}
function shiftSingles(formula, { axis, at, by, sheetName, sameSheet }) {
  const move = (i) => (i < at ? i : by > 0 ? i + by : i < at - by ? null : i + by);
  return String(formula).split('"').map((part, i) => (i % 2 ? part : part.replace(REF_RE, (m, sh, d1, col, d2, row) => {
    const target = sh ? sh.slice(0, -1).replace(/^'|'$/g, '') : null;
    const applies = target ? target.toLowerCase() === sheetName.toLowerCase() : sameSheet;
    if (!applies) return m;
    let c = colIndex(col), r = Number(row) - 1;
    if (axis === 'row') r = move(r); else c = move(c);
    if (r === null || c === null) return '#REF!';
    return `${sh || ''}${d1}${colName(c)}${d2}${r + 1}`;
  }))).join('"');
}
const moveRange = (ref, axis, at, by) => {
  const g = parseRange(ref); if (!g) return null;
  const k1 = axis === 'row' ? 'r1' : 'c1', k2 = axis === 'row' ? 'r2' : 'c2';
  if (by > 0) { if (g[k1] >= at) g[k1] += by; if (g[k2] >= at) g[k2] += by; }
  else { const end = at - by; if (g[k1] >= end) g[k1] += by; else if (g[k1] >= at) g[k1] = at; if (g[k2] >= end) g[k2] += by; else if (g[k2] >= at) g[k2] = at - 1; if (g[k2] < g[k1]) return null; }
  return rangeRef(g);
};
/** Insert or delete rows/columns in one sheet; formulas everywhere that point at it are adjusted. */
export function changeRowsCols(data, sheetIndex, axis, at, by) {
  const wb = normalizeWorkbook(data);
  const sheet = wb.sheets[sheetIndex];
  if (!sheet) return wb;
  const sheets = wb.sheets.map((sh, i) => {
    const same = i === sheetIndex;
    const cells = {};
    for (const [k, cell] of Object.entries(sh.cells)) {
      let { row, col } = parseKey(k);
      if (same) {
        const idx = axis === 'row' ? row : col;
        if (by < 0 && idx >= at && idx < at - by) continue;
        if (idx >= at) { if (axis === 'row') row += by; else col += by; }
      }
      cells[cellKey(row, col)] = { ...cell, v: shiftForChange(cell.v, { axis, at, by, sheetName: sheet.name, sameSheet: same }) };
    }
    if (!same) return { ...sh, cells };
    const next = { ...sh, cells };
    if (axis === 'row') {
      next.r = Math.max(1, Math.min(MAX_ROWS, sh.r + by));
      const h = {}; for (const [k, px] of Object.entries(sh.h)) { const n = Number(k); if (by < 0 && n >= at && n < at - by) continue; h[n >= at ? n + by : n] = px; } next.h = h;
      const rs = {}; for (const [k, st] of Object.entries(sh.rs || {})) { const n = Number(k); if (by < 0 && n >= at && n < at - by) continue; rs[n >= at ? n + by : n] = st; } next.rs = rs;
      next.hr = (sh.hr || []).filter((n) => !(by < 0 && n >= at && n < at - by)).map((n) => (n >= at ? n + by : n));
    } else {
      next.c = Math.max(1, Math.min(MAX_COLS, sh.c + by));
      const w = {}; for (const [k, px] of Object.entries(sh.w)) { const n = colIndex(k); if (by < 0 && n >= at && n < at - by) continue; w[colName(n >= at ? n + by : n)] = px; } next.w = w;
      const cs = {}; for (const [k, st] of Object.entries(sh.cs || {})) { const n = colIndex(k); if (by < 0 && n >= at && n < at - by) continue; cs[colName(n >= at ? n + by : n)] = st; } next.cs = cs;
      next.hc = (sh.hc || []).filter((n) => !(by < 0 && n >= at && n < at - by)).map((n) => (n >= at ? n + by : n));
    }
    next.merges = sh.merges.map((m) => moveRange(m, axis, at, by)).filter(Boolean);
    next.cf = sh.cf.map((x) => ({ ...x, range: moveRange(x.range, axis, at, by) })).filter((x) => x.range);
    if (sh.filter) { const range = moveRange(sh.filter.range, axis, at, by); next.filter = range ? { ...sh.filter, range } : null; }
    if (sh.dv?.length) next.dv = sh.dv.map((x) => ({ ...x, range: x.range.split(' ').map((part) => moveRange(part, axis, at, by)).filter(Boolean).join(' ') })).filter((x) => x.range);
    next.tables = (sh.tables || []).map((t) => ({ ...t, range: moveRange(t.range, axis, at, by) })).filter((t) => t.range);
    next.charts = (sh.charts || []).map((ch) => { const i = ch.range.lastIndexOf('!'); const onThis = i < 0 || ch.range.slice(0, i).replace(/^'|'$/g, '').toLowerCase() === sheet.name.toLowerCase(); if (!onThis) return ch; const r = moveRange(ch.range.slice(i + 1), axis, at, by); return r ? { ...ch, range: i < 0 ? r : `${ch.range.slice(0, i + 1)}${r}` } : null; }).filter(Boolean);
    if (sh.print?.area) { const a = moveRange(sh.print.area, axis, at, by); next.print = { ...sh.print }; if (a) next.print.area = a; else delete next.print.area; }
    return next;
  });
  const names = Object.fromEntries(Object.entries(wb.names || {}).map(([k, ref]) => [k, shiftForChange(`=${ref}`, { axis, at, by, sheetName: sheet.name, sameSheet: nameSheet(ref).toLowerCase() === sheet.name.toLowerCase() }).slice(1)]));
  return normalizeWorkbook({ sheets, names });
}
/** Rename a sheet, updating formulas that point at it. */
export function renameSheet(data, index, newName) {
  const wb = normalizeWorkbook(data);
  const old = wb.sheets[index]?.name; if (!old) return wb;
  const name = String(newName).replace(/[[\]:*?/\\']/g, '').trim().slice(0, 31);
  if (!name || wb.sheets.some((s, i) => i !== index && s.name.toLowerCase() === name.toLowerCase())) return wb;
  const quoteIfNeeded = (n) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n}'`);
  const re = new RegExp(`(^|[^\\w'])('?)${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\2!`, 'gi');
  const sheets = wb.sheets.map((s, i) => ({
    ...s, name: i === index ? name : s.name,
    cells: Object.fromEntries(Object.entries(s.cells).map(([k, c]) => [k, String(c.v).startsWith('=') ? { ...c, v: String(c.v).split('"').map((part, j) => (j % 2 ? part : part.replace(re, (m, pre) => `${pre}${quoteIfNeeded(name)}!`))).join('"') } : c])),
  }));
  const names = Object.fromEntries(Object.entries(wb.names || {}).map(([k, ref]) => [k, nameSheet(ref).toLowerCase() === old.toLowerCase() ? `${quoteIfNeeded(name)}!${String(ref).slice(String(ref).lastIndexOf('!') + 1)}` : ref]));
  return normalizeWorkbook({ sheets, names });
}

/** Sort rows `from`..`to` (inclusive) of a sheet by one column; blanks always go last; same-row references follow. */
export function sortRegion(sheet, fromRow = 1) {
  let end = fromRow;
  while (end < sheet.r) {
    let empty = true;
    for (let c = 0; c < sheet.c; c++) { const v = sheet.cells[cellKey(end, c)]?.v; if (v !== undefined && v !== '') { empty = false; break; } }
    if (empty) break;
    end++;
  }
  return { from: fromRow, to: end - 1 };
}
export function sortSheet(sheet, values, col, dir = 'asc', from = 1, to = null) {
  const last = to ?? sortRegion(sheet, from).to;
  if (last <= from) return sheet;
  const lines = [];
  for (let r = from; r <= last; r++) {
    const rowCells = {}; for (let c = 0; c < sheet.c; c++) { const k = cellKey(r, c); if (sheet.cells[k]) rowCells[c] = sheet.cells[k]; }
    const v = values[cellKey(r, col)]?.value;
    lines.push({ rowCells, v: v === '' ? null : v, from: r });
  }
  const cmp = (a, b) => (typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' }));
  lines.sort((a, b) => ((a.v == null || b.v == null) ? (a.v == null) - (b.v == null) : dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
  const cells = {};
  for (const [k, cell] of Object.entries(sheet.cells)) { const r = parseKey(k).row; if (r < from || r > last) cells[k] = cell; }
  lines.forEach((line, i) => {
    const to2 = from + i;
    for (const [c, cell] of Object.entries(line.rowCells)) cells[cellKey(to2, Number(c))] = { ...cell, v: to2 !== line.from ? shiftRefs(cell.v, to2 - line.from, 0).replace(/\$/g, (m) => m) : cell.v };
  });
  return { ...sheet, cells };
}

/* ---------- Fill handle: continue a series, or copy with references adjusted ---------- */
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function listSeries(vals, list) {
  const idx = vals.map((v) => { const t = String(v).trim().toLowerCase(); let i = list.findIndex((x) => x.toLowerCase() === t); let short = false; if (i < 0) { i = list.findIndex((x) => x.slice(0, 3).toLowerCase() === t); short = i >= 0; } return { i, short, upper: String(v) === String(v).toUpperCase() }; });
  if (idx.some((x) => x.i < 0)) return null;
  const step = idx.length > 1 ? (idx[1].i - idx[0].i + list.length) % list.length || 1 : 1;
  return (k) => { const base = idx[idx.length - 1]; let name = list[(base.i + step * k + list.length * 100) % list.length]; if (base.short) name = name.slice(0, 3); return base.upper ? name.toUpperCase() : name; };
}
/** Values for `count` cells after `source` (cells { v, s } in order). Returns new cells. */
export function fillSeries(source, count, { dr = 0, dc = 0 } = {}) {
  const vals = source.map((c) => String(c?.v ?? ''));
  const out = [];
  const nums = vals.map((v) => (v.trim() !== '' && !v.startsWith('=') && Number.isFinite(Number(v)) ? Number(v) : null));
  const allNums = nums.every((n) => n !== null) && vals.length > 0;
  const days = listSeries(vals, DAYS), months = listSeries(vals, MONTHS);
  const textNum = vals.map((v) => /^(.*?)(\d+)$/.exec(v));
  const allTextNum = textNum.every((m) => m && m[1] === textNum[0][1] && !vals[0].startsWith('='));
  for (let k = 1; k <= count; k++) {
    const src = source[(k - 1) % source.length] || {};
    let v;
    if (allNums && vals.length === 1 && src.s?.f !== 'date') v = String(nums[0]); // one number: copy it (as Excel does)
    else if (allNums) { const step = vals.length > 1 ? (nums[nums.length - 1] - nums[0]) / (nums.length - 1) : 1; v = String(Number((nums[nums.length - 1] + step * k).toPrecision(12))); }
    else if (days) v = days(k);
    else if (months) v = months(k);
    else if (allTextNum) { const ns = textNum.map((m) => Number(m[2])); const step = ns.length > 1 ? (ns[ns.length - 1] - ns[0]) / (ns.length - 1) : 1; v = `${textNum[0][1]}${ns[ns.length - 1] + step * k}`; }
    else { const shift = Math.ceil(k / source.length) * source.length; v = shiftRefs(src.v ?? '', dr * shift, dc * shift); }
    if (allNums && vals.length === 1 && src.s?.f === 'date') v = String(nums[0] + k);
    out.push({ v, ...(src.s ? { s: src.s } : {}) });
  }
  return out;
}

/** Put a block of values (rows of text) into a sheet at a cell, growing it if needed. */
export function pasteBlock(sheet, row, col, block, { styles = null } = {}) {
  const rows = Math.min(MAX_ROWS, Math.max(sheet.r, row + block.length));
  const cols = Math.min(MAX_COLS, Math.max(sheet.c, col + Math.max(...block.map((b) => b.length))));
  const cells = { ...sheet.cells };
  block.forEach((line, i) => line.forEach((v, j) => {
    const r = row + i, c = col + j;
    if (r >= rows || c >= cols) return;
    const k = cellKey(r, c);
    const s = styles?.[i]?.[j] ?? cells[k]?.s;
    if (v === '' && !s) delete cells[k]; else cells[k] = s ? { v, s } : { v };
  }));
  return { ...sheet, r: rows, c: cols, cells };
}

/** Parse CSV text into rows. */
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  const t = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
export function toCsv(rows) { return rows.map((r) => r.map((v) => (/[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n'); }

/** Names of the spreadsheet functions available (for suggestions while typing). */
export function functionNames() {
  const builtIn = 'ABS AND AVERAGE AVERAGEIF CEILING CHAR CONCAT CONCATENATE COUNT COUNTIF COUNTIFS DATE DAY DAYS EXACT EXP FALSE FIND FLOOR HLOOKUP HOUR IF IFERROR IFNA IFS INDEX INT ISBLANK ISERROR ISNUMBER ISTEXT LEFT LEN LN LOG LOG10 LOWER MID MINUTE MOD MONTH NOT NOW OR PI POWER PRODUCT PROPER RAND RANDBETWEEN REPLACE REPT RIGHT ROUND ROUNDDOWN ROUNDUP SEARCH SECOND SIGN SQRT SUM SUMIF SUMPRODUCT TODAY TRIM TRUE TRUNC VLOOKUP WEEKDAY YEAR'.split(' ');
  return [...new Set([...builtIn, ...Object.keys(EXTRA_FUNCTIONS)])].sort();
}


/* =====================================================================
   Excel number format codes, e.g. "#,##0.00;[Red](#,##0.00)", "0.0%", "dddd, mmmm d, yyyy", "# ?/?"
   ===================================================================== */
const CODE_COLORS = { black: '#000000', blue: '#0000ff', cyan: '#00ffff', green: '#008000', magenta: '#ff00ff', red: '#ff0000', white: '#ffffff', yellow: '#ffff00' };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function splitSections(code) {
  const out = []; let cur = '', q = false, br = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' && !br) q = !q;
    if (!q && ch === '[') br = true; if (!q && ch === ']') br = false;
    if (ch === '\\' && !q) { cur += ch + (code[i + 1] ?? ''); i++; continue; }
    if (ch === ';' && !q && !br) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur); return out;
}
/** Split a section into literal text and the number mask, honouring quotes and escapes. */
function tokens(sec) {
  const out = []; let i = 0;
  while (i < sec.length) {
    const ch = sec[i];
    if (ch === '"') { const j = sec.indexOf('"', i + 1); out.push({ lit: sec.slice(i + 1, j < 0 ? undefined : j) }); i = j < 0 ? sec.length : j + 1; continue; }
    if (ch === '\\') { out.push({ lit: sec[i + 1] ?? '' }); i += 2; continue; }
    if (ch === '_') { out.push({ lit: ' ' }); i += 2; continue; } // space the width of the next character
    if (ch === '*') { i += 2; continue; } // repeat-to-fill: not shown
    if (ch === '[') { const j = sec.indexOf(']', i); out.push({ br: sec.slice(i + 1, j < 0 ? undefined : j) }); i = j < 0 ? sec.length : j + 1; continue; }
    out.push({ ch }); i++;
  }
  return out;
}
const isDateSection = (toks) => toks.some((t) => t.ch && /[ymdhs]/i.test(t.ch)) || toks.some((t) => t.br && /^(h+|m+|s+)$/i.test(t.br));
function fmtDate(value, toks) {
  const ms = Math.round((value - 25569) * 86400000);
  const d = new Date(ms); if (Number.isNaN(d.getTime())) return '#VALUE!';
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), W = d.getUTCDay();
  let H = d.getUTCHours(); const Mi = d.getUTCMinutes(), S = d.getUTCSeconds();
  const text = toks.map((t) => t.ch ?? '').join('');
  const ampm = /AM\/PM|A\/P/i.test(text);
  // group runs of the same letter
  const runs = []; for (const t of toks) { if (t.ch && runs.length && runs[runs.length - 1].ch && runs[runs.length - 1].ch.toLowerCase() === t.ch.toLowerCase() && /[ymdhs]/i.test(t.ch)) runs[runs.length - 1].n++; else runs.push({ ...t, n: 1 }); }
  let out = '';
  for (let i = 0; i < runs.length; i++) {
    const t = runs[i];
    if (t.lit !== undefined) { out += t.lit; continue; }
    if (t.br !== undefined) { if (/^h+$/i.test(t.br)) out += String(Math.floor(value * 24)); else if (/^m+$/i.test(t.br)) out += String(Math.floor(value * 1440)); else if (/^s+$/i.test(t.br)) out += String(Math.floor(value * 86400)); continue; }
    const c = t.ch.toLowerCase();
    if (c === 'y') out += t.n <= 2 ? String(Y).slice(-2) : String(Y);
    else if (c === 'm') {
      // minutes when right after hours or right before seconds
      const prev = runs.slice(0, i).reverse().find((x) => (x.ch && /[a-z]/i.test(x.ch)) || (x.br && /^h+$/i.test(x.br))); const next = runs.slice(i + 1).find((x) => (x.ch && /[a-z]/i.test(x.ch)) || (x.br && /^s+$/i.test(x.br)));
      if ((prev && (prev.br || prev.ch.toLowerCase() === 'h')) || (next && (next.br || next.ch.toLowerCase() === 's'))) out += t.n >= 2 ? String(Mi).padStart(2, '0') : String(Mi);
      else out += t.n === 1 ? String(M + 1) : t.n === 2 ? String(M + 1).padStart(2, '0') : t.n === 3 ? MONTH_NAMES[M].slice(0, 3) : t.n === 5 ? MONTH_NAMES[M][0] : MONTH_NAMES[M];
    } else if (c === 'd') out += t.n === 1 ? String(D) : t.n === 2 ? String(D).padStart(2, '0') : t.n === 3 ? DAY_NAMES[W].slice(0, 3) : DAY_NAMES[W];
    else if (c === 'h') { const h = ampm ? (H % 12 || 12) : H; out += t.n >= 2 ? String(h).padStart(2, '0') : String(h); }
    else if (c === 's') out += t.n >= 2 ? String(S).padStart(2, '0') : String(S);
    else if (c === 'a' || c === 'p') {
      const rest = text.slice(text.toLowerCase().indexOf('a', 0));
      if (/^AM\/PM/i.test(runs.slice(i).map((x) => x.ch ?? x.lit ?? '').join(''))) { out += H < 12 ? 'AM' : 'PM'; i += 4; }
      else if (/^A\/P/i.test(runs.slice(i).map((x) => x.ch ?? x.lit ?? '').join(''))) { out += H < 12 ? 'A' : 'P'; i += 2; }
      else out += t.ch.repeat(t.n);
      void rest;
    } else if (c === 'e') out += String(Y);
    else out += t.ch.repeat(t.n);
  }
  return out;
}
function groupThousands(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtNumber(v, toks, neg) {
  // the number mask: the first run of 0 # ? , . / E+ characters; everything else is literal
  let pct = 0; const parts = []; let mask = ''; let maskAt = -1;
  toks.forEach((t) => {
    if (t.lit !== undefined) { parts.push({ lit: t.lit }); return; }
    if (t.br !== undefined) { const cur = /^\$([^-\]]*)/.exec(t.br); if (cur) parts.push({ lit: cur[1] }); return; }
    const ch = t.ch;
    if (ch === '%') { pct++; parts.push({ lit: '%' }); return; }
    if (/[0#?,./]/.test(ch) || ((ch === 'E' || ch === 'e') && mask) || ((ch === '+' || ch === '-') && /E$/i.test(mask)) || (/\d/.test(ch) && mask.includes('/'))) {
      if (maskAt < 0) { maskAt = parts.length; parts.push({ mask: true }); }
      if (parts[parts.length - 1].mask) mask += ch; else parts.push({ lit: ch });
      return;
    }
    if (ch === ' ' && mask && !mask.includes('/') && /[0#?]$/.test(mask)) { // "# ?/?" fractions keep the space
      mask += ' '; return;
    }
    if (ch === '@') { parts.push({ lit: '' }); return; }
    parts.push({ lit: ch });
  });
  v *= 100 ** pct;
  let numText = '';
  if (!mask) numText = '';
  else if (/E[+-]/i.test(mask)) {
    const [m, e] = mask.split(/E[+-]/i); const decs = (m.split('.')[1] || '').replace(/[^0#?]/g, '').length;
    const intDigits = Math.max(1, (m.split('.')[0].match(/[0#?]/g) || []).length);
    let exp = v === 0 ? 0 : Math.floor(Math.log10(Math.abs(v))) - (intDigits - 1);
    let mant = v / 10 ** exp; if (Number(mant.toFixed(decs)) >= 10 ** intDigits) { mant /= 10; exp += 1; }
    numText = `${mant.toFixed(decs)}E${exp < 0 ? '-' : /E\+/i.test(mask) ? '+' : ''}${String(Math.abs(exp)).padStart((e.match(/0/g) || []).length, '0')}`;
  } else if (mask.includes('/')) {
    const [left, den] = mask.split('/'); const whole = /[0#?]\s+[0#?]/.test(left) || /\s/.test(left.trim()) ? Math.trunc(v) : 0;
    let frac = v - whole; let bestN = 0, bestD = 1;
    if (/^\d+$/.test(den.trim())) { bestD = Number(den.trim()); bestN = Math.round(frac * bestD); }
    else { const maxD = 10 ** Math.max(1, (den.match(/[0#?]/g) || []).length) - 1; let err = Infinity; for (let d = 1; d <= maxD; d++) { const n = Math.round(frac * d); const e2 = Math.abs(frac - n / d); if (e2 < err - 1e-12) { err = e2; bestN = n; bestD = d; } } }
    if (bestN === bestD) { bestN = 0; frac = 0; numText = String(whole + 1); }
    else numText = `${whole ? `${whole} ` : ''}${bestN ? `${bestN}/${bestD}` : whole ? '' : '0'}`.trim();
  } else {
    let [im, dm = ''] = mask.split('.');
    const scale = (/,+$/.exec(im) || [''])[0].length; if (scale) { im = im.replace(/,+$/, ''); v /= 1000 ** scale; }
    const decs = (dm.match(/[0#?]/g) || []).length;
    const fixed = Math.abs(v).toFixed(decs); let [ip, dp = ''] = fixed.split('.');
    const minInt = (im.match(/0/g) || []).length;
    if (ip === '0' && minInt === 0) ip = ''; ip = ip.padStart(minInt, '0');
    if (im.includes(',')) ip = groupThousands(ip);
    // decimal placeholders: '#' drops trailing zeros, '?' turns them into spaces
    const dmask = dm.replace(/[^0#?]/g, '');
    let dOut = dp.split('');
    for (let i = dOut.length - 1; i >= 0; i--) { if (dOut[i] !== '0') break; if (dmask[i] === '#') dOut.pop(); else if (dmask[i] === '?') dOut[i] = ' '; else break; }
    numText = ip + (dm !== '' && (dOut.length || dm.includes('.') || dmask.length) ? `.${dOut.join('')}` : '');
    if (dmask.length === 0 && dm === '' && mask.endsWith('.')) numText += '.';
  }
  let out = parts.map((p) => (p.mask ? numText : p.lit)).join('');
  if (neg) out = `-${out}`;
  return out;
}
/** Format a value with an Excel format code. Returns { text, color }. */
export function formatCode(value, code) {
  if (value === null || value === undefined || value === '') return { text: '' };
  const secs = splitSections(String(code));
  let color = null;
  if (typeof value !== 'number') {
    if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' };
    const sec = secs.length >= 4 ? secs[3] : secs.find((x) => x.includes('@'));
    if (!sec) return { text: String(value) };
    const t = tokens(sec); return { text: t.map((x) => (x.ch === '@' ? String(value) : x.lit ?? (x.br !== undefined ? '' : x.ch))).join(''), color: (() => { const b = t.find((x) => x.br && CODE_COLORS[x.br.toLowerCase()]); return b ? CODE_COLORS[b.br.toLowerCase()] : null; })() };
  }
  // pick the section: conditions like [>100], else positive;negative;zero
  let sec = secs[0], v = value, neg = false;
  const cond = (x) => /^\[(<=|>=|<>|<|>|=)(-?[\d.]+)\]/.exec(x.replace(/\[(black|blue|cyan|green|magenta|red|white|yellow|color\d+)\]/i, ''));
  if (secs.some((x) => cond(x))) {
    const test = (x) => { const m = cond(x); if (!m) return null; const n = Number(m[2]); return { '<': v < n, '>': v > n, '=': v === n, '<=': v <= n, '>=': v >= n, '<>': v !== n }[m[1]]; };
    sec = secs.find((x) => test(x) === true) ?? secs.find((x) => !cond(x) && !x.includes('@')) ?? secs[secs.length - 1];
    if (v < 0 && cond(sec)) { v = Math.abs(v); neg = !/[-(]/.test(sec.replace(/\[[^\]]*\]/g, '')); }
  } else if (v < 0 && secs.length >= 2 && secs[1] !== '') { sec = secs[1]; v = -v; }
  else if (v === 0 && secs.length >= 3) sec = secs[2];
  else if (v < 0) { v = -v; neg = true; }
  if (/^general$/i.test(sec.trim().replace(/\[[^\]]*\]/g, ''))) {
    const t = tokens(sec); const b = t.find((x) => x.br && CODE_COLORS[x.br.toLowerCase()]);
    return { text: `${neg ? '-' : ''}${Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10)))}`, color: b ? CODE_COLORS[b.br.toLowerCase()] : null };
  }
  const t = tokens(sec);
  for (const x of t) if (x.br && CODE_COLORS[x.br.toLowerCase()]) color = CODE_COLORS[x.br.toLowerCase()];
  const body = t.filter((x) => !(x.br && (CODE_COLORS[x.br.toLowerCase()] || /^(<=|>=|<>|<|>|=)/.test(x.br) || /^color\d+$/i.test(x.br))));
  if (isDateSection(body)) return { text: fmtDate(neg ? -v : v, body), color };
  return { text: fmtNumber(v, body, neg), color };
}
/** Format codes for the Format Cells categories. */
export const CATEGORY_CODES = {
  number: (dp = 2, sep = true, negRed = false) => { const b = `${sep ? '#,##0' : '0'}${dp ? `.${'0'.repeat(dp)}` : ''}`; return negRed ? `${b};[Red]${b}` : b; },
  currency: (dp = 2, sym = '$', negRed = false) => { const b = `${sym}#,##0${dp ? `.${'0'.repeat(dp)}` : ''}`; return negRed ? `${b};[Red]-${b}` : b; },
  accounting: (dp = 2, sym = '$') => { const d = dp ? `.${'0'.repeat(dp)}` : ''; return `_(${sym}* #,##0${d}_);_(${sym}* (#,##0${d});_(${sym}* "-"${'?'.repeat(dp)}_);_(@_)`; },
  percent: (dp = 0) => `0${dp ? `.${'0'.repeat(dp)}` : ''}%`,
  scientific: (dp = 2) => `0${dp ? `.${'0'.repeat(dp)}` : ''}E+00`,
};
export const DATE_CODES = ['m/d/yyyy', 'yyyy-mm-dd', 'dddd, mmmm d, yyyy', 'd-mmm-yy', 'd-mmm', 'mmm-yy', 'mmmm d, yyyy', 'm/d/yy h:mm AM/PM'];
export const TIME_CODES = ['h:mm:ss AM/PM', 'h:mm AM/PM', 'h:mm', 'h:mm:ss', 'mm:ss', '[h]:mm:ss'];
export const FRACTION_CODES = ['# ?/?', '# ??/??', '# ???/???', '# ?/2', '# ?/4', '# ?/8', '# ??/16', '# ?/10', '# ??/100'];

const nameSheet = (ref) => { const i = String(ref).lastIndexOf('!'); return i > 0 ? String(ref).slice(0, i).replace(/^'|'$/g, '') : ''; };
/* =====================================================================
   Insert / delete cells with shifting (Excel's "Shift cells down/right/up/left")
   ===================================================================== */
function shiftRefsWhere(formula, sheetName, sameSheet, move) {
  if (!String(formula).startsWith('=')) return formula;
  return String(formula).split('"').map((part, i) => (i % 2 ? part : part.replace(REF_RE, (m, sh, d1, col, d2, row) => {
    const target = sh ? sh.slice(0, -1).replace(/^'|'$/g, '') : null;
    if (!(target ? target.toLowerCase() === sheetName.toLowerCase() : sameSheet)) return m;
    const res = move(Number(row) - 1, colIndex(col)); if (!res) return '#REF!';
    return `${sh || ''}${d1}${colName(res[1])}${d2}${res[0] + 1}`;
  }))).join('"');
}
/** dir: 'down' | 'right' (insert) or 'up' | 'left' (delete) for the block g on sheet `index`. */
export function shiftCells(data, index, g, dir) {
  const wb = normalizeWorkbook(data); const sheet = wb.sheets[index]; if (!sheet) return wb;
  const n = dir === 'down' || dir === 'up' ? g.r2 - g.r1 + 1 : g.c2 - g.c1 + 1;
  const inCols = (c) => c >= g.c1 && c <= g.c2, inRows = (r) => r >= g.r1 && r <= g.r2;
  const move = (r, c) => {
    if (dir === 'down') return inCols(c) && r >= g.r1 ? [r + n, c] : [r, c];
    if (dir === 'right') return inRows(r) && c >= g.c1 ? [r, c + n] : [r, c];
    if (dir === 'up') { if (inCols(c) && inRows(r)) return null; return inCols(c) && r > g.r2 ? [r - n, c] : [r, c]; }
    if (inRows(r) && inCols(c)) return null; return inRows(r) && c > g.c2 ? [r, c - n] : [r, c];
  };
  const sheets = wb.sheets.map((sh, i) => {
    const same = i === index; const cells = {};
    for (const [k, cell] of Object.entries(sh.cells)) {
      let { row, col } = parseKey(k);
      if (same) { const to = move(row, col); if (!to) continue; [row, col] = to; if (row >= MAX_ROWS || col >= MAX_COLS) continue; }
      cells[cellKey(row, col)] = { ...cell, v: shiftRefsWhere(cell.v, sheet.name, same, move) };
    }
    if (!same) return { ...sh, cells };
    const merges = sh.merges.map((m) => { const mg = parseRange(m); const a = move(mg.r1, mg.c1), b = move(mg.r2, mg.c2); return a && b ? rangeRef({ r1: a[0], c1: a[1], r2: b[0], c2: b[1] }) : null; }).filter(Boolean);
    return { ...sh, cells, merges };
  });
  const names = Object.fromEntries(Object.entries(wb.names || {}).map(([k, ref]) => [k, shiftRefsWhere(`=${ref}`, sheet.name, nameSheet(ref).toLowerCase() === sheet.name.toLowerCase(), move).slice(1)]));
  return normalizeWorkbook({ sheets, names });
}

/* Sort a block (only its own columns, as Excel does), by several keys */
export function sortRange(sheet, values, g, keys, header = false) {
  const from = g.r1 + (header ? 1 : 0); if (g.r2 <= from) return sheet;
  const rows = [];
  for (let r = from; r <= g.r2; r++) { const cells = {}; for (let c = g.c1; c <= g.c2; c++) { const k = cellKey(r, c); if (sheet.cells[k]) cells[c] = sheet.cells[k]; } rows.push({ r, cells, keyVals: keys.map((k) => { const v = values[cellKey(r, k.col)]?.value; return v === '' ? null : v; }) }); }
  rows.sort((a, b) => { for (let i = 0; i < keys.length; i++) { const x = a.keyVals[i], y = b.keyVals[i]; if (x == null || y == null) { if (x == null && y == null) continue; return (x == null) - (y == null); } const c = cmpVals(x, y); if (c) return keys[i].dir === 'desc' ? -c : c; } return a.r - b.r; });
  const cells = { ...sheet.cells };
  for (let r = from; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) delete cells[cellKey(r, c)];
  rows.forEach((row, i) => { const to = from + i; for (const [c, cell] of Object.entries(row.cells)) cells[cellKey(to, Number(c))] = { ...cell, v: to !== row.r ? shiftRefs(cell.v, to - row.r, 0) : cell.v }; });
  return { ...sheet, cells };
}
/** Remove rows in g whose values in `cols` repeat an earlier row (rows below move up within the block). */
export function removeDuplicates(sheet, values, g, cols, header = false) {
  const from = g.r1 + (header ? 1 : 0); const seen = new Set(); const keep = []; let removed = 0;
  for (let r = from; r <= g.r2; r++) {
    const key = JSON.stringify(cols.map((c) => { const v = values[cellKey(r, c)]?.value; return typeof v === 'string' ? v.toLowerCase() : v ?? null; }));
    if (seen.has(key)) { removed++; continue; } seen.add(key); keep.push(r);
  }
  const cells = { ...sheet.cells }; const old = sheet.cells;
  for (let r = from; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) delete cells[cellKey(r, c)];
  keep.forEach((r, i) => { for (let c = g.c1; c <= g.c2; c++) { const cell = old[cellKey(r, c)]; if (cell) cells[cellKey(from + i, c)] = cell; } });
  return { sheet: { ...sheet, cells }, removed, kept: keep.length };
}
/** Split one column of text into several by delimiters. */
export function textToColumns(sheet, g, { delims = [','], other = '', quote = '"', merge = false, dest = null } = {}) {
  const set = [...delims.map((d) => ({ tab: '\t', comma: ',', semicolon: ';', space: ' ' }[d] ?? d)), ...(other ? [other] : [])];
  const cells = { ...sheet.cells }; const at = dest || { r: g.r1, c: g.c1 }; let maxCols = 0;
  for (let r = g.r1; r <= g.r2; r++) {
    const text = String(sheet.cells[cellKey(r, g.c1)]?.v ?? ''); if (!text) continue;
    const parts = []; let cur = '', q = false;
    for (let i = 0; i < text.length; i++) { const ch = text[i]; if (quote && ch === quote) { q = !q; continue; } if (!q && set.includes(ch)) { parts.push(cur); cur = ''; if (merge) while (set.includes(text[i + 1])) i++; continue; } cur += ch; }
    parts.push(cur); maxCols = Math.max(maxCols, parts.length);
    parts.forEach((p, j) => { const k = cellKey(at.r + (r - g.r1), at.c + j); if (p === '') delete cells[k]; else cells[k] = { ...(cells[k]?.s ? { s: cells[k].s } : {}), v: p }; });
  }
  return { sheet: { ...sheet, cells }, cols: maxCols };
}

/* Data validation: does a value pass the rule? */
export function dvRuleAt(sheet, r, c) { for (const rule of sheet.dv || []) for (const part of rule.range.split(' ')) { const g = parseRange(part); if (g && r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) return rule; } return null; }
export function dvListItems(rule, wb, sheetName) {
  const src = String(rule.v1 || '').trim();
  if (src.startsWith('=')) { // a range or name
    const ref = expandNames(src.slice(1), wb.names || {}); const bang = ref.lastIndexOf('!');
    const sh = bang > 0 ? wb.sheets.find((s) => s.name.toLowerCase() === ref.slice(0, bang).replace(/^'|'$/g, '').toLowerCase()) : wb.sheets.find((s) => s.name === sheetName);
    const g = parseRange((bang > 0 ? ref.slice(bang + 1) : ref).replace(/\$/g, '')); if (!sh || !g) return [];
    const vals = displayWorkbook(wb)[sh.name] || {}; const out = [];
    for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 999); r++) for (let c = g.c1; c <= g.c2; c++) { const t = vals[cellKey(r, c)]?.text; if (t) out.push(t); }
    return out;
  }
  return src.split(',').map((x) => x.trim()).filter(Boolean);
}
export function dvCheck(rule, value, text, wb, sheetName) {
  if (value === null || value === undefined || value === '') return rule.blank !== false;
  const n = typeof value === 'number' ? value : Number(value);
  const cmp = (x) => { const a = Number(rule.v1), b = Number(rule.v2); switch (rule.op || 'between') { case 'between': return x >= Math.min(a, b) && x <= Math.max(a, b); case 'notbetween': return x < Math.min(a, b) || x > Math.max(a, b); case 'eq': return x === a; case 'ne': return x !== a; case 'gt': return x > a; case 'lt': return x < a; case 'ge': return x >= a; case 'le': return x <= a; default: return true; } };
  switch (rule.type) {
    case 'list': return dvListItems(rule, wb, sheetName).some((x) => x.toLowerCase() === String(text ?? value).toLowerCase());
    case 'whole': return Number.isInteger(n) && cmp(n);
    case 'decimal': return Number.isFinite(n) && cmp(n);
    case 'date': { const d = (s) => { const p = parseInput(s); return Number(p.v); }; const a = d(rule.v1), b = d(rule.v2); const x = n; switch (rule.op || 'between') { case 'between': return x >= Math.min(a, b) && x <= Math.max(a, b); case 'gt': return x > a; case 'lt': return x < a; case 'ge': return x >= a; case 'le': return x <= a; case 'eq': return x === a; default: return Number.isFinite(x); } }
    case 'textlen': return cmp(String(text ?? value).length);
    default: return true;
  }
}


/* =====================================================================
   Tables (Format as Table) and structured references: Table1[Amount], [@Amount], Table1[#Totals]...
   ===================================================================== */
export function tableAt(sheet, r, c) { for (const t of sheet.tables || []) { const g = parseRange(t.range); if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) return t; } return null; }
export function tableColumns(sheet, t) { const g = parseRange(t.range); return Array.from({ length: g.c2 - g.c1 + 1 }, (_, i) => (t.header ? String(sheet.cells[cellKey(g.r1, g.c1 + i)]?.v ?? '') : '') || `Column${i + 1}`); }
/** The parts of a table: header row, data rows, totals row (row indices). */
export function tableParts(t) { const g = parseRange(t.range); return { g, hr: t.header ? g.r1 : null, d1: g.r1 + (t.header ? 1 : 0), d2: g.r2 - (t.total ? 1 : 0), tr: t.total ? g.r2 : null }; }
export function expandStructured(formula, wb, sheet, row) {
  if (!/\[/.test(formula)) return formula;
  const all = []; for (const sh of wb.sheets) for (const t of sh.tables || []) all.push({ sh, t });
  const find = (name) => all.find((x) => x.t.name.toLowerCase() === name.toLowerCase());
  const here = all.find((x) => x.sh === sheet && (() => { const g = parseRange(x.t.range); return row >= g.r1 && row <= g.r2; })());
  const q = (sh) => (/^[A-Za-z_][\w.]*$/.test(sh.name) ? sh.name : `'${sh.name}'`);
  const refFor = ({ sh, t }, spec) => {
    const P = tableParts(t); const cols = tableColumns(sh, t);
    const colIdx = (name) => { const i = cols.findIndex((c) => c.toLowerCase() === name.trim().replace(/^\[|\]$/g, '').replace(/'(.)/g, '$1').toLowerCase()); return i < 0 ? null : P.g.c1 + i; };
    let r1 = P.d1, r2 = P.d2, c1 = P.g.c1, c2 = P.g.c2; let thisRow = false;
    const parts = spec.split(/\]\s*,\s*\[|,(?![^[]*\])/).map((x) => x.replace(/^\[|\]$/g, '').trim()).filter(Boolean);
    const colParts = [];
    for (const part of parts) {
      const m = part.replace(/^\[|\]$/g, '');
      if (/^#all$/i.test(m)) { r1 = P.g.r1; r2 = P.g.r2; }
      else if (/^#data$/i.test(m)) { r1 = P.d1; r2 = P.d2; }
      else if (/^#headers$/i.test(m)) { if (P.hr === null) return '#REF!'; r1 = r2 = P.hr; }
      else if (/^#totals$/i.test(m)) { if (P.tr === null) return '#REF!'; r1 = r2 = P.tr; }
      else if (/^#this row$/i.test(m) || m === '@') thisRow = true;
      else if (m.startsWith('@')) { thisRow = true; colParts.push(m.slice(1)); }
      else colParts.push(m);
    }
    if (colParts.length) {
      const span = colParts.join(',').split(']:[').map((x) => x.replace(/^\[|\]$/g, ''));
      const a = colIdx(span[0]), b = colIdx(span[span.length - 1]); if (a === null || b === null) return '#REF!';
      c1 = Math.min(a, b); c2 = Math.max(a, b);
    }
    if (thisRow) { if (row < P.d1 || row > P.d2) return '#VALUE!'; r1 = r2 = row; }
    const ref = r1 === r2 && c1 === c2 ? cellKey(r1, c1) : `${cellKey(r1, c1)}:${cellKey(r2, c2)}`;
    return sh === sheet ? ref : `${q(sh)}!${ref}`;
  };
  return String(formula).split('"').map((part, i) => (i % 2 ? part : part
    .replace(/([A-Za-z_][\w.]*)\[((?:[^[\]]|\[[^\]]*\])*)\]/g, (m, name, spec) => { const t = find(name); return t ? refFor(t, spec) : m; })
    .replace(/(^|[^\w\]])\[(@?[^[\]]+|\[[^\]]*\](?:,\[[^\]]*\])*)\]/g, (m, pre, spec) => (here ? `${pre}${refFor(here, spec)}` : m)))).join('"');
}

/* =====================================================================
   PivotTables: summarise a source range by row/column fields
   ===================================================================== */
export function pivotSource(wb, src) {
  const i = src.lastIndexOf('!'); const sh = wb.sheets.find((x) => x.name.toLowerCase() === src.slice(0, i).replace(/^'|'$/g, '').toLowerCase());
  const g = sh && parseRange(src.slice(i + 1).replace(/\$/g, '')); if (!sh || !g) return null;
  const vals = evaluateWorkbook(wb)[sh.name] || {};
  const fields = []; for (let c = g.c1; c <= g.c2; c++) fields.push(String(vals[cellKey(g.r1, c)]?.value ?? sh.cells[cellKey(g.r1, c)]?.v ?? `Column${c - g.c1 + 1}`) || `Column${c - g.c1 + 1}`);
  const rows = []; const used = usedRange(sh, vals);
  for (let r = g.r1 + 1; r <= Math.min(g.r2, used.rows - 1); r++) { const rec = {}; let any = false; fields.forEach((f, j) => { const v = vals[cellKey(r, g.c1 + j)]?.value; rec[f] = v ?? null; if (v !== null && v !== undefined && v !== '') any = true; }); if (any) rows.push(rec); }
  return { sheet: sh, g, fields, rows };
}
const AGG = {
  sum: (xs) => xs.filter((x) => typeof x === 'number').reduce((a, b) => a + b, 0),
  count: (xs) => xs.filter((x) => x !== null && x !== '').length,
  average: (xs) => { const n = xs.filter((x) => typeof x === 'number'); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; },
  max: (xs) => { const n = xs.filter((x) => typeof x === 'number'); return n.length ? Math.max(...n) : null; },
  min: (xs) => { const n = xs.filter((x) => typeof x === 'number'); return n.length ? Math.min(...n) : null; },
};
const FN_LABEL = { sum: 'Sum', count: 'Count', average: 'Average', max: 'Max', min: 'Min' };
/** Build a PivotTable's output: a grid of { v, s } cells (bold headers, totals). */
export function computePivot(wb, def) {
  const src = pivotSource(wb, def.src); if (!src) return { grid: [[{ v: 'The PivotTable’s source data isn’t valid.' }]] };
  const pass = (rec) => Object.entries(def.filters || {}).every(([f, allowed]) => !allowed || allowed.includes(String(rec[f] ?? '(blank)')));
  const recs = src.rows.filter(pass);
  const key = (rec, fs) => fs.map((f) => String(rec[f] ?? '(blank)'));
  const sortKeys = (list) => list.sort((a, b) => { for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; const nx = Number(x), ny = Number(y); const c = !Number.isNaN(nx) && !Number.isNaN(ny) && x !== '' && y !== '' ? nx - ny : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }); if (c) return c; } return 0; });
  const uniq = (fs) => sortKeys([...new Map(recs.map((r) => { const k = key(r, fs); return [JSON.stringify(k), k]; })).values()]);
  const rowKeys = def.rows.length ? uniq(def.rows) : [[]]; const colKeys = def.cols.length ? uniq(def.cols) : [[]];
  const vals = def.vals.length ? def.vals : [];
  const valLabel = (v) => `${FN_LABEL[v.fn]} of ${v.f}`;
  const cellFor = (rk, ck, v) => { const xs = recs.filter((r) => (!def.rows.length || JSON.stringify(key(r, def.rows)) === JSON.stringify(rk)) && (!def.cols.length || JSON.stringify(key(r, def.cols)) === JSON.stringify(ck))).map((r) => r[v.f]); if (!xs.length) return ''; const out = AGG[v.fn](xs); return out === null ? '' : String(Number(Number(out).toPrecision(15))); }; // no data: blank, as in Excel
  const B = { b: 1 }, HEAD = { b: 1, bg: '#ddebf7', bd: { b: 1 }, bc: '#9bc2e6' }, TOT = { b: 1, bd: { t: 1 }, bc: '#9bc2e6', bg: '#ddebf7' };
  const grid = [];
  if (!vals.length) { grid.push([{ v: 'PivotTable: choose fields to add to the report', s: { i: 1 } }]); return { grid, fields: src.fields }; }
  // header rows
  const valCols = []; for (const ck of colKeys) for (const v of vals) valCols.push({ ck, v });
  const head1 = [{ v: def.rows.length ? def.rows.join(' / ') : '', s: HEAD }];
  if (def.cols.length) { for (const { ck, v } of valCols) head1.push({ v: `${ck.join(' / ')}${vals.length > 1 ? ` – ${valLabel(v)}` : ''}`, s: HEAD }); if (def.grand) for (const v of vals) head1.push({ v: vals.length > 1 ? `Total ${valLabel(v)}` : 'Grand Total', s: HEAD }); }
  else for (const v of vals) head1.push({ v: valLabel(v), s: HEAD });
  if (def.cols.length) grid.push([{ v: vals.length === 1 ? valLabel(vals[0]) : '', s: B }, { v: def.cols.join(' / '), s: B }]);
  grid.push(head1);
  for (const rk of rowKeys) {
    const line = [{ v: def.rows.length ? rk.join(' / ') : 'Total', s: def.rows.length ? null : B }];
    for (const { ck, v } of valCols) line.push({ v: cellFor(rk, ck, v), s: null });
    if (def.cols.length && def.grand) for (const v of vals) { // this row's total across all columns
      const xs = recs.filter((r) => !def.rows.length || JSON.stringify(key(r, def.rows)) === JSON.stringify(rk)).map((r) => r[v.f]);
      const o = xs.length ? AGG[v.fn](xs) : null; line.push({ v: o === null ? '' : String(Number(Number(o).toPrecision(15))), s: B });
    }
    grid.push(line);
  }
  if (def.rows.length && def.grand) {
    const tot = [{ v: 'Grand Total', s: TOT }];
    for (const { ck, v } of valCols) { const xs = recs.filter((r) => !def.cols.length || JSON.stringify(key(r, def.cols)) === JSON.stringify(ck)).map((r) => r[v.f]); const o = AGG[v.fn](xs); tot.push({ v: o === null ? '' : String(Number(Number(o).toPrecision(15))), s: TOT }); }
    if (def.cols.length) for (const v of vals) { const o = AGG[v.fn](recs.map((r) => r[v.f])); tot.push({ v: o === null ? '' : String(Number(Number(o).toPrecision(15))), s: TOT }); }
    grid.push(tot);
  }
  return { grid, fields: src.fields };
}
/** Write (or rewrite) a PivotTable's output onto its sheet. */
export function refreshPivot(data, sheetIndex, pivotId) {
  const wb = normalizeWorkbook(data); const sh = wb.sheets[sheetIndex]; const def = sh?.pivots.find((p) => p.id === pivotId); if (!def) return wb;
  const { grid } = computePivot(wb, def);
  if (def.out) { const g = parseRange(def.out); for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) delete sh.cells[cellKey(r, c)]; }
  const at = parseKey(def.at); let maxC = 0;
  grid.forEach((row, i) => row.forEach((cell, j) => { maxC = Math.max(maxC, j); if (cell.v === '' && !cell.s) return; sh.cells[cellKey(at.row + i, at.col + j)] = { v: String(cell.v), ...(cell.s ? { s: cell.s } : {}) }; }));
  def.out = rangeRef({ r1: at.row, c1: at.col, r2: at.row + grid.length - 1, c2: at.col + maxC });
  return normalizeWorkbook(wb);
}

/* =====================================================================
   Goal Seek: change one input cell until a formula cell reaches a target
   ===================================================================== */
export function goalSeek(data, sheetName, setKey, target, changeKey) {
  const wb = normalizeWorkbook(data); const sh = wb.sheets.find((x) => x.name === sheetName); if (!sh) return { ok: false };
  const f = (x) => { sh.cells[changeKey] = { ...(sh.cells[changeKey] || {}), v: String(x) }; const v = evaluateWorkbook(wb)[sheetName]?.[setKey]?.value; return typeof v === 'number' && Number.isFinite(v) ? v - target : NaN; };
  const tol = 1e-7 * Math.max(1, Math.abs(target));
  const start = Number(evaluateWorkbook(wb)[sheetName]?.[changeKey]?.value) || 0;
  // 1) secant steps from the current value (fast when the formula is smooth)
  let x0 = start, x1 = start === 0 ? 1 : start * 1.01, f0 = f(x0), f1 = f(x1);
  for (let i = 0; i < 50 && Number.isFinite(f0) && Number.isFinite(f1); i++) {
    if (Math.abs(f1) < tol) return { ok: true, value: Number(x1.toPrecision(15)), result: target + f1 };
    const d = f1 - f0; if (d === 0) break;
    const x2 = x1 - (f1 * (x1 - x0)) / d; if (!Number.isFinite(x2)) break;
    x0 = x1; f0 = f1; x1 = x2; f1 = f(x1);
  }
  // 2) otherwise look outwards for a sign change, then bisect
  const probes = [start]; for (let k = 0; k < 60; k++) { const s2 = 2 ** k; probes.push(start + s2, start - s2, start * (1 + s2 / 1e3), start / (1 + s2)); }
  const pts = probes.filter((x) => Number.isFinite(x)).map((x) => ({ x, y: f(x) })).filter((p) => Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  const brackets = [];
  for (let i = 0; i + 1 < pts.length; i++) if (Math.sign(pts[i].y) !== Math.sign(pts[i + 1].y)) brackets.push([pts[i], pts[i + 1]]);
  brackets.sort((a, b) => Math.min(Math.abs(a[0].x - start), Math.abs(a[1].x - start)) - Math.min(Math.abs(b[0].x - start), Math.abs(b[1].x - start))); // nearest the starting value first
  for (const [A, Bk] of brackets) {
    let lo = A.x, hi = Bk.x, flo = A.y, mid = lo, fm = flo, broke = false;
    for (let i = 0; i < 200; i++) { mid = (lo + hi) / 2; fm = f(mid); if (!Number.isFinite(fm)) { broke = true; break; } if (Math.abs(fm) < tol) break; if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid; }
    if (!broke && Math.abs(fm) < tol * 100) return { ok: true, value: Number(mid.toPrecision(15)), result: target + fm };
  }
  return { ok: false, value: start, result: target + f(start) };
}

/* =====================================================================
   Formula auditing: which cells a formula reads (precedents) and which formulas read a cell (dependents)
   ===================================================================== */
export function precedents(wb, sheet, key) {
  const v = sheet.cells[key]?.v; if (!String(v || '').startsWith('=')) return [];
  const p = parseKey(key); const f = expandStructured(expandNames(String(v).slice(1), wb.names), wb, sheet, p.row);
  const out = [];
  for (const m of f.split('"').filter((_, i) => i % 2 === 0).join(' ').matchAll(/((?:'[^']+'|[A-Za-z_][\w.]*)!)?(\$?[A-Z]{1,2}\$?\d+(?::\$?[A-Z]{1,2}\$?\d+)?)(?![\w(!])/g)) {
    const g = parseRange(m[2].replace(/\$/g, '')); if (!g) continue;
    out.push({ sheet: m[1] ? m[1].slice(0, -1).replace(/^'|'$/g, '') : sheet.name, g });
  }
  return out;
}
export function dependents(wb, sheet, key) {
  const p = parseKey(key); const out = [];
  for (const sh of wb.sheets) for (const k of Object.keys(sh.cells)) {
    if (!String(sh.cells[k].v || '').startsWith('=')) continue;
    if (precedents(wb, sh, k).some((x) => x.sheet.toLowerCase() === sheet.name.toLowerCase() && p.row >= x.g.r1 && p.row <= x.g.r2 && p.col >= x.g.c1 && p.col <= x.g.c2)) out.push({ sheet: sh.name, key: k });
  }
  return out;
}

/* ---------- Table styles (Format as Table): Light, Medium and Dark, six colour families ---------- */
// Excel's gallery order: 1 dark grey, 2 blue (the default), 3 orange, 4 grey, 5 gold, 6 green
const FAMILIES = [['#595959', '#d9d9d9', '#bfbfbf', '#262626'], ['#4472c4', '#d9e1f2', '#b4c6e7', '#203764'], ['#ed7d31', '#fce4d6', '#f8cbad', '#833c0c'], ['#a5a5a5', '#ededed', '#dbdbdb', '#3a3a3a'], ['#ffc000', '#fff2cc', '#ffe699', '#7f6000'], ['#70ad47', '#e2efda', '#c6e0b4', '#375623']];
export const TABLE_STYLES = [...[1, 2, 3, 4, 5, 6].map((n) => `light${n}`), ...[1, 2, 3, 4, 5, 6].map((n) => `medium${n}`), ...[1, 2, 3, 4, 5, 6].map((n) => `dark${n}`)];
export function tableStyleDef(name) {
  const m = /^(light|medium|dark)(\d+)$/.exec(name || 'medium2') || [null, 'medium', '2']; const [main, pale, mid, deep] = FAMILIES[(Number(m[2]) - 1) % 6];
  if (m[1] === 'light') return { head: { b: 1, bd: { b: 1 }, bc: main }, band: { bg: pale }, total: { b: 1, bd: { t: 3 }, bc: main }, edge: main };
  if (m[1] === 'dark') return { head: { b: 1, bg: deep, fg: '#ffffff' }, band: { bg: mid }, plain: { bg: pale }, total: { b: 1, bg: deep, fg: '#ffffff' }, edge: deep };
  return { head: { b: 1, bg: main, fg: '#ffffff' }, band: { bg: pale }, plain: { bg: '#ffffff' }, total: { b: 1, bd: { t: 3 }, bc: main, bg: pale }, edge: main };
}
/** The table look of a cell (underneath its own formatting), or null. */
export function tableStyleAt(sheet, r, c) {
  const t = tableAt(sheet, r, c); if (!t) return null;
  const P = tableParts(t); const def = tableStyleDef(t.style); let st = {};
  if (P.hr === r) st = { ...def.head };
  else if (P.tr === r) st = { ...def.total };
  else {
    const i = r - P.d1, j = c - P.g.c1;
    st = { ...(def.plain || {}) };
    if (t.banded && i % 2 === 0) st = { ...st, ...def.band };
    if (t.bandedCols && j % 2 === 0) st = { ...st, ...def.band };
    if ((t.firstCol && c === P.g.c1) || (t.lastCol && c === P.g.c2)) st.b = 1;
  }
  return st;
}


/* =====================================================================
   Recalculating only what an edit affects (as Excel does). A calculator remembers the last workbook, its values and
   which formulas read which cells; after an edit only the changed cells and the formulas that depend on them (directly
   or through other formulas) are recalculated. Anything risky falls back to a full recalculation: structural changes
   (sheets, names, tables), spill formulas, volatile functions and references only known while calculating.
   ===================================================================== */
const VOLATILE = /\b(NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY|INDIRECT|OFFSET|INFO|CELL)\s*\(/i;
const SPILLY = /\b(UNIQUE|SORT|SORTBY|FILTER|SEQUENCE|RANDARRAY|TRANSPOSE|FREQUENCY|MMULT|MINVERSE)\s*\(|[A-Z]\d+#|\$?[A-Z]{1,2}\$?\d+:\$?[A-Z]{1,2}\$?\d+\s*[-+*/^&<>=]/i;
export function createCalculator() {
  let last = null; // { wb, values, chain, structure, reverse, risky }
  const structureOf = (wb) => JSON.stringify([wb.sheets.map((s) => [s.id, s.name, s.r, s.c, s.tables, s.pivots?.map((p) => p.out)]), wb.names]);
  const reverseOf = (chain) => { const rev = new Map(); for (const [id, deps] of chain.deps) for (const d of deps) (rev.get(d) || rev.set(d, new Set()).get(d)).add(id); return rev; };
  const full = (wb) => {
    const chain = calcChain(wb); const values = evaluateWorkbook(wb, { wb, chain, values: {}, dirty: new Set(chain.map((c) => c.id)) });
    const risky = Object.values(values).some((vals) => Object.values(vals).some((v) => v?.spill || v?.spillRange)) || wb.sheets.some((s) => Object.values(s.cells).some((c) => typeof c.v === 'string' && c.v.startsWith('=') && (VOLATILE.test(c.v) || SPILLY.test(c.v))));
    last = { wb, values, chain, structure: structureOf(wb), reverse: reverseOf(chain), risky };
    return values;
  };
  return {
    /** Values for every cell of `data`, recalculating as little as possible. */
    evaluate(data, { tidy = true } = {}) {
      const wb = tidy ? normalizeWorkbook(data) : data; // the app passes workbooks it has already tidied
      if (!last || last.risky || structureOf(wb) !== last.structure) return full(wb);
      // which cells changed value or formula
      const changed = []; let formulaChanged = false;
      for (let i = 0; i < wb.sheets.length; i++) {
        const a = last.wb.sheets[i].cells, b = wb.sheets[i].cells, name = wb.sheets[i].name;
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          const va = a[k]?.v ?? '', vb = b[k]?.v ?? '';
          if (va === vb) continue;
          changed.push(`${name}!${k}`);
          if (String(va).startsWith('=') || String(vb).startsWith('=')) formulaChanged = true;
          if (typeof vb === 'string' && vb.startsWith('=') && (VOLATILE.test(vb) || SPILLY.test(vb))) return full(wb);
        }
      }
      if (!changed.length) { last = { ...last, wb }; return last.values; }
      if (formulaChanged || changed.length > 5000) return full(wb); // new or edited formulas: the chain changes
      // formulas reading a changed cell (directly or within a range), then everything that depends on those
      const todo = [];
      for (const id of changed) {
        const i = id.lastIndexOf('!'); const sheet = id.slice(0, i).toLowerCase(); const p = parseKey(id.slice(i + 1));
        todo.push(id);
        for (const [fid, refs] of last.chain.refs) for (const r of refs) if (r.sheet === sheet && p.row >= r.g.r1 && p.row <= r.g.r2 && p.col >= r.g.c1 && p.col <= r.g.c2) { todo.push(fid); break; }
      }
      const dirty = new Set();
      while (todo.length) { const id = todo.pop(); if (dirty.has(id)) continue; dirty.add(id); for (const d of last.reverse.get(id) || []) if (!dirty.has(d)) todo.push(d); }
      const values = evaluateWorkbook(wb, { wb, chain: last.chain, values: last.values, dirty });
      last = { ...last, wb, values };
      return values;
    },
    reset() { last = null; },
  };
}
