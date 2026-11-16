// The spreadsheet grid, behaving like Excel. Only the cells in view are drawn (four panes: frozen corner,
// frozen rows, frozen columns, and the scrolling area), so sheets of 100,000 rows stay smooth.
import { esc, kbd } from './util.js';
import { icon } from './icons.js';
import { toast, confirmDialog, openMenu as uiOpenMenu, openModal, announce } from './ui.js';
import { E, parse, FN_HINTS, REF_COLORS, mergeMap, hiddenRows, cfStyles, diffBooks, applySide, withTable, chartSpec, TABLE_STYLES, tableStyleDef } from './sheet-core.js';
import { chartSvg } from './charts.js';
import { ribbonHtml, FN_CATEGORIES } from './sheet-ribbon.js';
import { createDialogs, CELL_STYLES } from './sheet-dialogs.js';

const FONT_STACK = "'Aptos', 'Calibri', 'Carlito', 'Segoe UI', Arial, sans-serif";
const fontCss = (st, z) => `${st?.i ? 'italic ' : ''}${st?.b ? 700 : 400} ${((st?.fz || 11) * 4 / 3 * z).toFixed(2)}px ${st?.ff ? `'${st.ff}', ` : ''}${FONT_STACK}`;
let measureCtx = null;
const textWidth = (text, font) => { measureCtx ||= document.createElement('canvas').getContext('2d'); measureCtx.font = font; return measureCtx.measureText(text).width; };
const SPILL_SCAN = 40; // how far left to look for text that spills into view

let clip = null; // copied cells, shared between spreadsheets in this tab

export function mountApp(root, json, { editable = true, change, remove, fileMode = false, pageSetup = null } = {}) {
  // Menus: after a command runs, keyboard focus goes back to the grid (as in Excel), unless a dialog or the cell editor took it.
  let closeToolCard = () => {}; // set once the toolbar exists
  const openMenu = (anchorEl, items, opts) => uiOpenMenu(anchorEl, items.map((it) => (it && typeof it === 'object' && it.run ? { ...it, run: async () => { closeToolCard(); await it.run(); setTimeout(() => { if (!editing && !document.querySelector('.modal, .sheet-filter-pop') && !document.activeElement?.matches?.('.sheet-tab-input, .xl-name')) wrap.focus({ preventScroll: true }); }, 0); } } : it)), opts);
  let wb = parse(json);
  let si = 0;
  let values = {}, shown = {}, hiddenF = new Set(), cf = {}, merges = { anchors: {}, covered: new Set() };
  let ranges = [{ r1: 0, c1: 0, r2: 0, c2: 0 }];
  let active = { r: 0, c: 0 }, anchor = { r: 0, c: 0 };
  let editing = null; // { el, r, c, mode: 'enter' | 'edit' | 'point', from: 'cell' | 'bar', point }
  let zoom = 1, showFormulas = false, painter = null, tabStart = null, ctrlA = 0, circleInvalid = false, showAllNotes = false, noteEdit = null;
  let selChart = null, arrows = [], chartCache = {}, pivotPanel = true;
  let G = null, L = null; // geometry and layout
  const undo = [], redo = [];
  const sheet = () => wb.sheets[si];
  const range = () => ranges[ranges.length - 1];
  root.classList.add('sheet-ui', 'xl');
  if (fileMode) root.classList.add('sheet-file-ui');
  let commented = new Set(); // cells with open comments (filled in by the comments panel)

  root.innerHTML = `
    ${editable ? ribbonHtml() : ''}
    <div class="xl-find" hidden>
      <input class="sf-find" placeholder="Find what" aria-label="Find what">${editable ? '<input class="sf-repl" placeholder="Replace with" aria-label="Replace with">' : ''}
      <label class="sf-case"><input type="checkbox"> Match case</label><label class="sf-whole"><input type="checkbox"> Entire cell</label><span class="sf-count"></span>
      <button type="button" class="btn btn-plain btn-sm" data-f="prev">Find Previous</button><button type="button" class="btn btn-plain btn-sm" data-f="next">Find Next</button>
      ${editable ? '<button type="button" class="btn btn-plain btn-sm" data-f="replace">Replace</button><button type="button" class="btn btn-plain btn-sm" data-f="all">Replace All</button>' : ''}
      <button type="button" class="tb-btn" data-f="close" aria-label="Close">${icon('x', { size: 16 })}</button>
    </div>
    <div class="xl-fbar"><input class="xl-name" aria-label="Name Box: type a cell or range and press Enter" spellcheck="false"><button type="button" class="xl-fx" data-cmd="insert-function" title="Insert Function"><i aria-hidden="true">fx</i><span class="sr-only">Insert Function</span></button><textarea class="xl-formula" rows="1" aria-label="Formula bar" spellcheck="false" ${editable ? '' : 'readonly'}></textarea></div>
    <div class="xl-wrap" tabindex="0" role="application" aria-roledescription="spreadsheet" aria-label="Spreadsheet. Arrow keys move, type to enter, F2 edits, Shift+F10 for options.">
      <div class="xl-view">
        <div class="xl-ch"></div><div class="xl-rh"></div><button type="button" class="xl-corner" data-all title="Select all" aria-label="Select all"></button>
        <div class="xl-q" data-q="00"></div><div class="xl-q" data-q="01"></div><div class="xl-q" data-q="10"></div><div class="xl-q" data-q="11"></div>
      </div>
      <div class="xl-space"></div>
    </div>
    <div class="xl-foot">
      <div class="sheet-tabs"></div>
      <div class="xl-status"><span class="xl-mode">Ready</span><span class="xl-stats" aria-live="polite"></span>
        <span class="xl-zoom"><button type="button" data-zoom="-" aria-label="Zoom out">−</button><input type="range" min="50" max="200" step="10" value="100" aria-label="Zoom"><button type="button" data-zoom="+" aria-label="Zoom in">+</button><button type="button" class="xl-zoompct" data-cmd="zoom-menu" aria-label="Zoom level: 100%">100%</button></span></div>
    </div>
    <div class="sheet-suggest" hidden role="listbox"></div><div class="sheet-hint" hidden></div>`;
  const $ = (s) => root.querySelector(s);
  const wrap = $('.xl-wrap'), view = $('.xl-view'), space = $('.xl-space');
  const chEl = $('.xl-ch'), rhEl = $('.xl-rh'), corner = $('.xl-corner');
  const Q = Object.fromEntries([...root.querySelectorAll('.xl-q')].map((q) => [q.dataset.q, q]));
  const nameBox = $('.xl-name'), fbar = $('.xl-formula'), modeEl = $('.xl-mode'), statsEl = $('.xl-stats');
  const tabs = $('.sheet-tabs'), suggest = $('.sheet-suggest'), hint = $('.sheet-hint'), findBar = $('.xl-find');
  const zoomRange = $('.xl-zoom input'), zoomPct = $('.xl-zoompct');

  /* =================== Data helpers =================== */
  const rawOf = (r, c) => sheet().cells[E.cellKey(r, c)]?.v ?? '';
  const isEmpty = (r, c) => rawOf(r, c) === '';
  const usedBounds = () => { const u = E.usedRange(sheet()); return { rows: u.rows, cols: u.cols }; };
  const clampToUsed = (g) => { const u = usedBounds(); return { r1: g.r1, c1: g.c1, r2: Math.min(g.r2, Math.max(g.r1, u.rows - 1)), c2: Math.min(g.c2, Math.max(g.c1, u.cols - 1)) }; };
  const fullRows = (g) => g.c1 === 0 && g.c2 === E.MAX_COLS - 1;
  const fullCols = (g) => g.r1 === 0 && g.r2 === E.MAX_ROWS - 1;
  const calc = E.createCalculator(); // recalculates only what each edit affects
  function recalc() {
    values = calc.evaluate(wb, { tidy: false });
    const v = values[sheet().name] || {};
    // what cells show, worked out on demand (the grid draws only what's on screen) and remembered until the next change
    const sh0 = sheet(); const lines = !!(Object.keys(sh0.cs || {}).length || Object.keys(sh0.rs || {}).length); const cache = new Map();
    shown = new Proxy({}, { get: (t, key) => { if (typeof key !== 'string') return undefined; if (cache.has(key)) return cache.get(key); const d = E.displayCellOf(sh0, v, key, lines); cache.set(key, d); return d; } });
    hiddenF = hiddenRows(sheet(), v);
    cf = cfStyles(sheet(), v);
    merges = mergeMap(sheet());
  }

  /* =================== Geometry (sizes with overrides, hidden rows/columns, zoom) =================== */
  function buildGeo() {
    const sh = sheet(); const z = zoom;
    const DW = Math.round(E.DEF_W * z), DH = Math.round(E.DEF_H * z);
    const hidR = new Set([...(sh.hr || []), ...hiddenF]), hidC = new Set(sh.hc || []);
    const colOver = new Map(); for (const [k, px] of Object.entries(sh.w)) colOver.set(E.colIndex(k), Math.round(px * z)); for (const c of hidC) colOver.set(c, 0);
    const rowOver = new Map(); for (const [k, px] of Object.entries(sh.h)) rowOver.set(Number(k), Math.round(px * z)); for (const r of hidR) rowOver.set(r, 0);
    const mk = (over, D, N) => {
      const keys = [...over.keys()].sort((a, b) => a - b); const pre = [0];
      for (const k of keys) pre.push(pre[pre.length - 1] + over.get(k) - D);
      const size = (i) => (over.has(i) ? over.get(i) : D);
      const start = (i) => { let lo = 0, hi = keys.length; while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m] < i) lo = m + 1; else hi = m; } return i * D + pre[lo]; };
      const at = (x) => { if (x <= 0) return 0; let lo = 0, hi = N - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (start(m) <= x) lo = m; else hi = m - 1; } while (lo > 0 && size(lo) === 0) lo--; return lo; };
      return { size, start, at, total: start(N) };
    };
    const C = mk(colOver, DW, E.MAX_COLS), R = mk(rowOver, DH, E.MAX_ROWS);
    G = { z, colW: C.size, colL: C.start, colAt: C.at, rowH: R.size, rowT: R.start, rowAt: R.at, totalW: C.total, totalH: R.total, hidR, hidC };
  }
  const rectOf = (g) => ({ x: G.colL(g.c1), y: G.rowT(g.r1), w: G.colL(g.c2 + 1) - G.colL(g.c1), h: G.rowT(g.r2 + 1) - G.rowT(g.r1) });
  function mergeAt(r, c) { for (const g of Object.values(merges.anchors)) if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) return g; return null; }

  /* =================== Layout and drawing =================== */
  function layout() {
    const sh = sheet(); const z = zoom;
    const heads = sh.view?.heads !== false;
    const vw = wrap.clientWidth, vh = wrap.clientHeight;
    const fr = sh.freeze.r, fc = sh.freeze.c;
    const FW = G.colL(fc), FH = G.rowT(fr);
    const sx = wrap.scrollLeft, sy = wrap.scrollTop;
    const HH = heads ? Math.round(20 * z) : 0;
    const lastRow = G.rowAt(FH + sy + vh);
    const HW = heads ? Math.max(Math.round(30 * z), Math.ceil(textWidth(String(lastRow + 1), fontCss(null, z)) + 14 * z)) : 0;
    L = { vw, vh, fr, fc, FW, FH, sx, sy, HH, HW, qw: Math.max(0, vw - HW - FW), qh: Math.max(0, vh - HH - FH) };
    return L;
  }
  // sheet coordinates → position in the view (for the editor and popups)
  function toView(r, c) {
    const x = c < L.fc ? L.HW + G.colL(c) : L.HW + G.colL(c) - L.sx;
    const y = r < L.fr ? L.HH + G.rowT(r) : L.HH + G.rowT(r) - L.sy;
    return { x, y };
  }
  function visibleList(fromIdx, toIdx, sizeFn, limit) { const out = []; for (let i = fromIdx; i <= toIdx && i < limit; i++) if (sizeFn(i) > 0) out.push(i); return out; }
  function render() {
    if (!G) return;
    const sh = sheet(); const z = zoom;
    layout();
    const { vw, vh, fr, fc, FW, FH, sx, sy, HH, HW, qw, qh } = L;
    space.style.width = `${HW + G.totalW}px`; space.style.height = `${HH + G.totalH}px`;
    view.style.width = `${vw}px`; view.style.height = `${vh}px`;
    view.style.setProperty('--z', z);
    const grid = sh.view?.grid !== false;
    // which rows/columns are on screen
    const scrollRows = visibleList(Math.max(fr, G.rowAt(FH + sy)), G.rowAt(FH + sy + qh), G.rowH, E.MAX_ROWS);
    const scrollCols = visibleList(Math.max(fc, G.colAt(FW + sx)), G.colAt(FW + sx + qw), G.colW, E.MAX_COLS);
    const frozenRows = visibleList(0, fr - 1, G.rowH, fr), frozenCols = visibleList(0, fc - 1, G.colW, fc);
    const panes = {
      '00': { rows: frozenRows, cols: frozenCols, ox: 0, oy: 0, x: HW, y: HH, w: FW, h: FH, cDom: [0, fc] },
      '01': { rows: frozenRows, cols: scrollCols, ox: FW + sx, oy: 0, x: HW + FW, y: HH, w: qw, h: FH, cDom: [fc, E.MAX_COLS] },
      10: { rows: scrollRows, cols: frozenCols, ox: 0, oy: FH + sy, x: HW, y: HH + FH, w: FW, h: qh, cDom: [0, fc] },
      11: { rows: scrollRows, cols: scrollCols, ox: FW + sx, oy: FH + sy, x: HW + FW, y: HH + FH, w: qw, h: qh, cDom: [fc, E.MAX_COLS] },
    };
    for (const [key, p] of Object.entries(panes)) {
      const el = Q[key];
      Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px`, display: p.w > 0 && p.h > 0 ? '' : 'none' });
      el.innerHTML = p.w > 0 && p.h > 0 ? paneHtml(p, grid) : ''; // an unused pane keeps nothing
    }
    // headings
    corner.style.display = HW ? '' : 'none';
    Object.assign(corner.style, { width: `${HW}px`, height: `${HH}px` });
    chEl.style.display = rhEl.style.display = HH ? '' : 'none';
    if (HH) {
      const selCols = new Set(), fullC = new Set(), selRows = new Set(), fullR = new Set();
      for (const g of ranges) {
        for (const c of [...frozenCols, ...scrollCols]) if (c >= g.c1 && c <= g.c2) { selCols.add(c); if (fullCols(g)) fullC.add(c); }
        for (const r of [...frozenRows, ...scrollRows]) if (r >= g.r1 && r <= g.r2) { selRows.add(r); if (fullRows(g)) fullR.add(r); }
      }
      const colHead = (c, x) => `<div class="xh ${selCols.has(c) ? 'on' : ''} ${fullC.has(c) ? 'full' : ''}" style="left:${x}px;width:${G.colW(c)}px;height:${HH}px" data-col="${c}">${E.colName(c)}${editable ? '<i class="xh-rz" data-colresize></i>' : ''}</div>`;
      const rowHead = (r, y) => `<div class="xh ${selRows.has(r) ? 'on' : ''} ${fullR.has(r) ? 'full' : ''}" style="top:${y}px;height:${G.rowH(r)}px;width:${HW}px" data-row="${r}">${r + 1}${editable ? '<i class="xh-rz" data-rowresize></i>' : ''}</div>`;
      chEl.style.cssText = `left:${HW}px;top:0;width:${vw - HW}px;height:${HH}px`;
      chEl.innerHTML = `<div class="xh-clip" style="left:0;width:${FW}px">${frozenCols.map((c) => colHead(c, G.colL(c))).join('')}</div><div class="xh-clip" style="left:${FW}px;width:${qw}px">${scrollCols.map((c) => colHead(c, G.colL(c) - FW - sx)).join('')}</div>`;
      rhEl.style.cssText = `left:0;top:${HH}px;width:${HW}px;height:${vh - HH}px`;
      rhEl.innerHTML = `<div class="xh-clip" style="top:0;height:${FH}px">${frozenRows.map((r) => rowHead(r, G.rowT(r))).join('')}</div><div class="xh-clip" style="top:${FH}px;height:${qh}px">${scrollRows.map((r) => rowHead(r, G.rowT(r) - FH - sy)).join('')}</div>`;
    }
    if (editing?.from === 'cell') placeEditor();
    if (showAllNotes) drawNotes();
  }
  function paneHtml(p, grid) {
    const sh = sheet(); const z = zoom; let html = '';
    if (!p.rows.length || !p.cols.length) return '';
    const firstC = p.cols[0], lastC = p.cols[p.cols.length - 1];
    // gridlines
    if (grid) {
      for (const c of p.cols) html += `<i class="xg-v" style="left:${G.colL(c) + G.colW(c) - 1 - p.ox}px"></i>`;
      for (const r of p.rows) html += `<i class="xg-h" style="top:${G.rowT(r) + G.rowH(r) - 1 - p.oy}px"></i>`;
    }
    // cells (with text spilling into empty neighbours, as in Excel)
    const scanFrom = Math.max(p.cDom[0], firstC - SPILL_SCAN);
    const anyLineStyle = Object.keys(sh.cs).length || Object.keys(sh.rs).length;
    for (const r of p.rows) {
      const y = G.rowT(r) - p.oy, h = G.rowH(r);
      for (let c = scanFrom; c <= lastC; c++) {
        if (G.colW(c) === 0) continue;
        const k = E.cellKey(r, c);
        if (merges.covered.has(k) || merges.anchors[k]) continue;
        const cell = sh.cells[k];
        const st0 = anyLineStyle ? E.styleAt(sh, r, c) : cell?.s; const st = sh.tables.length ? withTable(sh, r, c, st0) : st0;
        const cfs = cf[k];
        if (!cell?.v && !st?.bg && !st?.bd && !cfs?.bg && !shown[k]?.spill && !cell?.n) continue;
        html += cellDiv(r, c, k, cell, st, cfs, G.colL(c) - p.ox, y, G.colW(c), h, p, c < firstC);
      }
    }
    // merged cells
    for (const g of Object.values(merges.anchors)) {
      if (g.c2 < p.cDom[0] || g.c1 >= p.cDom[1]) continue;
      if (!p.rows.some((r) => r >= g.r1 && r <= g.r2) && !(g.r1 <= p.rows[0] && g.r2 >= p.rows[p.rows.length - 1])) continue;
      if (g.c2 < firstC || g.c1 > lastC) continue;
      const k = E.cellKey(g.r1, g.c1); const rc = rectOf(g);
      html += cellDiv(g.r1, g.c1, k, sh.cells[k], withTable(sh, g.r1, g.c1, E.styleAt(sh, g.r1, g.c1)), cf[k], rc.x - p.ox, rc.y - p.oy, rc.w, rc.h, p, false, true);
    }
    // filter buttons on the header row
    if (sh.filter) {
      const f = E.parseRange(sh.filter.range);
      if (f && p.rows.includes(f.r1)) for (let c = Math.max(f.c1, firstC); c <= Math.min(f.c2, lastC); c++) {
        const bx = G.colL(c) + G.colW(c) - p.ox - Math.round(17 * z), by = G.rowT(f.r1) - p.oy + Math.max(1, Math.round((G.rowH(f.r1) - 16 * z) / 2));
        html += `<button type="button" class="xl-fbtn ${sh.filter.crit[c] ? 'on' : ''}" data-fcol="${c}" style="left:${bx}px;top:${by}px;width:${Math.round(16 * z)}px;height:${Math.round(16 * z)}px" aria-label="Filter column ${E.colName(c)}">${icon(sh.filter.crit[c] ? 'filter' : 'chevronDown', { size: Math.round(11 * z) })}</button>`;
      }
    }
    return html + chartsHtml(p) + arrowsHtml(p) + overlayHtml(p);
  }
  function cellDiv(r, c, k, cell, st, cfs, x, y, w, h, p, startsLeft, merged = false) {
    const sh = sheet(); const z = zoom; const s = st || {};
    const sv = shown[k];
    let text = showFormulas && String(cell?.v || '').startsWith('=') ? cell.v : (sv?.text ?? '');
    const isNum = sv?.number && !showFormulas;
    const font = fontCss(s, z);
    const pad = Math.round(3 * z) + (s.ind ? Math.round(s.ind * 9 * z) : 0);
    let width = w, left = x, spilled = false;
    const al = s.al || (isNum ? 'right' : sv?.error ? 'center' : 'left');
    if (text && !merged && !s.wr && !isNum && !sv?.error) {
      const need = textWidth(String(text).split('\n')[0], font) + pad * 2;
      if (need > w) {
        if (al === 'left') { let cc = c + 1; while (width < need && cc < p.cDom[1] && cc - c < 60 && isEmpty(r, cc) && !merges.covered.has(E.cellKey(r, cc)) && !merges.anchors[E.cellKey(r, cc)]) { width += G.colW(cc); cc++; } }
        else if (al === 'right') { let cc = c - 1; while (width < need && cc >= p.cDom[0] && c - cc < 60 && isEmpty(r, cc) && !merges.covered.has(E.cellKey(r, cc))) { width += G.colW(cc); left -= G.colW(cc); cc--; } }
        spilled = width > w;
      }
    }
    if (startsLeft && left + width <= G.colL(p.cols[0]) - p.ox) return ''; // off to the left and not spilling into view
    if (isNum && text) { const need = textWidth(text, font) + pad * 2; if (need > w) text = '#'.repeat(Math.max(1, Math.floor((w - pad * 2) / textWidth('#', font)))); } // too wide: ####, as in Excel
    const link = cell?.l && !showFormulas;
    const bg = cfs?.bg || s.bg, fg = cfs?.fg || s.fg || sv?.color || (link ? '#0563c1' : null);
    const css = [`left:${left}px`, `top:${y}px`, `width:${width - 1}px`, `height:${h - 1}px`, `font:${font}`, `padding:0 ${pad}px`,
      `justify-content:${al === 'center' ? 'center' : al === 'right' ? 'flex-end' : 'flex-start'}`, `align-items:${s.va === 'top' ? 'flex-start' : s.va === 'middle' ? 'center' : 'flex-end'}`];
    if (bg) css.push(`background:${bg}`); else if (spilled || merged) css.push('background:var(--xl-bg)');
    if (fg) css.push(`color:${fg}`); else if (sv?.error) css.push('color:var(--danger)');
    const deco = [(s.u || link) && 'underline', s.st && 'line-through'].filter(Boolean).join(' '); if (deco) css.push(`text-decoration:${deco}`);
    if (link) css.push('cursor:pointer');
    if (s.wr) css.push('white-space:pre-wrap;overflow-wrap:anywhere;text-align:' + al);
    if (s.bd) { const line = (side) => { const v = s.bd[side]; return v ? `${{ 1: '1px solid', 2: '2px solid', 3: '3px double', 4: '1px dashed', 5: '1px dotted', 6: '3px solid' }[v] || '1px solid'} ${s.bc || 'var(--xl-border)'}` : null; }; const t = line('t'), rr = line('r'), b = line('b'), l = line('l'); if (t) css.push(`border-top:${t}`); if (rr) css.push(`border-right:${rr}`); if (b) css.push(`border-bottom:${b}`); if (l) css.push(`border-left:${l}`); css[2] = `width:${width}px`; css[3] = `height:${h}px`; css[0] = `left:${left - (s.bd.l ? 1 : 0)}px`; css[1] = `top:${y - (s.bd.t ? 1 : 0)}px`; }
    let spanCss = '';
    if (s.vs) spanCss += `vertical-align:${s.vs === 'sup' ? 'super' : 'sub'};font-size:75%;`;
    if (s.rot === 255) spanCss += 'writing-mode:vertical-rl;text-orientation:upright;letter-spacing:-1px;';
    else if (s.rot) spanCss += `display:inline-block;transform:rotate(${-s.rot}deg);transform-origin:${s.rot > 0 ? 'left bottom' : 'left top'};white-space:nowrap;`;
    const cmtMark = commented.has(`${sheet().id}!${k}`) ? '<i class="xcm" aria-hidden="true"></i>' : ''; // an open comment on this cell
    const note = cmtMark + (cell?.n ? `<i class="xn" style="border-width:0 ${Math.round(6 * zoom)}px ${Math.round(6 * zoom)}px 0"></i>` : '') + (errFlag(cell, sv, s) ? `<i class="xe" style="border-width:${Math.round(6 * zoom)}px ${Math.round(6 * zoom)}px 0 0"></i>` : '');
    return `<div class="xc${sv?.error ? ' err' : ''}" style="${css.join(';')}">${text ? `<span${spanCss ? ` style="${spanCss}"` : ''}>${esc(text)}</span>` : ''}${note}</div>`;
  }
  const numLike = (v) => /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(v);
  /** Excel's green triangle: a formula that returns an error, or a number stored as text. */
  function errFlag(cell, sv, st) {
    if (!cell || cell.ig || showFormulas) return null; const v = String(cell.v ?? '');
    if (v.startsWith('=') && sv?.error) return 'error';
    if ((v.startsWith("'") && numLike(v.slice(1))) || (st?.f === 'text' && numLike(v))) return 'text';
    return null;
  }
  function chartsHtml(p) {
    let html = ''; const z = zoom;
    for (const ch of sheet().charts || []) {
      const x = ch.x * z - p.ox, y = ch.y * z - p.oy, w = ch.w * z, h = ch.h * z;
      if (x > p.w || y > p.h || x + w < 0 || y + h < 0) continue;
      const on = selChart === ch.id;
      html += `<div class="xchart${on ? ' on' : ''}" data-chart="${ch.id}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><div class="xchart-in" style="width:${ch.w}px;height:${ch.h}px;transform:scale(${z})">${chartCache[ch.id] || ''}</div>${on && editable ? ['nw', 'ne', 'sw', 'se'].map((c) => `<i class="xchart-h h-${c}" data-chandle="${c}"></i>`).join('') : ''}</div>`;
    }
    return html;
  }
  function arrowsHtml(p) {
    if (!arrows.length) return '';
    const center = (g) => { const rc = rectOf(g); return [rc.x + Math.min(rc.w, G.colW(g.c1)) / 2 - p.ox, rc.y + Math.min(rc.h, G.rowH(g.r1)) / 2 - p.oy]; };
    let svg = `<svg class="xs-arrows" width="${p.w}" height="${p.h}"><defs><marker id="xa-${p.x}-${p.y}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" fill="#1f5fbf"/></marker></defs>`;
    for (const a of arrows) {
      const [x1, y1] = center(a.from), [x2, y2] = center(a.to);
      if (a.from.r2 > a.from.r1 || a.from.c2 > a.from.c1) { const rc = rectOf(a.from); svg += `<rect x="${rc.x - p.ox}" y="${rc.y - p.oy}" width="${rc.w}" height="${rc.h}" fill="none" stroke="#1f5fbf" stroke-width="1.5"/>`; }
      svg += `<circle cx="${x1}" cy="${y1}" r="3" fill="#1f5fbf"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1f5fbf" stroke-width="1.5" marker-end="url(#xa-${p.x}-${p.y})"/>`;
    }
    return `${svg}</svg>`;
  }
  function overlayHtml(p) {
    let html = '';
    const box = (g, cls, extra = '') => {
      const rc = rectOf(g); const x = rc.x - p.ox, y = rc.y - p.oy;
      if (x > p.w + 4 || y > p.h + 4 || x + rc.w < -4 || y + rc.h < -4) return '';
      return `<div class="${cls}" style="left:${x}px;top:${y}px;width:${rc.w}px;height:${rc.h}px;${extra}"></div>`;
    };
    for (let i = 0; i < ranges.length; i++) {
      const g = ranges[i];
      const single = g.r1 === g.r2 && g.c1 === g.c2;
      if (!single || ranges.length > 1) html += box(g, 'xs-range');
      if (i === ranges.length - 1 && !editing) html += box(g, 'xs-border');
    }
    const am = mergeAt(active.r, active.c) || { r1: active.r, c1: active.c, r2: active.r, c2: active.c };
    html += box(am, 'xs-active');
    if (editable && !editing && ranges.length === 1) {
      const rc = rectOf(range()); const x = rc.x + rc.w - p.ox, y = rc.y + rc.h - p.oy;
      if (x >= -3 && y >= -3 && x <= p.w + 3 && y <= p.h + 3) html += `<div class="xs-fill" data-fill style="left:${x - 3}px;top:${y - 3}px" title="Drag to fill; double-click to fill down"></div>`;
    }
    if (clip && clip.sheetId === sheet().id && clip.marquee) html += box(clip.range, 'xs-marquee');
    // a spilled range is outlined when one of its cells is selected
    const sk = E.cellKey(active.r, active.c); const anchorKey = shown[sk]?.spillRange ? sk : shown[sk]?.spill;
    if (anchorKey && shown[anchorKey]?.spillRange) html += box(E.parseRange(shown[anchorKey].spillRange), 'xs-spill');
    // in-cell dropdown for list validation
    const rule = editable && !editing ? E.dvRuleAt(sheet(), active.r, active.c) : null;
    if (rule?.type === 'list' && rule.drop !== false) { const rc = rectOf({ r1: active.r, c1: active.c, r2: active.r, c2: active.c }); const x = rc.x + rc.w - p.ox + 2, y = rc.y - p.oy; if (x > 0 && y >= 0 && x < p.w + 20 && y < p.h) html += `<button type="button" class="xl-dvbtn" data-dvdrop style="left:${x}px;top:${y}px;height:${rc.h}px" aria-label="Choose from the list">▾</button>`; }
    if (circleInvalid) for (const k of invalidCells()) { const pk = E.parseKey(k); html += box({ r1: pk.row, c1: pk.col, r2: pk.row, c2: pk.col }, 'xs-invalid'); }
    // a table's total row: choose the function from a dropdown
    const tt = editable && !editing ? E.tableAt(sheet(), active.r, active.c) : null;
    if (tt && tt.total && E.tableParts(tt).tr === active.r && active.c > E.parseRange(tt.range).c1) { const rc = rectOf({ r1: active.r, c1: active.c, r2: active.r, c2: active.c }); const x = rc.x + rc.w - p.ox + 2, y = rc.y - p.oy; if (x > 0 && y >= 0 && x < p.w + 20 && y < p.h) html += `<button type="button" class="xl-dvbtn" data-totaldrop style="left:${x}px;top:${y}px;height:${rc.h}px" aria-label="Choose a total">▾</button>`; }
    // error smart tag next to a flagged cell
    const ac = sheet().cells[E.cellKey(active.r, active.c)];
    if (editable && !editing && errFlag(ac, shown[E.cellKey(active.r, active.c)], E.styleAt(sheet(), active.r, active.c))) { const rc = rectOf({ r1: active.r, c1: active.c, r2: active.r, c2: active.c }); const x = rc.x - p.ox - 20, y = rc.y - p.oy; if (x > -20 && y >= 0 && x < p.w && y < p.h) html += `<button type="button" class="xl-errbtn" data-errtag style="left:${Math.max(0, x)}px;top:${y}px" aria-label="Error options" title="Error options">!</button>`; }
    if (fillDrag?.box) html += box(fillDrag.box, 'xs-fillbox');
    if (editing) for (const ref of refsIn(editing.el.value)) html += box(ref.g, 'xs-ref', `border-color:${ref.color};background:${ref.color}1f`);
    return html;
  }
  function invalidCells() {
    const out = []; const sh = sheet();
    for (const rule of sh.dv || []) for (const part of rule.range.split(' ')) { const g = E.parseRange(part); if (!g) continue;
      for (const [k, cell] of Object.entries(sh.cells)) { const pk = E.parseKey(k); if (pk.row < g.r1 || pk.row > g.r2 || pk.col < g.c1 || pk.col > g.c2 || cell.v === '') continue; if (!E.dvCheck(rule, shown[k]?.value, shown[k]?.text, wb, sh.name)) out.push(k); } }
    return out;
  }
  const popEl = document.createElement('div'); popEl.className = 'xl-pop'; popEl.hidden = true; view.appendChild(popEl);
  const notesLayer = document.createElement('div'); notesLayer.className = 'xl-notes'; view.appendChild(notesLayer);
  function showPopAt(r, c, html, cls = '') {
    layout(); const pos = toView(r, c); const rc = rectOf({ r1: r, c1: c, r2: r, c2: c });
    popEl.className = `xl-pop ${cls}`; popEl.innerHTML = html; popEl.hidden = false;
    popEl.style.left = `${Math.min(pos.x + rc.w + 6, L.vw - 240)}px`; popEl.style.top = `${Math.max(L.HH, Math.min(pos.y, L.vh - 120))}px`;
  }
  const hidePop = () => { popEl.hidden = true; };
  function drawNotes() {
    if (!showAllNotes) { notesLayer.innerHTML = ''; return; }
    layout(); let html = '';
    for (const [k, cell] of Object.entries(sheet().cells)) { if (!cell.n) continue; const p = E.parseKey(k); const pos = toView(p.row, p.col); const rc = rectOf({ r1: p.row, c1: p.col, r2: p.row, c2: p.col }); if (pos.x < 0 || pos.y < 0 || pos.x > L.vw || pos.y > L.vh) continue; html += `<div class="xl-note" style="left:${pos.x + rc.w + 8}px;top:${pos.y}px">${cell.n.a ? `<b>${esc(cell.n.a)}:</b> ` : ''}${esc(cell.n.t)}</div>`; }
    notesLayer.innerHTML = html;
  }
  view.addEventListener('mousemove', (e) => {
    if (drag || editing || noteEdit) return;
    if (e.target.closest('.xl-pop, .xl-dvbtn, .xl-note')) return;
    const h = hit(e); if (h.inColHead || h.inRowHead || h.inCorner) { if (popEl.classList.contains('note')) hidePop(); return; }
    const cell = sheet().cells[E.cellKey(h.r, h.c)];
    if (cell?.n && !showAllNotes) showPopAt(h.r, h.c, `${cell.n.a ? `<b>${esc(cell.n.a)}:</b><br>` : ''}${esc(cell.n.t).replace(/\n/g, '<br>')}`, 'note');
    else if (popEl.classList.contains('note')) { hidePop(); showInputMessage(); }
  });
  view.addEventListener('mouseleave', () => { if (popEl.classList.contains('note')) { hidePop(); showInputMessage(); } });
  function showInputMessage() {
    const rule = E.dvRuleAt(sheet(), active.r, active.c);
    if (rule?.msg && !editing) showPopAt(active.r, active.c, `${rule.msg.title ? `<b>${esc(rule.msg.title)}</b><br>` : ''}${esc(rule.msg.text)}`, 'msg'); else if (!popEl.classList.contains('note')) hidePop();
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  function draw() {
    recalc(); buildGeo();
    chartCache = {}; for (const ch of sheet().charts || []) { try { const spec = chartSpec(wb, sheet(), ch, values); chartCache[ch.id] = spec ? chartSvg(spec, { width: ch.w, height: ch.h }) : ''; } catch { chartCache[ch.id] = ''; } }
    render(); syncChrome(); drawPivotPanel();
  }
  wrap.addEventListener('scroll', schedule, { passive: true });
  const ro = new ResizeObserver(schedule); ro.observe(wrap);

  /* =================== Chrome: name box, formula bar, status bar, ribbon state, tabs =================== */
  function syncChrome() {
    const g = range();
    if (document.activeElement !== nameBox) {
      const ref = E.rangeRef(g).toUpperCase(); const nm = ranges.length === 1 && Object.entries(wb.names || {}).find(([, v]) => { const i = v.lastIndexOf('!'); return v.slice(0, i).replace(/^'|'$/g, '').toLowerCase() === sheet().name.toLowerCase() && v.slice(i + 1).replace(/\$/g, '').toUpperCase() === ref; });
      nameBox.value = nm ? nm[0] : ranges.length > 1 || (g.r1 === g.r2 && g.c1 === g.c2) ? E.cellKey(active.r, active.c) : E.rangeRef(g);
    }
    if (!editing) {
      const k = E.cellKey(active.r, active.c); const sp = !rawOf(active.r, active.c) && shown[k]?.spill;
      fbar.value = sp ? rawOf(E.parseKey(sp).row, E.parseKey(sp).col) : (E.styleAt(sheet(), active.r, active.c)?.hf && sheet().protect ? '' : rawOf(active.r, active.c));
      fbar.classList.toggle('ghost', !!sp);
    }
    showInputMessage();
    if (!editing) { // for screen readers: where the cursor is and what's there
      const k = E.cellKey(active.r, active.c); const raw = rawOf(active.r, active.c); const txt = shown[k]?.text ?? '';
      const sel = ranges.length > 1 ? `, ${ranges.length} ranges selected` : (g.r1 !== g.r2 || g.c1 !== g.c2) ? `, ${E.rangeRef(g)} selected, ${(g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1)} cells` : '';
      announce(`${k}${sel}: ${txt || 'blank'}${String(raw).startsWith('=') ? `, formula ${raw}` : ''}${sheet().cells[k]?.n ? ', has a note' : ''}`);
    }
    modeEl.textContent = editing ? ({ enter: 'Enter', edit: 'Edit', point: 'Point' }[editing.mode] || 'Edit') : painter ? 'Format Painter' : 'Ready';
    drawStats(); drawTabs(); syncRibbon();
    zoomPct.textContent = `${Math.round(zoom * 100)}%`; zoomPct.setAttribute('aria-label', `Zoom level: ${zoomPct.textContent}`); zoomRange.value = String(Math.round(zoom * 100));
  }
  function drawStats() {
    let sum = 0, n = 0, count = 0, min = Infinity, max = -Infinity; const seen = new Set();
    const one = ranges.length === 1 && range().r1 === range().r2 && range().c1 === range().c2;
    const cells = sheet().cells; const total = Object.keys(cells).length;
    const add = (k, row) => { if (seen.has(k) || G?.hidR.has(row)) return; seen.add(k); const sv = shown[k]; if (!sv || sv.text === '') return; count++; if (sv.number) { sum += sv.value; n++; min = Math.min(min, sv.value); max = Math.max(max, sv.value); } };
    if (!one) for (const g0 of ranges) { // small selections: visit the selected cells; big ones: visit the filled cells
      const g = clampToUsed(g0);
      if ((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) <= total) { for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const k = E.cellKey(r, c); if (cells[k]) add(k, r); } }
      else for (const k of Object.keys(cells)) { const p = E.parseKey(k); if (p.row >= g.r1 && p.row <= g.r2 && p.col >= g.c1 && p.col <= g.c2) add(k, p.row); }
    }
    const f = (x) => E.formatValue(Number(x.toPrecision(12)), 'general');
    const multi = ranges.length > 1 || range().r1 !== range().r2 || range().c1 !== range().c2;
    statsEl.innerHTML = multi && count > 0 ? `${n ? `<span>Average: <b>${f(sum / n)}</b></span>` : ''}<span>Count: <b>${count}</b></span>${n ? `<span>Min: <b>${f(min)}</b></span><span>Max: <b>${f(max)}</b></span><span>Sum: <b>${f(sum)}</b></span>` : ''}` : '';
  }
  function syncRibbon() {
    if (!editable) return;
    const s = E.styleAt(sheet(), active.r, active.c) || {};
    const press = (cmd, on) => root.querySelector(`.ribbon [data-cmd="${cmd}"]`)?.classList.toggle('pressed', !!on);
    press('bold', s.b); press('italic', s.i); press('underline', s.u); press('wrap', s.wr);
    press('al-left', s.al === 'left'); press('al-center', s.al === 'center'); press('al-right', s.al === 'right');
    press('va-top', s.va === 'top'); press('va-middle', s.va === 'middle'); press('va-bottom', !s.va || s.va === 'bottom');
    press('merge', !!mergeAt(active.r, active.c)); press('show-formulas', showFormulas); press('painter', !!painter);
    const set = (sel, v) => { const el = root.querySelector(sel); if (el && el !== document.activeElement) el.value = v; };
    set('.rb-font', s.ff || ''); set('.rb-size', String(s.fz || 11)); set('.rb-numfmt', ['general', 'number', 'currency', 'date', 'percent', 'text'].includes(s.f || 'general') ? (s.f || 'general') : 'general');
    // contextual tabs: Table Design, PivotTable Analyze, Chart Design
    const t = E.tableAt(sheet(), active.r, active.c), pv = pivotHere(), ch = selChart && sheet().charts.find((x) => x.id === selChart);
    const ctxTabs = { 'Table Design': !!t && !selChart, 'PivotTable Analyze': !!pv && !selChart, 'Chart Design': !!ch };
    for (const [name, on] of Object.entries(ctxTabs)) { const tb = root.querySelector(`.rb-tab[data-rbtab="${name}"]`); if (!tb) continue; tb.hidden = !on; if (!on && tb.getAttribute('aria-expanded') === 'true') closeToolCard(); }
    if (t) { const nm = root.querySelector('.rb-tblname'); if (nm && nm !== document.activeElement) nm.value = t.name; for (const k of ['header', 'total', 'banded', 'bandedCols', 'firstCol', 'lastCol', 'filterBtn']) { const el = root.querySelector(`[data-tblopt="${k}"]`); if (el) el.checked = !!t[k]; } }
    press('protect', !!sheet().protect); const pl = root.querySelector('[data-cmd="protect"] span'); if (pl) pl.firstChild.textContent = sheet().protect ? 'Unprotect Sheet' : 'Protect Sheet';
    const pg = sheet().print || {}; const ck = (sel, on) => { const el = root.querySelector(sel); if (el) el.checked = on; }; ck('[data-cmd="print-grid"]', pg.grid !== false); ck('[data-cmd="print-heads"]', !!pg.heads);
    const vw = sheet().view || {};
    const chk = (cmd, on) => { const el = root.querySelector(`.ribbon [data-cmd="${cmd}"]`); if (el) el.checked = on; };
    chk('toggle-grid', vw.grid !== false); chk('toggle-heads', vw.heads !== false); chk('toggle-fbar', !root.classList.contains('no-fbar'));
  }
  function drawTabs() {
    tabs.innerHTML = '<span class="sheet-tablist" role="tablist" aria-label="Sheets">' + wb.sheets.map((s, i) => (s.hidden ? '' : `<button type="button" class="sheet-tab ${i === si ? 'on' : ''}" role="tab" aria-selected="${i === si}" data-tab="${i}" title="${esc(s.name)}"${s.tab ? ` style="--tab:${s.tab}"` : ''}>${s.protect ? '🔒 ' : ''}${esc(s.name)}</button>`)).join('') + '</span>' // only tabs in the tab list
      + (editable ? `<button type="button" class="sheet-tab-add" data-tabadd title="${kbd('New sheet (Shift+F11)')}" aria-label="New sheet">${icon('plus', { size: 15 })}</button>` : '');
  }

  /* =================== Selection and navigation =================== */
  function setActive(r, c, { extend = false, add = false, keepRanges = false } = {}) {
    r = Math.max(0, Math.min(E.MAX_ROWS - 1, r)); c = Math.max(0, Math.min(E.MAX_COLS - 1, c));
    if (extend) { const g = { r1: Math.min(anchor.r, r), r2: Math.max(anchor.r, r), c1: Math.min(anchor.c, c), c2: Math.max(anchor.c, c) }; ranges[ranges.length - 1] = expandMerges(g); }
    else if (add) { anchor = { r, c }; active = { r, c }; ranges.push({ r1: r, c1: c, r2: r, c2: c }); }
    else if (!keepRanges) { anchor = { r, c }; active = { r, c }; const m = mergeAt(r, c); ranges = [m ? { ...m } : { r1: r, c1: c, r2: r, c2: c }]; }
    else active = { r, c };
    if (!extend && !add) ctrlA = 0;
    ensureVisible(extend ? r : active.r, extend ? c : active.c);
    render(); syncChrome();
  }
  function expandMerges(g) { // a selection always covers whole merged cells
    let changed = true; const out = { ...g };
    while (changed) { changed = false; for (const m of Object.values(merges.anchors)) { if (m.r1 <= out.r2 && m.r2 >= out.r1 && m.c1 <= out.c2 && m.c2 >= out.c1) { const n = { r1: Math.min(out.r1, m.r1), r2: Math.max(out.r2, m.r2), c1: Math.min(out.c1, m.c1), c2: Math.max(out.c2, m.c2) }; if (JSON.stringify(n) !== JSON.stringify(out)) { Object.assign(out, n); changed = true; } } } }
    return out;
  }
  function ensureVisible(r, c) {
    if (!G) return; layout();
    const { fr, fc, FW, FH, qw, qh } = L;
    if (r >= fr) { const top = G.rowT(r), bottom = top + G.rowH(r); if (top < FH + wrap.scrollTop) wrap.scrollTop = top - FH; else if (bottom > FH + wrap.scrollTop + qh) wrap.scrollTop = bottom - FH - qh; }
    if (c >= fc) { const left = G.colL(c), right = left + G.colW(c); if (left < FW + wrap.scrollLeft) wrap.scrollLeft = left - FW; else if (right > FW + wrap.scrollLeft + qw) wrap.scrollLeft = Math.min(left - FW, right - FW - qw); }
  }
  function jump(r, c, dr, dc) { // Ctrl+arrow: to the edge of the data (Excel's rule)
    const inside = (rr, cc) => rr >= 0 && cc >= 0 && rr < E.MAX_ROWS && cc < E.MAX_COLS;
    let nr = r + dr, nc = c + dc;
    if (!inside(nr, nc)) return { r, c };
    if (!isEmpty(r, c) && !isEmpty(nr, nc)) { while (inside(nr + dr, nc + dc) && !isEmpty(nr + dr, nc + dc)) { nr += dr; nc += dc; } return { r: nr, c: nc }; }
    // skip empties (bounded by the data so it stays fast on a 100,000-row sheet)
    const u = usedBounds();
    while (inside(nr, nc) && isEmpty(nr, nc)) {
      if ((dr > 0 && nr >= u.rows) || (dc > 0 && nc >= u.cols)) return { r: dr > 0 ? E.MAX_ROWS - 1 : nr, c: dc > 0 ? E.MAX_COLS - 1 : nc };
      if (!inside(nr + dr, nc + dc)) return { r: nr, c: nc };
      nr += dr; nc += dc;
    }
    return { r: nr, c: nc };
  }
  function currentRegion(r = active.r, c = active.c) { // the block of data around a cell
    let g = { r1: r, r2: r, c1: c, c2: c }; let grew = true;
    const filled = (rr, cc) => rr >= 0 && cc >= 0 && !isEmpty(rr, cc);
    while (grew) {
      grew = false;
      const tryEdge = (cond, apply) => { if (cond()) { apply(); grew = true; } };
      tryEdge(() => [...Array(g.c2 - g.c1 + 3)].some((_, i) => filled(g.r1 - 1, g.c1 - 1 + i)), () => { g.r1--; });
      tryEdge(() => [...Array(g.c2 - g.c1 + 3)].some((_, i) => filled(g.r2 + 1, g.c1 - 1 + i)), () => { g.r2++; });
      tryEdge(() => [...Array(g.r2 - g.r1 + 3)].some((_, i) => filled(g.r1 - 1 + i, g.c1 - 1)), () => { g.c1--; });
      tryEdge(() => [...Array(g.r2 - g.r1 + 3)].some((_, i) => filled(g.r1 - 1 + i, g.c2 + 1)), () => { g.c2++; });
      g = { r1: Math.max(0, g.r1), c1: Math.max(0, g.c1), r2: g.r2, c2: g.c2 };
      if (g.r2 - g.r1 > 5000) break;
    }
    return g;
  }
  // Enter / Tab movement, including within a selected range and returning to where a run of Tabs started
  function moveEnter(dir = 1) {
    const g = range(); const multi = ranges.length === 1 && !(g.r1 === g.r2 && g.c1 === g.c2);
    if (multi) { let r = active.r + dir, c = active.c; if (r > g.r2) { r = g.r1; c = c + 1 > g.c2 ? g.c1 : c + 1; } if (r < g.r1) { r = g.r2; c = c - 1 < g.c1 ? g.c2 : c - 1; } setActive(r, c, { keepRanges: true }); return; }
    if (tabStart !== null && dir > 0) { const col = tabStart; tabStart = null; setActive(active.r + 1, col); return; }
    tabStart = null; setActive(active.r + dir, active.c);
  }
  function moveTab(dir = 1) {
    const g = range(); const multi = ranges.length === 1 && !(g.r1 === g.r2 && g.c1 === g.c2);
    if (multi) { let r = active.r, c = active.c + dir; if (c > g.c2) { c = g.c1; r = r + 1 > g.r2 ? g.r1 : r + 1; } if (c < g.c1) { c = g.c2; r = r - 1 < g.r1 ? g.r2 : r - 1; } setActive(r, c, { keepRanges: true }); return; }
    if (tabStart === null) tabStart = active.c;
    setActive(active.r, active.c + dir);
  }

  /* =================== Sheet protection =================== */
  const PROTECTED_MSG = 'The cell or chart you’re trying to change is on a protected sheet. To make a change, unprotect the sheet (Review → Unprotect Sheet).';
  function blocked(kind, cells = null) {
    const pr = sheet().protect; if (!pr || !editable) return false;
    if (kind === 'edit') {
      const list = cells || [{ r: active.r, c: active.c }];
      if (list.every(({ r, c }) => E.styleAt(sheet(), r, c)?.unl)) return false;
    } else if (pr.allow?.[kind]) return false;
    toast(PROTECTED_MSG, { tone: 'error', duration: 6000 }); return true;
  }
  const selCells = (limit = 20000) => { const out = []; for (const g0 of ranges) { const g = clampToUsed(g0); for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { out.push({ r, c }); if (out.length >= limit) return out; } } return out; };
  const inPivot = (r, c) => (sheet().pivots || []).find((pv) => { const g = pv.out && E.parseRange(pv.out); return g && r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2; });

  /* =================== Changing the workbook =================== */
  /** As in Excel: a column you haven't resized widens itself when a number in it no longer fits. */
  /** Returns true when a column got wider. `d`: the changes (from diffBooks). */
  function autoWidenNumbers(next, d) {
    const sh = next.sheets[si]; const before = wb.sheets.find((x) => x.id === sh.id);
    if (!before || !d) return false;
    const touched = new Set();
    for (const k of Object.keys(d.after.cells || {})) { const i = k.indexOf('/'); if (k.slice(0, i) === sh.id) { const p = E.parseKey(k.slice(i + 1)); if (p) touched.add(p.col); } }
    if (JSON.stringify(before.cs || {}) !== JSON.stringify(sh.cs || {})) for (const col of Object.keys(sh.cs || {})) touched.add(E.colIndex(col));
    const cols = [...touched].filter((c) => !sh.w[E.colName(c)] || sh.wa.includes(E.colName(c)));
    if (!cols.length) return false;
    const vals = calc.evaluate(next, { tidy: false })[sh.name] || {}; // the same calculator: the redraw after this costs almost nothing
    const want = new Set(cols);
    const need = new Map();
    for (const k of Object.keys(sh.cells)) {
      const p = E.parseKey(k); if (!want.has(p.col) || merges.covered.has(k)) continue;
      const sv = E.displayCellOf(sh, vals, k); if (!sv?.number) continue;
      need.set(p.col, Math.max(need.get(p.col) || 0, textWidth(sv.text, fontCss(E.styleAt(sh, p.row, p.col), 1)) + 8));
    }
    let wider = false;
    for (const [c, w] of need) { const name = E.colName(c); if (w > Math.max(E.DEF_W, sh.w[name] || 0)) { sh.w[name] = Math.ceil(w); if (!sh.wa.includes(name)) sh.wa.push(name); wider = true; } }
    return wider;
  }
  function commit(next) {
    if (!editable) return;
    next = E.normalizeWorkbook(next);
    let d = diffBooks(wb, next); if (!d) { draw(); return; } // the changes, worked out once
    if (autoWidenNumbers(next, d)) d = diffBooks(wb, next); // a column got wider: include that
    undo.push(d); if (undo.length > 200) undo.shift(); redo.length = 0;
    wb = next; si = Math.min(si, wb.sheets.length - 1);
    change?.((latest) => applySide(latest || wb, d.after), { side: d.after }); // the change list lets co-editing touch only what changed
    draw();
  }
  function step(from, to, side) {
    const d = from.pop(); if (!d) return;
    to.push(d); wb = applySide(wb, d[side]); si = Math.min(si, wb.sheets.length - 1);
    change?.((latest) => applySide(latest || wb, d[side]), { side: d[side] }); draw();
  }
  /** A copy of the workbook to change: everything is copied except cell objects, which are frozen and shared. */
  const copyBook = () => ({ ...wb, names: { ...(wb.names || {}) }, sheets: wb.sheets.map((sh) => { const { cells, ...rest } = sh; return { ...structuredClone(rest), cells: { ...cells } }; }) });
  const editSheet = (fn) => { const next = copyBook(); fn(next.sheets[si], next); commit(next); };
  function inputToCell(old, raw) {
    const parsed = E.parseInput(raw); const s = { ...(old?.s || {}) };
    if (parsed.f && (!s.f || s.f === 'general') && !s.nf) { s.f = parsed.f; if (parsed.dp !== undefined) s.dp = parsed.dp; if (parsed.nf) s.nf = parsed.nf; }
    if (String(raw).includes('\n')) s.wr = 1; // Alt+Enter line breaks turn on Wrap Text, as in Excel
    return parsed.v === '' && !Object.keys(s).length && !old?.n && !old?.l ? null : { v: parsed.v, ...(Object.keys(s).length ? { s } : {}), ...(old?.n ? { n: old.n } : {}), ...(old?.l ? { l: old.l } : {}) };
  }
  /** Apply a style change to the selection; whole rows/columns are styled once (as Excel does). */
  function styleSel(fn) {
    if (blocked('format')) return;
    editSheet((sh) => {
      for (const g0 of ranges) {
        if (fullCols(g0) || fullRows(g0)) {
          const isCols = fullCols(g0);
          if (isCols && fullRows(g0)) { for (let c = g0.c1; c <= Math.min(g0.c2, 200); c++) sh.cs[E.colName(c)] = clean(fn({ ...(sh.cs[E.colName(c)] || {}) }, -1, c, g0)); }
          else if (isCols) for (let c = g0.c1; c <= g0.c2; c++) sh.cs[E.colName(c)] = clean(fn({ ...(sh.cs[E.colName(c)] || {}) }, -1, c, g0));
          else for (let r = g0.r1; r <= g0.r2; r++) sh.rs[r] = clean(fn({ ...(sh.rs[r] || {}) }, r, -1, g0));
          for (const [k, cell] of Object.entries(sh.cells)) { const p = E.parseKey(k); if (p.row >= g0.r1 && p.row <= g0.r2 && p.col >= g0.c1 && p.col <= g0.c2 && cell.s) sh.cells[k] = { ...cell, s: clean(fn({ ...cell.s }, p.row, p.col, g0)) }; }
          continue;
        }
        const g = g0;
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
          const k = E.cellKey(r, c); const s = clean(fn({ ...(sh.cells[k]?.s || {}) }, r, c, g));
          if (!sh.cells[k]?.v && !s) delete sh.cells[k]; else sh.cells[k] = { v: sh.cells[k]?.v ?? '', ...(s ? { s } : {}) };
        }
      }
      for (const k of Object.keys(sh.cs)) if (!sh.cs[k]) delete sh.cs[k];
      for (const k of Object.keys(sh.rs)) if (!sh.rs[k]) delete sh.rs[k];
    });
  }
  const clean = (s) => { const o = Object.fromEntries(Object.entries(s || {}).filter(([, v]) => v !== undefined && v !== null && v !== 0 && v !== '' && !(typeof v === 'object' && !Object.keys(v).length))); return Object.keys(o).length ? o : null; };
  const toggle = (key) => { const on = !E.styleAt(sheet(), active.r, active.c)?.[key]; styleSel((s) => ({ ...s, [key]: on ? 1 : 0 })); };
  function clearSel(what) {
    if (blocked(what === 'formats' ? 'format' : 'edit', selCells())) return;
    editSheet((sh) => {
      for (const g of ranges) for (const [k, cell] of Object.entries(sh.cells)) {
        const p = E.parseKey(k); if (p.row < g.r1 || p.row > g.r2 || p.col < g.c1 || p.col > g.c2) continue;
        if (what === 'contents') { if (cell.s) sh.cells[k] = { v: '', s: cell.s }; else delete sh.cells[k]; }
        else if (what === 'formats') { if (cell.v) sh.cells[k] = { v: cell.v }; else delete sh.cells[k]; }
        else delete sh.cells[k];
      }
      if (what !== 'contents') for (const g of ranges) {
        if (fullCols(g)) for (let c = g.c1; c <= g.c2; c++) delete sh.cs[E.colName(c)];
        if (fullRows(g)) for (let r = g.r1; r <= g.r2; r++) delete sh.rs[r];
        if (what === 'all') sh.merges = sh.merges.filter((m) => { const mg = E.parseRange(m); return !(mg.r1 >= g.r1 && mg.r2 <= g.r2 && mg.c1 >= g.c1 && mg.c2 <= g.c2); });
      }
    });
  }

  /* =================== Editing a cell =================== */
  const POINT_BEFORE = /[=(,+\-*/^&<>:;\s]$/;
  const canPoint = () => editing && editing.el.value.startsWith('=') && (POINT_BEFORE.test(editing.el.value.slice(0, editing.el.selectionStart)) || editing.point);
  function startEdit(initial = null, { mode = initial !== null ? 'enter' : 'edit', from = 'cell' } = {}) {
    if (!editable || editing) return;
    if (blocked('edit')) { if (from === 'bar') wrap.focus(); return; }
    if (inPivot(active.r, active.c)) { toast('Cannot change this part of a PivotTable report.', { tone: 'error' }); if (from === 'bar') wrap.focus(); return; }
    let el;
    if (from === 'bar') el = fbar;
    else {
      el = document.createElement('textarea');
      el.className = 'xl-edit'; el.rows = 1; el.spellcheck = false;
      el.value = initial ?? rawOf(active.r, active.c);
      view.appendChild(el);
    }
    editing = { el, r: active.r, c: active.c, mode, from, point: null };
    placeEditor();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    if (from === 'cell') fbar.value = el.value;
    render(); syncChrome(); onEditInput();
  }
  function placeEditor() {
    if (!editing || editing.from !== 'cell') return;
    const { r, c } = editing; const m = mergeAt(r, c) || { r1: r, c1: c, r2: r, c2: c };
    const rc = rectOf(m); const pos = toView(m.r1, m.c1);
    const st = E.styleAt(sheet(), r, c) || {};
    const font = fontCss(st, zoom);
    const lines = editing.el.value.split('\n');
    const need = Math.max(...lines.map((l) => textWidth(l, font))) + 14 * zoom;
    const lh = Math.round((st.fz || 11) * 4 / 3 * zoom * 1.3);
    Object.assign(editing.el.style, { left: `${pos.x}px`, top: `${pos.y}px`, width: `${Math.min(Math.max(rc.w + 1, need), Math.max(rc.w + 1, L.vw - pos.x - 4))}px`, height: `${Math.max(rc.h + 1, lines.length * lh + 4)}px`, font, textAlign: st.al || 'left', color: st.fg || '', background: st.bg || '' });
  }
  function finishEdit(save, after = null) {
    if (!editing) return;
    const { el, r, c, from } = editing; const v = el.value;
    editing = null; hideSuggest(); hint.hidden = true;
    if (from === 'cell') el.remove();
    if (save === 'all') { // Ctrl+Enter: the same entry in every selected cell (formulas adjust per cell)
      editSheet((sh) => { for (const g of ranges) for (let rr = g.r1; rr <= Math.min(g.r2, g.r1 + 5000); rr++) for (let cc = g.c1; cc <= Math.min(g.c2, g.c1 + 200); cc++) { const k = E.cellKey(rr, cc); const cell = inputToCell(sh.cells[k], E.shiftRefs(v, rr - r, cc - c)); if (cell) sh.cells[k] = cell; else delete sh.cells[k]; } });
    } else if (save && v !== rawOf(r, c)) {
      const rule = E.dvRuleAt(sheet(), r, c);
      const apply = () => editSheet((sh) => { const k = E.cellKey(r, c); const cell = inputToCell(sh.cells[k], v); if (cell) sh.cells[k] = cell; else delete sh.cells[k]; tableAfterEdit(sh, r, c, v); });
      if (rule && !v.startsWith('=')) {
        const parsed = E.parseInput(v); const val = parsed.v === '' ? '' : Number.isFinite(Number(parsed.v)) && parsed.v.trim() !== '' ? Number(parsed.v) : parsed.v;
        if (!E.dvCheck(rule, val, v, wb, sheet().name)) { validationAlert(rule, { r, c, v, apply }); return; }
      }
      apply();
    } else draw();
    if (after) after();
    wrap.focus({ preventScroll: true });
    syncChrome();
  }
  function validationAlert(rule, { r, c, v, apply }) {
    const style = rule.err?.style || 'stop';
    const title = rule.err?.title || 'Data Validation';
    const text = rule.err?.text || 'This value doesn’t match the data validation restrictions defined for this cell.';
    const buttons = style === 'stop' ? [['retry', 'Retry', true], ['cancel', 'Cancel']] : style === 'warning' ? [['yes', 'Yes', true], ['no', 'No'], ['cancel', 'Cancel']] : [['ok', 'OK', true], ['cancel', 'Cancel']];
    let choice = 'cancel';
    openModal({ title, body: `<p class="xl-alert ${style}">${esc(text)}${style === 'warning' ? '<br><br>Continue?' : ''}</p>`,
      footer: buttons.map(([k, l, primary]) => `<button class="btn ${primary ? 'btn-primary' : 'btn-ghost'}" data-choice="${k}">${l}</button>`).join(''),
      onMount: (el, close) => el.addEventListener('click', (e) => { const b = e.target.closest('[data-choice]'); if (b) { choice = b.dataset.choice; close(); } }),
      onClose: () => setTimeout(() => {
        if (choice === 'yes' || choice === 'ok') apply();
        else if (choice === 'retry' || choice === 'no') { setActive(r, c); startEdit(v, { mode: 'edit' }); editing?.el.select(); }
        else draw();
      }, 30) });
  }
  function refsIn(text) {
    if (!String(text).startsWith('=')) return [];
    const out = []; let i = 0;
    String(text).split('"').forEach((part, j) => { if (j % 2) return; for (const m of part.matchAll(/(?<![A-Za-z!'$])(\$?[A-Z]{1,2}\$?\d+(?::\$?[A-Z]{1,2}\$?\d+)?)(?![\w(!])/g)) { const g = E.parseRange(m[1].replace(/\$/g, '')); if (g) out.push({ g, color: REF_COLORS[i++ % REF_COLORS.length] }); } });
    return out;
  }
  function onEditInput(e) {
    if (!editing) return;
    const el = editing.el;
    if (editing.from === 'cell') { fbar.value = el.value; placeEditor(); }
    // AutoComplete text from the same column, as Excel does
    if (e?.inputType === 'insertText' && editing.mode === 'enter' && !el.value.startsWith('=') && el.selectionStart === el.value.length && el.value.trim()) {
      const typed = el.value; const low = typed.toLowerCase(); const seen = new Map();
      for (const [k, cell] of Object.entries(sheet().cells)) {
        const p = E.parseKey(k); if (p.col !== editing.c || p.row === editing.r || Math.abs(p.row - editing.r) > 2000) continue;
        const v = String(cell.v || ''); if (!v || v.startsWith('=') || !Number.isNaN(Number(v)) || !v.toLowerCase().startsWith(low) || v.length <= typed.length) continue;
        seen.set(v.toLowerCase(), v);
      }
      if (seen.size === 1) { const full = [...seen.values()][0]; el.value = typed + full.slice(typed.length); el.setSelectionRange(typed.length, full.length); if (editing.from === 'cell') fbar.value = el.value; }
    }
    if (!e || e.inputType) editing.point = editing.mode === 'point' && editing.point ? editing.point : null;
    render();
    const before = el.value.slice(0, el.selectionStart);
    const m = el.value.startsWith('=') ? /(?:^=|[=(,+\-*/^&<>:;\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(before) : null;
    if (m) { const word = m[1].toUpperCase(); const list = E.functionNames().filter((n) => n.startsWith(word)).slice(0, 9); if (list.length && !(list.length === 1 && list[0] === word)) showSuggest(list, word); else hideSuggest(); } else hideSuggest();
    showHint(before);
    modeEl.textContent = { enter: 'Enter', edit: 'Edit', point: 'Point' }[editing.mode];
  }
  function popAt(pop) {
    const r = editing.el.getBoundingClientRect(), host = root.getBoundingClientRect();
    pop.style.left = `${r.left - host.left}px`; pop.style.top = `${r.bottom - host.top + 3}px`;
  }
  function showSuggest(list, word) {
    suggest.innerHTML = list.map((n, i) => `<div class="ss-item ${i === 0 ? 'on' : ''}" role="option" data-fn="${n}"><span><b>${n.slice(0, word.length)}</b>${n.slice(word.length)}</span><small>${esc(FN_HINTS[n] ? FN_HINTS[n].slice(n.length) : '')}</small></div>`).join('');
    suggest.hidden = false; suggest.dataset.word = word; popAt(suggest);
  }
  function hideSuggest() { suggest.hidden = true; }
  function acceptSuggest(name) {
    const el = editing.el; const word = suggest.dataset.word || ''; const pos = el.selectionStart;
    el.value = `${el.value.slice(0, pos - word.length)}${name}(${el.value.slice(pos)}`;
    const np = pos - word.length + name.length + 1; el.setSelectionRange(np, np);
    hideSuggest(); onEditInput(); el.focus();
  }
  function showHint(before) {
    if (!before.startsWith('=')) { hint.hidden = true; return; }
    let depth = 0, fn = null, arg = 0;
    for (let i = before.length - 1; i >= 0; i--) { const ch = before[i]; if (ch === ')') depth++; else if (ch === '(') { if (depth === 0) { fn = (/([A-Za-z][A-Za-z0-9.]*)$/.exec(before.slice(0, i)) || [])[1]; break; } depth--; } else if (ch === ',' && depth === 0) arg++; }
    const sig = fn && FN_HINTS[fn.toUpperCase()];
    if (!sig) { hint.hidden = true; return; }
    const name = sig.slice(0, sig.indexOf('(')); const args = sig.slice(sig.indexOf('(') + 1, -1).split(', ');
    hint.innerHTML = `${name}(${args.map((a, i) => (i === Math.min(arg, args.length - 1) ? `<b>${esc(a)}</b>` : esc(a))).join(', ')})`;
    hint.hidden = false; popAt(hint); if (!suggest.hidden) hint.style.top = `${parseFloat(hint.style.top) + suggest.offsetHeight + 3}px`;
  }
  function toggleAbsolute() {
    const el = editing.el; const pos = el.selectionStart; const text = el.value;
    for (const m of text.matchAll(/(\$?)([A-Z]{1,2})(\$?)(\d+)/g)) {
      if (pos < m.index || pos > m.index + m[0].length) continue;
      const next = { '00': ['$', '$'], 11: ['', '$'], '01': ['$', ''], 10: ['', ''] }[`${m[1] ? 1 : 0}${m[3] ? 1 : 0}`];
      const rep = `${next[0]}${m[2]}${next[1]}${m[4]}`;
      el.value = text.slice(0, m.index) + rep + text.slice(m.index + m[0].length);
      const np = m.index + rep.length; el.setSelectionRange(np, np); onEditInput(); return;
    }
  }
  function pointTo(r, c, extend) { // arrow keys or clicks while writing a formula insert a reference
    const el = editing.el;
    if (!editing.point) editing.point = { at: el.selectionStart, end: el.selectionStart, anchor: { r, c }, cur: { r, c } };
    const p = editing.point;
    if (!extend) p.anchor = { r, c };
    p.cur = { r, c };
    const g = { r1: Math.min(p.anchor.r, r), c1: Math.min(p.anchor.c, c), r2: Math.max(p.anchor.r, r), c2: Math.max(p.anchor.c, c) };
    const ref = E.rangeRef(g);
    el.value = el.value.slice(0, p.at) + ref + el.value.slice(p.end); p.end = p.at + ref.length;
    el.setSelectionRange(p.end, p.end);
    editing.mode = 'point';
    ensureVisible(r, c); onEditInput();
  }
  function editorKeys(e) {
    if (!editing) return;
    const el = editing.el; const k = e.key;
    if (!suggest.hidden && ['ArrowDown', 'ArrowUp', 'Tab'].includes(k)) {
      const items = [...suggest.querySelectorAll('.ss-item')]; let i = items.findIndex((x) => x.classList.contains('on'));
      if (k !== 'Tab') { e.preventDefault(); items[i]?.classList.remove('on'); i = (i + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[i].classList.add('on'); return; }
      e.preventDefault(); acceptSuggest(items[Math.max(0, i)].dataset.fn); return;
    }
    if (k === 'F4') { e.preventDefault(); toggleAbsolute(); return; }
    if (k === 'F2') { e.preventDefault(); editing.mode = editing.mode === 'edit' ? 'enter' : 'edit'; editing.point = null; modeEl.textContent = editing.mode === 'edit' ? 'Edit' : 'Enter'; return; }
    if (k === 'Enter') {
      if (e.altKey) { e.preventDefault(); const p = el.selectionStart; el.value = `${el.value.slice(0, p)}\n${el.value.slice(el.selectionEnd)}`; el.setSelectionRange(p + 1, p + 1); onEditInput(); return; }
      e.preventDefault();
      if (!suggest.hidden && editing.el.value.startsWith('=')) { const on = suggest.querySelector('.ss-item.on'); if (on) { acceptSuggest(on.dataset.fn); return; } }
      if (e.ctrlKey || e.metaKey) { finishEdit('all'); return; }
      finishEdit(true, () => moveEnter(e.shiftKey ? -1 : 1)); return;
    }
    if (k === 'Tab') { e.preventDefault(); finishEdit(true, () => moveTab(e.shiftKey ? -1 : 1)); return; }
    if (k === 'Escape') { e.preventDefault(); finishEdit(false); return; }
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k] && editing.mode !== 'edit') {
      e.preventDefault();
      if (canPoint()) { const p = editing.point; const base = p ? p.cur : { r: editing.r, c: editing.c }; const nr = base.r + arrows[k][0], nc = base.c + arrows[k][1]; pointTo(Math.max(0, nr), Math.max(0, nc), e.shiftKey); return; }
      const from = { r: editing.r, c: editing.c }; // where the entry was typed, read before the editor closes
      finishEdit(true, () => setActive(from.r + arrows[k][0], from.c + arrows[k][1])); return;
    }
    e.stopPropagation();
  }
  fbar.addEventListener('focus', () => { if (editable && !editing) startEdit(null, { mode: 'edit', from: 'bar' }); });
  fbar.addEventListener('input', (e) => onEditInput(e));
  fbar.addEventListener('keydown', editorKeys);
  fbar.addEventListener('blur', () => setTimeout(() => { if (editing?.from === 'bar' && document.activeElement !== fbar && !drag) finishEdit(true); }, 150));
  view.addEventListener('input', (e) => { if (e.target.classList.contains('xl-edit')) onEditInput(e); });
  view.addEventListener('keydown', (e) => { if (e.target.classList.contains('xl-edit')) editorKeys(e); }, true);
  view.addEventListener('keyup', (e) => { if (e.target.classList.contains('xl-edit') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) onEditInput(); });
  suggest.addEventListener('mousedown', (e) => { e.preventDefault(); const it = e.target.closest('[data-fn]'); if (it) acceptSuggest(it.dataset.fn); });

  /* =================== Mouse =================== */
  function hit(e) { // where in the sheet a mouse event is
    const b = view.getBoundingClientRect(); const vx = e.clientX - b.left, vy = e.clientY - b.top;
    layout();
    const sxv = vx < L.HW + L.FW ? vx - L.HW : vx - L.HW + L.sx;
    const syv = vy < L.HH + L.FH ? vy - L.HH : vy - L.HH + L.sy;
    const c = G.colAt(Math.max(0, sxv)), r = G.rowAt(Math.max(0, syv));
    return { vx, vy, r, c, inColHead: vy < L.HH && vx >= L.HW, inRowHead: vx < L.HW && vy >= L.HH, inCorner: vx < L.HW && vy < L.HH, sxv, syv };
  }
  let drag = null, fillDrag = null, autoScroll = null;
  function startAutoScroll(getEvt) {
    clearInterval(autoScroll);
    autoScroll = setInterval(() => {
      const e = getEvt(); if (!e) return; const b = wrap.getBoundingClientRect();
      if (e.clientY > b.bottom - 8) wrap.scrollTop += 20; else if (e.clientY < b.top + L.HH + 4) wrap.scrollTop -= 20;
      if (e.clientX > b.right - 8) wrap.scrollLeft += 20; else if (e.clientX < b.left + L.HW + 4) wrap.scrollLeft -= 20;
      if (drag) onMove(e);
    }, 50);
  }
  view.addEventListener('mousedown', (e) => {
    if (e.button === 2) return;
    if (e.target.closest('.xl-fbtn') || e.target.classList.contains('xl-edit') || e.target.closest('.xl-note, .xl-pop')) return;
    if (e.target.closest('[data-dvdrop], [data-totaldrop], [data-errtag]')) { e.preventDefault(); return; } // these open on click (below), like the filter buttons
    const h = hit(e); const sh = sheet();
    // resizing columns/rows from the headings
    const rz = e.target.closest('[data-colresize],[data-rowresize]');
    if (rz && editable) {
      e.preventDefault(); const isCol = rz.hasAttribute('data-colresize');
      const idx = Number(rz.parentElement.dataset[isCol ? 'col' : 'row']);
      const targets = (() => { const g = range(); const sel = isCol ? fullCols(g) && idx >= g.c1 && idx <= g.c2 : fullRows(g) && idx >= g.r1 && idx <= g.r2; return sel ? (isCol ? [g.c1, g.c2] : [g.r1, g.r2]) : [idx, idx]; })();
      const start = isCol ? e.clientX : e.clientY; const orig = (isCol ? G.colW(idx) : G.rowH(idx)) / zoom;
      const tip = document.createElement('div'); tip.className = 'xl-tip'; view.appendChild(tip);
      const size = (ev) => Math.max(0, Math.round(orig + ((isCol ? ev.clientX : ev.clientY) - start) / zoom));
      const move = (ev) => { tip.textContent = isCol ? `Width: ${size(ev)} px` : `Height: ${size(ev)} px`; const b = view.getBoundingClientRect(); tip.style.left = `${ev.clientX - b.left + 12}px`; tip.style.top = `${ev.clientY - b.top + 12}px`; };
      const up = (ev) => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); tip.remove();
        const px = size(ev); if (px === Math.round(orig)) return;
        editSheet((s) => { if (isCol) s.wa = s.wa.filter((n) => E.colIndex(n) < targets[0] || E.colIndex(n) > targets[1]); for (let i = targets[0]; i <= targets[1]; i++) { if (px === 0) { if (isCol) s.hc = [...new Set([...s.hc, i])]; else s.hr = [...new Set([...s.hr, i])]; } else if (isCol) s.w[E.colName(i)] = px; else s.h[i] = px; } });
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      return;
    }
    if (e.target.closest('[data-fill]')) { e.preventDefault(); fillDrag = { from: range(), to: null, box: null }; drag = { mode: 'fill', evt: e }; startAutoScroll(() => drag?.evt); return; }
    if (h.inCorner) { selectAll(); wrap.focus({ preventScroll: true }); return; }
    if (editing && !h.inColHead && !h.inRowHead && canPoint()) { e.preventDefault(); pointTo(h.r, h.c, e.shiftKey); drag = { mode: 'point', evt: e }; setTimeout(() => editing?.el.focus(), 0); startAutoScroll(() => drag?.evt); return; }
    if (editing) finishEdit(true);
    e.preventDefault();
    wrap.focus({ preventScroll: true });
    tabStart = null;
    if (h.inColHead) {
      if (e.shiftKey) { ranges[ranges.length - 1] = { r1: 0, r2: E.MAX_ROWS - 1, c1: Math.min(anchor.c, h.c), c2: Math.max(anchor.c, h.c) }; }
      else { anchor = { r: 0, c: h.c }; active = { r: Math.max(sh.freeze.r ? 0 : G.rowAt(L.sy + L.FH), 0), c: h.c }; const g = { r1: 0, r2: E.MAX_ROWS - 1, c1: h.c, c2: h.c }; if (e.ctrlKey || e.metaKey) ranges.push(g); else ranges = [g]; }
      drag = { mode: 'cols', evt: e }; render(); syncChrome(); startAutoScroll(() => drag?.evt); return;
    }
    if (h.inRowHead) {
      if (e.shiftKey) { ranges[ranges.length - 1] = { r1: Math.min(anchor.r, h.r), r2: Math.max(anchor.r, h.r), c1: 0, c2: E.MAX_COLS - 1 }; }
      else { anchor = { r: h.r, c: 0 }; active = { r: h.r, c: Math.max(0, G.colAt(L.sx + L.FW)) }; const g = { r1: h.r, r2: h.r, c1: 0, c2: E.MAX_COLS - 1 }; if (e.ctrlKey || e.metaKey) ranges.push(g); else ranges = [g]; }
      drag = { mode: 'rows', evt: e }; render(); syncChrome(); startAutoScroll(() => drag?.evt); return;
    }
    if (e.shiftKey) setActive(h.r, h.c, { extend: true });
    else setActive(h.r, h.c, { add: e.ctrlKey || e.metaKey });
    const linkCell = !e.shiftKey && !e.ctrlKey && !e.metaKey && sheet().cells[E.cellKey(h.r, h.c)]?.l;
    drag = { mode: 'cells', evt: e, link: linkCell ? { url: linkCell, at: Date.now(), r: h.r, c: h.c } : null }; startAutoScroll(() => drag?.evt);
  });
  function onMove(e) {
    if (!drag) return; drag.evt = e; const h = hit(e);
    if (drag.mode === 'cells') { const g = expandMerges({ r1: Math.min(anchor.r, h.r), r2: Math.max(anchor.r, h.r), c1: Math.min(anchor.c, h.c), c2: Math.max(anchor.c, h.c) }); if (JSON.stringify(g) !== JSON.stringify(range())) { ranges[ranges.length - 1] = g; render(); drawStats(); nameBox.value = `${g.r2 - g.r1 + 1}R × ${g.c2 - g.c1 + 1}C`; } }
    if (drag.mode === 'cols') { ranges[ranges.length - 1] = { r1: 0, r2: E.MAX_ROWS - 1, c1: Math.min(anchor.c, h.c), c2: Math.max(anchor.c, h.c) }; render(); drawStats(); }
    if (drag.mode === 'rows') { ranges[ranges.length - 1] = { r1: Math.min(anchor.r, h.r), r2: Math.max(anchor.r, h.r), c1: 0, c2: E.MAX_COLS - 1 }; render(); drawStats(); }
    if (drag.mode === 'point' && editing) pointTo(h.r, h.c, true);
    if (drag.mode === 'fill') {
      const g = fillDrag.from;
      const down = h.r > g.r2 ? h.r - g.r2 : h.r < g.r1 ? h.r - g.r1 : 0, right = h.c > g.c2 ? h.c - g.c2 : h.c < g.c1 ? h.c - g.c1 : 0;
      const to = Math.abs(down) >= Math.abs(right) ? { dir: down >= 0 ? 'down' : 'up', n: Math.abs(down) } : { dir: right >= 0 ? 'right' : 'left', n: Math.abs(right) };
      const box = { ...g }; if (to.dir === 'down') box.r2 += to.n; if (to.dir === 'up') box.r1 -= to.n; if (to.dir === 'right') box.c2 += to.n; if (to.dir === 'left') box.c1 -= to.n;
      fillDrag.to = to; fillDrag.box = to.n ? box : null; render();
    }
  }
  document.addEventListener('mousemove', onMove);
  const onUp = () => {
    clearInterval(autoScroll);
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'point' && editing) { editing.el.focus(); }
    if (d.mode === 'fill') { const f = fillDrag; fillDrag = null; if (f?.to?.n) fill(f.from, f.to.dir, f.to.n); else render(); }
    if (['cells', 'cols', 'rows'].includes(d.mode)) { syncChrome(); if (painter) applyPainter(); }
    // A quick click on a hyperlink follows it (click and hold just selects the cell), as in Excel
    if (d.mode === 'cells' && d.link && Date.now() - d.link.at < 350 && range().r1 === range().r2 && range().c1 === range().c2 && active.r === d.link.r && active.c === d.link.c) followLink(d.link.url);
  };
  document.addEventListener('mouseup', onUp);
  view.addEventListener('dblclick', (e) => {
    const rz = e.target.closest('[data-colresize],[data-rowresize]');
    if (rz && editable) { const isCol = rz.hasAttribute('data-colresize'); const idx = Number(rz.parentElement.dataset[isCol ? 'col' : 'row']); const g = range(); const sel = isCol ? fullCols(g) && idx >= g.c1 && idx <= g.c2 : fullRows(g) && idx >= g.r1 && idx <= g.r2; if (isCol) autofitCols(sel ? g.c1 : idx, sel ? g.c2 : idx); else autofitRows(sel ? g.r1 : idx, sel ? g.r2 : idx); return; }
    if (e.target.closest('[data-fill]')) { fillDownToData(); return; }
    if (painter) { return; }
    const h = hit(e);
    if (!h.inColHead && !h.inRowHead && !h.inCorner && !editing) startEdit(null, { mode: 'edit' });
  });
  view.addEventListener('click', (e) => { const b = e.target.closest('.xl-fbtn'); if (b) { e.stopPropagation(); openFilter(Number(b.dataset.fcol), b); } if (e.target.closest('[data-dvdrop]')) { e.stopPropagation(); openDropdown(); } });

  /* =================== Fill =================== */
  function fill(g, dir, n) {
    if (blocked('edit', [{ r: g.r2 + (dir === 'down' ? 1 : 0), c: g.c2 + (dir === 'right' ? 1 : 0) }])) return;
    editSheet((sh) => {
      const vertical = dir === 'down' || dir === 'up'; const back = dir === 'up' || dir === 'left';
      const [l1, l2] = vertical ? [g.c1, g.c2] : [g.r1, g.r2];
      for (let lane = l1; lane <= l2; lane++) {
        const src = [];
        if (vertical) for (let r = g.r1; r <= g.r2; r++) src.push(sh.cells[E.cellKey(r, lane)] || { v: '' });
        else for (let c = g.c1; c <= g.c2; c++) src.push(sh.cells[E.cellKey(lane, c)] || { v: '' });
        const seq = E.fillSeries(back ? [...src].reverse() : src, n, { dr: vertical ? (back ? -1 : 1) : 0, dc: vertical ? 0 : (back ? -1 : 1) });
        seq.forEach((cell, i) => {
          const r = vertical ? (back ? g.r1 - 1 - i : g.r2 + 1 + i) : lane, c = vertical ? lane : (back ? g.c1 - 1 - i : g.c2 + 1 + i);
          if (r < 0 || c < 0 || r >= E.MAX_ROWS || c >= E.MAX_COLS) return;
          const k = E.cellKey(r, c); if (cell.v === '' && !cell.s) delete sh.cells[k]; else sh.cells[k] = cell;
        });
      }
    });
    const box = { ...g }; if (dir === 'down') box.r2 += n; if (dir === 'up') box.r1 = Math.max(0, box.r1 - n); if (dir === 'right') box.c2 += n; if (dir === 'left') box.c1 = Math.max(0, box.c1 - n);
    ranges = [box]; anchor = { r: box.r1, c: box.c1 }; active = { ...anchor }; render(); syncChrome();
  }
  function fillDownToData() {
    const g = range(); const col = g.c1 > 0 && !isEmpty(g.r2 + 1, g.c1 - 1) ? g.c1 - 1 : g.c2 + 1;
    let last = g.r2; while (last + 1 < E.MAX_ROWS && !isEmpty(last + 1, col)) last++;
    if (last > g.r2) fill(g, 'down', last - g.r2);
  }
  function autofitCols(c1, c2) {
    const sh = sheet(); const widths = {};
    for (const [k, cell] of Object.entries(sh.cells)) { const p = E.parseKey(k); if (p.col < c1 || p.col > c2 || !cell.v || merges.covered.has(k) || merges.anchors[k]) continue; const st = E.styleAt(sh, p.row, p.col); const t = shown[k]?.text ?? ''; const w = Math.max(...String(t).split('\n').map((l) => textWidth(l, fontCss(st, 1)))) + 10; widths[p.col] = Math.max(widths[p.col] || 0, w); }
    editSheet((s) => { s.wa = s.wa.filter((nm) => E.colIndex(nm) < c1 || E.colIndex(nm) > c2); for (let c = c1; c <= c2; c++) { if (widths[c]) s.w[E.colName(c)] = Math.min(1200, Math.ceil(widths[c])); else delete s.w[E.colName(c)]; } });
  }
  function autofitRows(r1, r2) {
    const sh = sheet(); const heights = {};
    for (const [k, cell] of Object.entries(sh.cells)) {
      const p = E.parseKey(k); if (p.row < r1 || p.row > r2 || !cell.v) continue; const st = E.styleAt(sh, p.row, p.col) || {};
      const lineH = (st.fz || 11) * 4 / 3 * 1.35; const t = String(shown[k]?.text ?? '');
      let lines = t.split('\n').length;
      if (st.wr) { const w = (sh.w[E.colName(p.col)] || E.DEF_W) - 8; lines = t.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(textWidth(l, fontCss(st, 1)) / w)), 0); }
      heights[p.row] = Math.max(heights[p.row] || 0, Math.ceil(lines * lineH + 4));
    }
    editSheet((s) => { for (let r = r1; r <= Math.min(r2, r1 + 5000); r++) { if (heights[r] && heights[r] > E.DEF_H) s.h[r] = heights[r]; else delete s.h[r]; } });
  }

  /* =================== Keyboard (Excel's shortcuts) =================== */
  function selectAll() { ranges = [{ r1: 0, c1: 0, r2: E.MAX_ROWS - 1, c2: E.MAX_COLS - 1 }]; render(); syncChrome(); }
  wrap.addEventListener('keydown', (e) => {
    if (editing || e.target !== wrap) return;
    e.stopPropagation(); // the grid owns its keys: they must not also trigger the document editor's or the app's shortcuts
    const mod = e.metaKey || e.ctrlKey; const k = e.key; const sh = sheet();
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (e.altKey && k === 'ArrowDown') { e.preventDefault(); openDropdown(); return; }
    if (arrows[k]) {
      e.preventDefault(); tabStart = null; hidePop();
      const from = e.shiftKey ? { r: (range().r1 === anchor.r ? range().r2 : range().r1), c: (range().c1 === anchor.c ? range().c2 : range().c1) } : active;
      let next = mod ? jump(from.r, from.c, arrows[k][0], arrows[k][1]) : { r: from.r + arrows[k][0], c: from.c + arrows[k][1] };
      const m = !e.shiftKey && mergeAt(active.r, active.c); if (m && !mod) { if (arrows[k][0] > 0) next.r = m.r2 + 1; if (arrows[k][1] > 0) next.c = m.c2 + 1; }
      while (G.rowH(next.r) === 0 && next.r > 0 && next.r < E.MAX_ROWS - 1) next.r += arrows[k][0] || 1;
      while (G.colW(next.c) === 0 && next.c > 0 && next.c < E.MAX_COLS - 1) next.c += arrows[k][1] || 1;
      setActive(next.r, next.c, { extend: e.shiftKey }); return;
    }
    if (k === 'Tab') { e.preventDefault(); moveTab(e.shiftKey ? -1 : 1); return; }
    if (k === 'Enter') { e.preventDefault(); moveEnter(e.shiftKey ? -1 : 1); return; }
    if (k === 'Home') { e.preventDefault(); setActive(mod ? 0 : active.r, 0, { extend: e.shiftKey }); return; }
    if (k === 'End' && mod) { e.preventDefault(); const u = usedBounds(); setActive(u.rows - 1, u.cols - 1, { extend: e.shiftKey }); return; }
    if (k === 'PageDown' || k === 'PageUp') {
      e.preventDefault();
      if (mod) { let n = si; do { n += k === 'PageDown' ? 1 : -1; } while (n >= 0 && n < wb.sheets.length && wb.sheets[n].hidden); if (n >= 0 && n < wb.sheets.length && n !== si) switchSheet(n); return; }
      const rows = Math.max(1, Math.floor(L.qh / (E.DEF_H * zoom))); setActive(active.r + (k === 'PageDown' ? rows : -rows), active.c, { extend: e.shiftKey }); return;
    }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); const reg = currentRegion(); if (ctrlA === 0 && !isEmpty(active.r, active.c) && (reg.r2 > reg.r1 || reg.c2 > reg.c1)) { ranges = [reg]; ctrlA = 1; render(); syncChrome(); } else selectAll(); return; }
    if (e.shiftKey && k === ' ' && !mod) { e.preventDefault(); ranges = [{ r1: range().r1, r2: range().r2, c1: 0, c2: E.MAX_COLS - 1 }]; render(); syncChrome(); return; }
    if (e.ctrlKey && k === ' ') { e.preventDefault(); ranges = [{ r1: 0, r2: E.MAX_ROWS - 1, c1: range().c1, c2: range().c2 }]; render(); syncChrome(); return; }
    if (mod && (k.toLowerCase() === 'f' || k.toLowerCase() === 'h')) { e.preventDefault(); openFind(k.toLowerCase() === 'h'); return; }
    if ((mod && k.toLowerCase() === 'g') || k === 'F5') { e.preventDefault(); goTo(); return; }
    if (e.ctrlKey && (k === '`' || e.code === 'Backquote')) { e.preventDefault(); showFormulas = !showFormulas; render(); syncChrome(); return; }
    if (k === 'F9') { e.preventDefault(); draw(); return; }
    if (e.shiftKey && k === 'F11' && editable) { e.preventDefault(); addSheet(); return; }
    if (k === 'Escape') { if (clip?.marquee) { clip.marquee = false; render(); } if (painter) { painter = null; root.classList.remove('painting'); syncChrome(); } return; }
    if (!editable) return;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) step(redo, undo, 'after'); else step(undo, redo, 'before'); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); step(redo, undo, 'after'); return; }
    if (mod && !e.shiftKey && ['b', 'i', 'u'].includes(k.toLowerCase())) { e.preventDefault(); toggle(k.toLowerCase()); return; }
    if (mod && (k === '2' || k === '3' || k === '4') && !e.shiftKey) { e.preventDefault(); toggle({ 2: 'b', 3: 'i', 4: 'u' }[k]); return; }
    if (mod && e.shiftKey && (e.code === 'KeyL' || k.toLowerCase() === 'l')) { e.preventDefault(); toggleFilter(); return; }
    // Number-format shortcuts (Ctrl+Shift+~ $ % # ! @), borders (Ctrl+Shift+& and _)
    if (e.ctrlKey && e.shiftKey) {
      const byCode = { Backquote: 'general', Digit4: 'currency', Digit5: 'percent', Digit3: 'date', Digit1: 'number', Digit2: 'time', Digit7: 'outline', Minus: 'noborder', Digit9: 'unhide-rows', Digit0: 'unhide-cols', Semicolon: 'time-now', Quote: 'value-above', Equal: 'insert' }[e.code];
      if (byCode) { e.preventDefault(); return shortcut(byCode); }
    }
    if (e.ctrlKey && !e.shiftKey) {
      const byCode = { Digit9: 'hide-rows', Digit0: 'hide-cols', Semicolon: 'date-now', Quote: 'formula-above', Minus: 'delete', Equal: 'insert', NumpadAdd: 'insert', NumpadSubtract: 'delete', KeyD: 'fill-down', KeyR: 'fill-right' }[e.code];
      if (byCode) { e.preventDefault(); return shortcut(byCode); }
    }
    if (e.altKey && (k === '=' || e.code === 'Equal')) { e.preventDefault(); autoSum('SUM'); return; }
    if (selChart && (k === 'Delete' || k === 'Backspace')) { e.preventDefault(); if (!blocked('structure')) { const id = selChart; selChart = null; editSheet((sh) => { sh.charts = sh.charts.filter((x) => x.id !== id); }); } return; }
    if (selChart && k === 'Escape') { selChart = null; render(); syncRibbon(); return; }
    if (mod && (e.code === 'KeyT' || e.code === 'KeyL') && !e.shiftKey) { e.preventDefault(); if (E.tableAt(sheet(), active.r, active.c)) toast('This cell is already in a table.'); else dialogs.createTable(); return; }
    if (mod && e.altKey && k === 'F5') { e.preventDefault(); refreshAllPivots(); return; }
    if (mod && e.code === 'Digit1' && !e.shiftKey) { e.preventDefault(); dialogs.formatCells(); return; }
    if (mod && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); dialogs.formatCells(2); return; }
    if (mod && e.code === 'KeyK') { e.preventDefault(); dialogs.hyperlink(); return; }
    if (mod && e.altKey && e.code === 'KeyV') { e.preventDefault(); dialogs.pasteSpecial(); return; }
    if (mod && e.code === 'Digit5' && !e.shiftKey) { e.preventDefault(); toggle('st'); return; }
    if (mod && k === 'F3') { e.preventDefault(); dialogs.nameManager(); return; }
    if (k === 'F3' && !mod) { e.preventDefault(); const names = Object.keys(wb.names || {}); if (!names.length) { toast('There are no names yet'); return; } openMenu(nameBox, names.map((n) => ({ label: n, run: () => startEdit(`=${n}`, { mode: 'enter' }) })), { align: 'start' }); return; }
    if (e.shiftKey && k === 'F2') { e.preventDefault(); editNote(); return; }
    if (fileMode && (e.ctrlKey || e.metaKey) && e.altKey && (k === 'm' || k === 'M' || e.code === 'KeyM')) { e.preventDefault(); commentHere(); return; }
    if (e.altKey && k === 'ArrowDown') { e.preventDefault(); openDropdown(); return; }
    if (k === 'F2') { e.preventDefault(); startEdit(null, { mode: 'edit' }); return; }
    if (k === 'Delete') { e.preventDefault(); clearSel('contents'); return; }
    if (k === 'Backspace') { e.preventDefault(); startEdit('', { mode: 'enter' }); return; } // Excel: clear the cell and start typing
    if (k.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(k === ' ' ? ' ' : k, { mode: 'enter' }); }
  });
  function shortcut(name) {
    const g = range();
    switch (name) {
      case 'general': return styleSel((s) => ({ ...s, f: undefined, dp: undefined }));
      case 'currency': return styleSel((s) => ({ ...s, f: 'currency', dp: 2 }));
      case 'percent': return styleSel((s) => ({ ...s, f: 'percent', dp: 0 }));
      case 'date': return styleSel((s) => ({ ...s, f: 'date', dp: undefined }));
      case 'number': return styleSel((s) => ({ ...s, f: 'number', dp: 2 }));
      case 'time': return styleSel((s) => ({ ...s, f: 'number', dp: undefined }));
      case 'outline': return borders('outside');
      case 'noborder': return borders('none');
      case 'hide-rows': return editSheet((s) => { s.hr = [...new Set([...s.hr, ...span(g.r1, g.r2)])]; });
      case 'hide-cols': return editSheet((s) => { s.hc = [...new Set([...s.hc, ...span(g.c1, g.c2)])]; });
      case 'unhide-rows': return editSheet((s) => { s.hr = s.hr.filter((r) => r < g.r1 || r > g.r2); });
      case 'unhide-cols': return editSheet((s) => { s.hc = s.hc.filter((c) => c < g.c1 || c > g.c2); });
      case 'date-now': { const t = new Date(); startEdit(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`, { mode: 'enter' }); return null; }
      case 'time-now': { const t = new Date(); startEdit(`${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`, { mode: 'enter' }); return null; }
      case 'formula-above': if (active.r > 0) startEdit(rawOf(active.r - 1, active.c), { mode: 'edit' }); return null; // Ctrl+': the formula above, unchanged
      case 'value-above': if (active.r > 0) startEdit(shown[E.cellKey(active.r - 1, active.c)]?.text ?? '', { mode: 'edit' }); return null;
      case 'fill-down': if (g.r2 > g.r1) fill({ ...g, r2: g.r1 }, 'down', g.r2 - g.r1); else if (g.r1 > 0) { editSheet((s) => { for (let c = g.c1; c <= g.c2; c++) { const src = s.cells[E.cellKey(g.r1 - 1, c)]; if (src) s.cells[E.cellKey(g.r1, c)] = { ...src, v: E.shiftRefs(src.v, 1, 0) }; } }); } return null;
      case 'fill-right': if (g.c2 > g.c1) fill({ ...g, c2: g.c1 }, 'right', g.c2 - g.c1); else if (g.c1 > 0) { editSheet((s) => { for (let r = g.r1; r <= g.r2; r++) { const src = s.cells[E.cellKey(r, g.c1 - 1)]; if (src) s.cells[E.cellKey(r, g.c1)] = { ...src, v: E.shiftRefs(src.v, 0, 1) }; } }); } return null;
      case 'insert': return insertDialog();
      case 'delete': return deleteDialog();
      default: return null;
    }
  }
  const span = (a, b) => Array.from({ length: Math.min(b - a + 1, 20000) }, (_, i) => a + i);

  /* =================== Clipboard and Paste options =================== */
  function copySel(cut = false) {
    if (ranges.length > 1) { toast('That command can’t be used on multiple selections'); return null; }
    const g = clampToUsed(range()); const sh = sheet();
    const cells = [], text = [];
    for (let r = g.r1; r <= g.r2; r++) { if (G.hidR.has(r)) continue; const row = [], trow = []; for (let c = g.c1; c <= g.c2; c++) { const k = E.cellKey(r, c); row.push(sh.cells[k] ? { ...structuredClone(sh.cells[k]), s: E.styleAt(sh, r, c) || undefined } : null); const t = shown[k]?.text ?? ''; trow.push(/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t); } cells.push(row); text.push(trow.join('\t')); }
    clip = { cells, range: g, sheetId: sh.id, sheetName: sh.name, cut, text: text.join('\n'), marquee: true };
    render();
    return clip.text;
  }
  function pasteClip(how = 'all') {
    if (!clip) return;
    if (blocked('edit', selCells())) return;
    const src = clip; const at = { r: range().r1, c: range().c1 };
    const srcValues = values[src.sheetName] || {};
    const rowsN = src.cells.length, colsN = src.cells[0]?.length || 1;
    // a larger selection that's a multiple of the copied block gets it repeated, as in Excel
    const g = range(); const repR = how !== 'transpose' && (g.r2 - g.r1 + 1) % rowsN === 0 ? (g.r2 - g.r1 + 1) / rowsN : 1, repC = how !== 'transpose' && (g.c2 - g.c1 + 1) % colsN === 0 ? (g.c2 - g.c1 + 1) / colsN : 1;
    editSheet((sh, book) => {
      if (src.cut) { const from = book.sheets.find((s) => s.id === src.sheetId); if (from) for (let r = src.range.r1; r <= src.range.r2; r++) for (let c = src.range.c1; c <= src.range.c2; c++) delete from.cells[E.cellKey(r, c)]; }
      for (let rr = 0; rr < repR; rr++) for (let cc = 0; cc < repC; cc++) src.cells.forEach((row, i) => row.forEach((cell, j) => {
        const r = how === 'transpose' ? at.r + j : at.r + rr * rowsN + i, c = how === 'transpose' ? at.c + i : at.c + cc * colsN + j;
        if (r >= E.MAX_ROWS || c >= E.MAX_COLS) return;
        const k = E.cellKey(r, c); const existing = sh.cells[k];
        const dr = r - (src.range.r1 + i), dc = c - (src.range.c1 + j);
        let next;
        if (how === 'formats') next = existing?.v || cell?.s ? { v: existing?.v ?? '', ...(cell?.s ? { s: cell.s } : {}) } : null;
        else if (how === 'values') { const val = srcValues[E.cellKey(src.range.r1 + i, src.range.c1 + j)]?.value; next = cell ? { v: val === null || val === undefined ? '' : String(val), ...(existing?.s ? { s: existing.s } : {}) } : null; }
        else if (how === 'formulas') next = cell ? { v: src.cut ? cell.v : E.shiftRefs(cell.v, dr, dc), ...(existing?.s ? { s: existing.s } : {}) } : null;
        else next = cell ? { ...cell, v: src.cut ? cell.v : E.shiftRefs(cell.v, dr, dc) } : null;
        if (next && (next.v !== '' || next.s)) sh.cells[k] = clean2(next); else delete sh.cells[k];
      }));
    });
    const outR = how === 'transpose' ? colsN : rowsN * repR, outC = how === 'transpose' ? rowsN : colsN * repC;
    ranges = [{ r1: at.r, c1: at.c, r2: at.r + outR - 1, c2: at.c + outC - 1 }]; anchor = { ...at }; active = { ...at };
    if (src.cut) clip = null;
    draw(); syncChrome();
  }
  const clean2 = (cell) => (cell.s && !Object.keys(cell.s).length ? { v: cell.v } : cell);
  function parseTsv(text) { // tab-separated text, with Excel's quoting for cells containing tabs/new lines
    const rows = []; let row = [], cur = '', q = false;
    const t = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
      if (ch === '"' && cur === '') q = true; else if (ch === '\t') { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
    }
    row.push(cur); rows.push(row); return rows;
  }
  wrap.addEventListener('copy', (e) => { if (editing) return; const t = copySel(false); if (t === null) return; e.clipboardData.setData('text/plain', t); e.clipboardData.setData('application/x-sheet-cells', '1'); e.preventDefault(); });
  wrap.addEventListener('cut', (e) => { if (editing || !editable) return; const t = copySel(true); if (t === null) return; e.clipboardData.setData('text/plain', t); e.clipboardData.setData('application/x-sheet-cells', '1'); e.preventDefault(); });
  wrap.addEventListener('paste', (e) => {
    if (editing || !editable) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (clip && (e.clipboardData.getData('application/x-sheet-cells') || text === clip.text)) { pasteClip('all'); return; }
    if (!text) return;
    const block = parseTsv(text); const at = { r: range().r1, c: range().c1 };
    editSheet((sh) => block.forEach((line, i) => line.forEach((v, j) => {
      const r = at.r + i, c = at.c + j; if (r >= E.MAX_ROWS || c >= E.MAX_COLS) return;
      const k = E.cellKey(r, c); const cell = inputToCell(sh.cells[k], v); if (cell) sh.cells[k] = cell; else delete sh.cells[k];
    })));
    ranges = [{ r1: at.r, c1: at.c, r2: at.r + block.length - 1, c2: at.c + Math.max(...block.map((l) => l.length)) - 1 }]; render(); syncChrome();
  });
  async function clipboardCmd(kind) {
    if (kind === 'copy' || kind === 'cut') { const t = copySel(kind === 'cut'); if (t !== null) navigator.clipboard?.writeText(t).catch(() => {}); return; }
    if (clip) { pasteClip(kind); return; }
    try { const t = await navigator.clipboard.readText(); if (t) { wrap.focus(); const dt = new DataTransfer(); dt.setData('text/plain', t); wrap.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt })); } } catch { toast(kbd('Use Cmd+V to paste from another app')); }
  }

  /* =================== Format Painter =================== */
  function startPainter(sticky = false) {
    const g = clampToUsed(range()); const sh = sheet(); const styles = [];
    for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 200); r++) { const row = []; for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 100); c++) row.push(E.styleAt(sh, r, c)); styles.push(row); }
    painter = { styles, sticky }; root.classList.add('painting'); syncChrome();
  }
  function applyPainter() {
    const p = painter; if (!p) return;
    const g = range(); const H = p.styles.length, W = p.styles[0].length;
    editSheet((sh) => { for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 5000); r++) for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 200); c++) { const k = E.cellKey(r, c); const s = p.styles[(r - g.r1) % H][(c - g.c1) % W]; if (!sh.cells[k]?.v && !s) delete sh.cells[k]; else sh.cells[k] = { v: sh.cells[k]?.v ?? '', ...(s ? { s } : {}) }; } });
    if (!p.sticky) { painter = null; root.classList.remove('painting'); }
    syncChrome();
  }

  /* =================== Borders, merge, AutoSum, insert/delete =================== */
  function borders(kind) {
    styleSel((s, r, c, g) => {
      const bd = { ...(s.bd || {}) }; const top = r === g.r1 || r === -1, bot = r === g.r2 || r === -1, lft = c === g.c1 || c === -1, rgt = c === g.c2 || c === -1;
      const th = kind === 'thick' ? 2 : kind === 'double' ? 3 : 1;
      switch (kind) {
        case 'none': return { ...s, bd: undefined };
        case 'all': return { ...s, bd: { t: 1, r: 1, b: 1, l: 1 } };
        case 'outside': case 'thick': return { ...s, bd: { ...bd, ...(top ? { t: th } : {}), ...(bot ? { b: th } : {}), ...(lft ? { l: th } : {}), ...(rgt ? { r: th } : {}) } };
        case 'bottom': return bot ? { ...s, bd: { ...bd, b: 1 } } : s;
        case 'double-bottom': return bot ? { ...s, bd: { ...bd, b: 3 } } : s;
        case 'thick-bottom': return bot ? { ...s, bd: { ...bd, b: 2 } } : s;
        case 'top': return top ? { ...s, bd: { ...bd, t: 1 } } : s;
        case 'left': return lft ? { ...s, bd: { ...bd, l: 1 } } : s;
        case 'right': return rgt ? { ...s, bd: { ...bd, r: 1 } } : s;
        default: return s;
      }
    });
  }
  async function merge(kind) {
    if (blocked('structure')) return null;
    const g = range();
    if (kind === 'unmerge') return editSheet((sh) => { sh.merges = sh.merges.filter((m) => { const mg = E.parseRange(m); return !(mg.r1 <= g.r2 && mg.r2 >= g.r1 && mg.c1 <= g.c2 && mg.c2 >= g.c1); }); });
    if (g.r1 === g.r2 && g.c1 === g.c2) { const m = mergeAt(g.r1, g.c1); if (m) return merge('unmerge'); return toast('Select two or more cells to merge'); }
    const blocks = kind === 'across' ? span(g.r1, g.r2).map((r) => ({ r1: r, r2: r, c1: g.c1, c2: g.c2 })) : [g];
    let others = 0; for (const b of blocks) for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) if ((r !== b.r1 || c !== b.c1) && !isEmpty(r, c)) others++;
    if (others && !(await confirmDialog({ title: 'Merge cells?', message: 'Merging cells only keeps the upper-left value and discards other values.', confirmLabel: 'OK', tone: 'primary' }))) return null;
    editSheet((sh) => {
      for (const b of blocks) {
        for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) if (r !== b.r1 || c !== b.c1) delete sh.cells[E.cellKey(r, c)];
        sh.merges = sh.merges.filter((m) => { const mg = E.parseRange(m); return !(mg.r1 <= b.r2 && mg.r2 >= b.r1 && mg.c1 <= b.c2 && mg.c2 >= b.c1); });
        sh.merges.push(E.rangeRef(b));
        if (kind === 'center') { const k = E.cellKey(b.r1, b.c1); sh.cells[k] = { v: sh.cells[k]?.v ?? '', s: { ...(sh.cells[k]?.s || {}), al: 'center' } }; }
      }
    });
    return null;
  }
  function autoSum(fn = 'SUM') {
    const g = range(); const num = (r, c) => shown[E.cellKey(r, c)]?.number;
    if (g.r1 === g.r2 && g.c1 === g.c2) {
      let top = g.r1 - 1; while (top >= 0 && num(top, g.c1)) top--;
      if (top < g.r1 - 1) { startEdit(`=${fn}(${E.cellKey(top + 1, g.c1)}:${E.cellKey(g.r1 - 1, g.c1)})`, { mode: 'enter' }); return; }
      let left = g.c1 - 1; while (left >= 0 && num(g.r1, left)) left--;
      if (left < g.c1 - 1) { startEdit(`=${fn}(${E.cellKey(g.r1, left + 1)}:${E.cellKey(g.r1, g.c1 - 1)})`, { mode: 'enter' }); return; }
      startEdit(`=${fn}()`, { mode: 'point' }); setTimeout(() => { if (editing) { editing.el.setSelectionRange(fn.length + 2, fn.length + 2); onEditInput(); } }); return;
    }
    const gg = clampToUsed(g); const row = gg.r2 + 1;
    editSheet((s) => { for (let c = gg.c1; c <= gg.c2; c++) s.cells[E.cellKey(row, c)] = { v: `=${fn}(${E.cellKey(gg.r1, c)}:${E.cellKey(gg.r2, c)})`, ...(s.cells[E.cellKey(gg.r2, c)]?.s ? { s: s.cells[E.cellKey(gg.r2, c)].s } : {}) }; });
  }
  function insertRows(where) { if (blocked('insert')) return; insertRowsRaw(where); }
  function insertRowsRaw(where) { const g = range(); const n = g.r2 - g.r1 + 1; commit(E.changeRowsCols(wb, si, 'row', where === 'below' ? g.r2 + 1 : g.r1, Math.min(n, 5000))); }
  function insertCols(where) { if (blocked('insert')) return; insertColsRaw(where); }
  function insertColsRaw(where) { const g = range(); const n = g.c2 - g.c1 + 1; commit(E.changeRowsCols(wb, si, 'col', where === 'right' ? g.c2 + 1 : g.c1, Math.min(n, 200))); }
  function deleteRows() { if (blocked('delete')) return; deleteRowsRaw(); }
  function deleteRowsRaw() { const g = clampToUsed(range()); commit(E.changeRowsCols(wb, si, 'row', g.r1, -(g.r2 - g.r1 + 1))); setActive(g.r1, active.c); }
  function deleteCols() { if (blocked('delete')) return; deleteColsRaw(); }
  function deleteColsRaw() { const g = clampToUsed(range()); commit(E.changeRowsCols(wb, si, 'col', g.c1, -(g.c2 - g.c1 + 1))); setActive(active.r, g.c1); }
  function choose(title, options) { // a small Excel-style choice dialog
    return new Promise((resolve) => {
      let picked = null;
      openModal({ title, body: `<form class="form" id="xl-choose">${options.map(([v, l], i) => `<label class="xl-radio"><input type="radio" name="o" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</form>`,
        footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="xl-choose">OK</button>',
        onMount: (el, close) => el.querySelector('#xl-choose').addEventListener('submit', (ev) => { ev.preventDefault(); picked = ev.target.elements.o.value; close(); }),
        onClose: () => setTimeout(() => { resolve(picked); if (!editing) wrap.focus({ preventScroll: true }); }, 30) });
    });
  }
  function ask(title, label, value) {
    return new Promise((resolve) => {
      let out = null;
      openModal({ title, body: `<form class="form" id="xl-ask"><label class="field"><span>${esc(label)}</span><input name="v" value="${esc(value)}" autocomplete="off"></label></form>`,
        footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="xl-ask">OK</button>',
        onMount: (el, close) => { const f = el.querySelector('#xl-ask'); setTimeout(() => f.elements.v.select(), 30); f.addEventListener('submit', (ev) => { ev.preventDefault(); out = f.elements.v.value; close(); }); },
        onClose: () => setTimeout(() => { resolve(out); if (!editing) wrap.focus({ preventScroll: true }); }, 30) });
    });
  }
  async function insertDialog() {
    const g = range();
    if (fullRows(g)) return insertRows('above');
    if (fullCols(g)) return insertCols('left');
    return dialogs.insertCells(false);
  }
  async function deleteDialog() {
    const g = range();
    if (fullRows(g)) return deleteRows();
    if (fullCols(g)) return deleteCols();
    return dialogs.insertCells(true);
  }
  async function goTo() {
    const v = await ask('Go To', 'Reference (for example B12, A1:D20 or Sheet2!C5)', E.cellKey(active.r, active.c));
    if (v) navigate(v);
  }
  function navigate(text) {
    let ref = String(text).trim(); let target = si;
    const bang = ref.lastIndexOf('!');
    if (bang > 0) { const name = ref.slice(0, bang).replace(/^'|'$/g, ''); const i = wb.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase()); if (i < 0) { toast('Reference isn’t valid', { tone: 'error' }); return; } target = i; ref = ref.slice(bang + 1); }
    const named = Object.entries(wb.names || {}).find(([n]) => n.toLowerCase() === String(text).trim().toLowerCase());
    if (named) { const v = named[1]; const i = v.lastIndexOf('!'); const t = wb.sheets.findIndex((x) => x.name.toLowerCase() === v.slice(0, i).replace(/^'|'$/g, '').toLowerCase()); if (t >= 0) { target = t; ref = v.slice(i + 1); } }
    const g = E.parseRange(ref.replace(/\$/g, ''));
    if (!g) {
      if (E.isValidName(String(text).trim()) && editable) { const sh = sheet(); const q = /^[A-Za-z_][\w.]*$/.test(sh.name) ? sh.name : `'${sh.name}'`; setName(String(text).trim(), `${q}!${E.rangeRef(range()).split(':').map((p) => p.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')).join(':')}`); toast(`Name “${String(text).trim()}” created`); wrap.focus({ preventScroll: true }); return; }
      toast('Reference isn’t valid', { tone: 'error' }); return;
    }
    if (target !== si) switchSheet(target);
    anchor = { r: g.r1, c: g.c1 }; active = { ...anchor }; ranges = [g]; ensureVisible(g.r1, g.c1); wrap.focus({ preventScroll: true }); render(); syncChrome(); // focus first, so the Name Box updates
  }
  nameBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); navigate(nameBox.value); } if (e.key === 'Escape') { nameBox.value = E.cellKey(active.r, active.c); wrap.focus(); } e.stopPropagation(); });
  nameBox.addEventListener('focus', () => nameBox.select());

  /* =================== Sort, filter, conditional formatting =================== */
  function sortBy(dir) {
    if (blocked('sort')) return;
    const g = range();
    editSheet((sh) => {
      const vals = values[sh.name] || {};
      let next;
      if (g.r2 > g.r1 && !fullCols(g)) next = E.sortSheet(sh, vals, active.c, dir, g.r1, g.r2);
      else if (sh.filter) { const f = E.parseRange(sh.filter.range); next = E.sortSheet(sh, vals, active.c, dir, f.r1 + 1, f.r2); }
      else { const reg = currentRegion(); next = E.sortSheet(sh, vals, active.c, dir, reg.r1 + 1, reg.r2); }
      Object.assign(sh, next);
    });
  }
  function toggleFilter() {
    if (blocked('filter')) return;
    editSheet((sh) => { if (sh.filter) sh.filter = null; else { const g = range(); const region = g.r2 > g.r1 && !fullCols(g) ? g : currentRegion(); sh.filter = { range: E.rangeRef(region), crit: {} }; } });
  }
  function openFilter(col, anchorEl) {
    const sh = sheet(); const f = E.parseRange(sh.filter.range); const crit = sh.filter.crit[col] || {};
    const vals = new Set(); const v = values[sh.name] || {};
    for (let r = f.r1 + 1; r <= f.r2; r++) { const k = E.cellKey(r, col); const st = E.styleAt(sh, r, col); vals.add(E.formatValue(v[k]?.value, st?.f, st?.dp)); }
    const list = [...vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    document.querySelector('.sheet-filter-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'sheet-filter-pop menu';
    pop.innerHTML = `
      <button type="button" class="menu-item" data-fs="asc">Sort A to Z</button><button type="button" class="menu-item" data-fs="desc">Sort Z to A</button>
      <div class="menu-divider"></div><div class="menu-label">Filter by values</div>
      <input class="sfp-search" placeholder="Search" aria-label="Search values">
      <label class="sfp-row"><input type="checkbox" class="sfp-all" ${!crit.vals ? 'checked' : ''}> (Select All)</label>
      <div class="sfp-list">${list.map((x) => `<label class="sfp-row"><input type="checkbox" value="${esc(x)}" ${!crit.vals || crit.vals.includes(x) ? 'checked' : ''}> ${x ? esc(x) : '<em>(Blanks)</em>'}</label>`).join('')}</div>
      <div class="menu-divider"></div><div class="menu-label">Filter by condition</div>
      <div class="sfp-cond"><select class="sfp-op" aria-label="Condition"><option value="">None</option><option value="gt">Greater than</option><option value="lt">Less than</option><option value="eq">Equals</option><option value="ne">Does not equal</option><option value="contains">Contains</option></select><input class="sfp-val" placeholder="Value" aria-label="Value" value="${esc(crit.val || '')}"></div>
      <div class="sfp-btns"><button type="button" class="btn btn-plain btn-sm" data-fs="clear">Clear Filter</button><button type="button" class="btn btn-primary btn-sm" data-fs="ok">OK</button></div>`;
    document.body.appendChild(pop);
    pop.querySelector('.sfp-op').value = crit.op || '';
    const rr = anchorEl.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(rr.left, window.innerWidth - pop.offsetWidth - 8))}px`; pop.style.top = `${Math.max(8, Math.min(rr.bottom + 4, window.innerHeight - pop.offsetHeight - 8))}px`;
    const close = () => { pop.remove(); document.removeEventListener('mousedown', out, true); wrap.focus({ preventScroll: true }); };
    const out = (ev) => { if (!pop.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', out, true));
    pop.querySelector('.sfp-search').addEventListener('input', (ev) => { const q = ev.target.value.toLowerCase(); pop.querySelectorAll('.sfp-list .sfp-row').forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(q); }); });
    pop.querySelector('.sfp-all').addEventListener('change', (ev) => pop.querySelectorAll('.sfp-list input').forEach((i) => { i.checked = ev.target.checked; }));
    pop.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-fs]'); if (!b) return;
      if (b.dataset.fs === 'asc' || b.dataset.fs === 'desc') { close(); editSheet((s) => Object.assign(s, E.sortSheet(s, values[s.name] || {}, col, b.dataset.fs, f.r1 + 1, f.r2))); return; }
      if (b.dataset.fs === 'clear') { close(); editSheet((s) => { delete s.filter.crit[col]; }); return; }
      const checked = [...pop.querySelectorAll('.sfp-list input')].filter((i) => i.checked).map((i) => i.value);
      const op = pop.querySelector('.sfp-op').value, val = pop.querySelector('.sfp-val').value;
      close();
      editSheet((s) => { const c2 = {}; if (checked.length < list.length) c2.vals = checked; if (op) { c2.op = op; c2.val = val; } if (Object.keys(c2).length) s.filter.crit[col] = c2; else delete s.filter.crit[col]; });
    });
  }
  function openCf(preset = 'gt') {
    const sh = sheet(); let result = null;
    openModal({
      title: 'Conditional Formatting',
      body: `<form class="form" id="cf-form" novalidate>
        <label class="field"><span>Applies to</span><input name="range" value="${esc(E.rangeRef(clampToUsed(range())))}"></label>
        <label class="field"><span>Format cells that are…</span><select name="type"><option value="gt">Greater Than</option><option value="lt">Less Than</option><option value="eq">Equal To</option><option value="contains">Text that Contains</option><option value="scale">Color Scale (low to high)</option></select></label>
        <label class="field cf-value"><span>Value</span><input name="value"></label>
        <div class="cf-colors"><label>Fill <input type="color" name="bg" value="#ffc7ce"></label><label>Text <input type="color" name="fg" value="#9c0006"></label></div>
        <div class="cf-scale" hidden><label>Lowest <input type="color" name="lo" value="#f8696b"></label><label>Highest <input type="color" name="hi" value="#63be7b"></label></div>
        ${sh.cf.length ? `<div class="cf-list"><div class="menu-label">Rules on this sheet</div>${sh.cf.map((x, i) => `<div class="cf-rule"><span>${esc(x.range)}: ${{ gt: 'greater than', lt: 'less than', eq: 'equal to', contains: 'contains', scale: 'colour scale' }[x.type]} ${esc(x.value)}</span><button type="button" class="btn btn-plain btn-sm" data-cfdel="${i}">Delete Rule</button></div>`).join('')}</div>` : ''}
      </form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="cf-form">OK</button>',
      onMount: (el, close) => {
        const f = el.querySelector('#cf-form');
        const sync = () => { const sc = f.elements.type.value === 'scale'; el.querySelector('.cf-scale').hidden = !sc; el.querySelector('.cf-colors').hidden = sc; el.querySelector('.cf-value').hidden = sc; };
        f.elements.type.value = preset; sync(); f.elements.type.addEventListener('change', sync);
        el.addEventListener('click', (ev) => { const d = ev.target.closest('[data-cfdel]'); if (d) { const i = Number(d.dataset.cfdel); close(); editSheet((s) => { s.cf.splice(i, 1); }); } });
        f.addEventListener('submit', (ev) => { ev.preventDefault(); if (!E.parseRange(f.elements.range.value)) { toast('Type a range such as B2:B20', { tone: 'error' }); return; } result = { range: f.elements.range.value.toUpperCase(), type: f.elements.type.value, value: f.elements.value.value, bg: f.elements.bg.value, fg: f.elements.fg.value, lo: f.elements.lo.value, hi: f.elements.hi.value }; close(); });
      },
      onClose: () => setTimeout(() => { if (result) editSheet((s) => { s.cf.push(result); }); wrap.focus({ preventScroll: true }); }, 30),
    });
  }

  /* =================== Find and replace =================== */
  function openFind(replace = false) { findBar.hidden = false; findBar.classList.toggle('replace', replace); const i = findBar.querySelector(replace ? '.sf-repl' : '.sf-find') || findBar.querySelector('.sf-find'); i.focus(); i.select(); }
  function matches() {
    const q = findBar.querySelector('.sf-find').value; if (!q) return [];
    const cs = findBar.querySelector('.sf-case input').checked, whole = findBar.querySelector('.sf-whole input').checked;
    const norm = (s) => (cs ? s : s.toLowerCase()); const nq = norm(q);
    const out = [];
    for (const [k, cell] of Object.entries(sheet().cells)) { const raw = norm(String(cell.v ?? '')), txt = norm(shown[k]?.text ?? ''); if (whole ? raw === nq || txt === nq : raw.includes(nq) || txt.includes(nq)) { const p = E.parseKey(k); out.push({ r: p.row, c: p.col }); } }
    return out.sort((a, b) => a.r - b.r || a.c - b.c);
  }
  function findStep(dir) {
    const list = matches(); const count = findBar.querySelector('.sf-count');
    if (!list.length) { count.textContent = 'No matches'; return; }
    let i;
    if (dir > 0) { i = list.findIndex((m) => m.r > active.r || (m.r === active.r && m.c > active.c)); if (i < 0) i = 0; }
    else { i = -1; for (let j = list.length - 1; j >= 0; j--) if (list[j].r < active.r || (list[j].r === active.r && list[j].c < active.c)) { i = j; break; } if (i < 0) i = list.length - 1; }
    setActive(list[i].r, list[i].c); count.textContent = `${i + 1} of ${list.length}`;
  }
  const replaceIn = (v, q, rep, cs) => String(v).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cs ? 'g' : 'gi'), rep);
  findBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    const q = findBar.querySelector('.sf-find').value, rep = findBar.querySelector('.sf-repl')?.value ?? '', cs = findBar.querySelector('.sf-case input').checked;
    if (b.dataset.f === 'close') { findBar.hidden = true; wrap.focus({ preventScroll: true }); return; }
    if (b.dataset.f === 'next') findStep(1);
    if (b.dataset.f === 'prev') findStep(-1);
    if (b.dataset.f === 'replace' && q) { const k = E.cellKey(active.r, active.c); const cell = sheet().cells[k]; if (cell && replaceIn(cell.v, q, rep, cs) !== cell.v) editSheet((sh) => { sh.cells[k] = { ...cell, v: replaceIn(cell.v, q, rep, cs) }; }); findStep(1); }
    if (b.dataset.f === 'all' && q) { let n = 0; editSheet((sh) => { for (const [k, cell] of Object.entries(sh.cells)) { const v = replaceIn(cell.v, q, rep, cs); if (v !== cell.v) { sh.cells[k] = { ...cell, v }; n++; } } }); toast(`All done. We made ${n} replacement${n === 1 ? '' : 's'}.`); }
  });
  findBar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { findBar.hidden = true; wrap.focus(); } e.stopPropagation(); });

  /* =================== Sheets =================== */
  /* Comments on cells (spreadsheet files): the comments panel draws its threads; this marks the cells and shows them. */
  function commentHere() {
    const k = E.cellKey(active.r, active.c);
    document.dispatchEvent(new CustomEvent('doc:comment-anchor', { detail: { type: 'cell', sheet: sheet().id, cell: k, label: `${sheet().name}!${k}` } }));
  }
  const onCommentAnchors = (e) => { if (!fileMode) return; commented = new Set((e.detail?.anchors || []).filter((a) => a.type === 'cell').map((a) => `${a.sheet}!${a.cell}`)); draw(); };
  const onCommentGoto = (e) => {
    if (!fileMode || !e.detail) return; document.__pendingGoto = null; const i = wb.sheets.findIndex((x) => x.id === e.detail.sheet); const p = E.parseKey(e.detail.cell);
    if (i < 0 || !p) { toast('That cell’s sheet no longer exists'); return; }
    if (i !== si) switchSheet(i);
    setActive(p.row, p.col); draw(); wrap.focus({ preventScroll: true });
  };
  document.addEventListener('comments:anchors', onCommentAnchors);
  document.addEventListener('sheet:goto', onCommentGoto);
  if (document.__commentAnchors) queueMicrotask(() => onCommentAnchors({ detail: { anchors: document.__commentAnchors } })); // the comments may have loaded first
  if (fileMode && document.__pendingGoto?.type === 'cell') { const g = document.__pendingGoto; setTimeout(() => onCommentGoto({ detail: g }), 0); } // opened from a search result
  function switchSheet(i) { if (editing) finishEdit(true); si = i; ranges = [{ r1: 0, c1: 0, r2: 0, c2: 0 }]; active = { r: 0, c: 0 }; anchor = { r: 0, c: 0 }; wrap.scrollTop = 0; wrap.scrollLeft = 0; draw(); wrap.focus({ preventScroll: true }); }
  function addSheet() { const next = copyBook(); let n = next.sheets.length + 1; while (next.sheets.some((s) => s.name.toLowerCase() === `sheet${n}`)) n++; next.sheets.splice(si + 1, 0, E.emptySheet(undefined, undefined, `Sheet${n}`)); si += 1; ranges = [{ r1: 0, c1: 0, r2: 0, c2: 0 }]; active = { r: 0, c: 0 }; anchor = { r: 0, c: 0 }; commit(next); }
  function renameTab(i) {
    const tab = tabs.querySelector(`[data-tab="${i}"]`); if (!tab) return;
    const input = document.createElement('input'); input.className = 'sheet-tab-input'; input.value = wb.sheets[i].name; input.setAttribute('aria-label', 'Sheet name');
    tab.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = (save) => { if (done) return; done = true; const v = input.value.trim(); if (save && v && v !== wb.sheets[i].name) { if (wb.sheets.some((s, j) => j !== i && s.name.toLowerCase() === v.toLowerCase())) { toast('That name is already taken. Try a different one.', { tone: 'error' }); drawTabs(); } else commit(E.renameSheet(wb, i, v)); } else drawTabs(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    input.addEventListener('blur', () => finish(true));
  }
  function tabMenu(i, anchorEl) {
    openMenu(anchorEl, [
      { label: 'Insert sheet', run: addSheet },
      { label: 'Rename', run: () => renameTab(i) },
      { label: 'Tab Color…', run: () => dialogs.tabColor(i) },
      { label: 'Hide', run: () => hideSheet(i) }, { label: 'Unhide…', run: () => dialogs.unhideSheet() },
      { label: wb.sheets[i].protect ? 'Unprotect Sheet…' : 'Protect Sheet…', run: () => { if (i !== si) switchSheet(i); return wb.sheets[i].protect ? dialogs.unprotectSheet() : dialogs.protectSheet(); } },
      { label: 'Duplicate', run: () => { const next = copyBook(); const copy = { ...structuredClone(next.sheets[i]), id: undefined, name: `${next.sheets[i].name} (2)` }; next.sheets.splice(i + 1, 0, copy); si = i + 1; commit(next); } },
      ...(i > 0 ? [{ label: 'Move left', run: () => { const next = copyBook(); const [s] = next.sheets.splice(i, 1); next.sheets.splice(i - 1, 0, s); si = i - 1; commit(next); } }] : []),
      ...(i < wb.sheets.length - 1 ? [{ label: 'Move right', run: () => { const next = copyBook(); const [s] = next.sheets.splice(i, 1); next.sheets.splice(i + 1, 0, s); si = i + 1; commit(next); } }] : []),
      ...(wb.sheets.length > 1 ? ['divider', { label: 'Delete', danger: true, run: async () => { if (await confirmDialog({ title: `Delete “${wb.sheets[i].name}”?`, message: 'This sheet will be permanently deleted. Formulas that refer to it will show #REF!. (Undo brings it back.)', confirmLabel: 'Delete' })) { const next = copyBook(); next.sheets.splice(i, 1); si = Math.max(0, Math.min(si, next.sheets.length - 1)); commit(next); } } }] : []),
    ], { align: 'start' });
  }
  tabs.addEventListener('click', (e) => {
    if (e.target.closest('[data-tabadd]')) { if (editing) finishEdit(true); addSheet(); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab && Number(tab.dataset.tab) !== si) switchSheet(Number(tab.dataset.tab));
  });
  tabs.addEventListener('dblclick', (e) => { const tab = e.target.closest('[data-tab]'); if (tab && editable) renameTab(Number(tab.dataset.tab)); });
  tabs.addEventListener('contextmenu', (e) => { const tab = e.target.closest('[data-tab]'); if (!tab || !editable) return; e.preventDefault(); tabMenu(Number(tab.dataset.tab), tab); });

  /* =================== Right-click menus =================== */
  view.addEventListener('contextmenu', (e) => {
    if (e.target.classList.contains('xl-edit')) return;
    e.preventDefault();
    if (editing) finishEdit(true);
    const h = hit(e); const g = range();
    const inSel = ranges.some((x) => h.r >= x.r1 && h.r <= x.r2 && h.c >= x.c1 && h.c <= x.c2);
    if (h.inColHead && !(fullCols(g) && h.c >= g.c1 && h.c <= g.c2)) { anchor = { r: 0, c: h.c }; active = { r: 0, c: h.c }; ranges = [{ r1: 0, r2: E.MAX_ROWS - 1, c1: h.c, c2: h.c }]; }
    else if (h.inRowHead && !(fullRows(g) && h.r >= g.r1 && h.r <= g.r2)) { anchor = { r: h.r, c: 0 }; active = { r: h.r, c: 0 }; ranges = [{ r1: h.r, r2: h.r, c1: 0, c2: E.MAX_COLS - 1 }]; }
    else if (!h.inColHead && !h.inRowHead && !inSel) setActive(h.r, h.c);
    render(); syncChrome();
    const sel = range(); const isCols = fullCols(sel), isRows = fullRows(sel);
    const pseudo = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) };
    const items = [
      { label: 'Cut', run: () => clipboardCmd('cut') }, { label: 'Copy', run: () => clipboardCmd('copy') },
      ...(editable ? [
        { label: 'Paste', run: () => clipboardCmd('all') }, { label: 'Paste Values', run: () => clipboardCmd('values') }, { label: 'Paste Formatting', run: () => clipboardCmd('formats') }, { label: 'Transpose', run: () => clipboardCmd('transpose') },
        'divider',
        { label: 'Paste Special…', run: () => dialogs.pasteSpecial() },
        ...(isCols ? [{ label: 'Insert', run: () => insertCols('left') }, { label: 'Delete', run: deleteCols }]
          : isRows ? [{ label: 'Insert', run: () => insertRows('above') }, { label: 'Delete', run: deleteRows }]
            : [{ label: 'Insert…', run: () => dialogs.insertCells(false) }, { label: 'Delete…', run: () => dialogs.insertCells(true) }]),
        { label: 'Clear Contents', run: () => clearSel('contents') },
        'divider',
        ...(isCols ? [{ label: 'Column Width…', run: () => sizeDialog('col') }, { label: 'AutoFit Column Width', run: () => autofitCols(sel.c1, sel.c2) }, { label: 'Hide', run: () => shortcut('hide-cols') }, { label: 'Unhide', run: () => shortcut('unhide-cols') }]
          : isRows ? [{ label: 'Row Height…', run: () => sizeDialog('row') }, { label: 'AutoFit Row Height', run: () => autofitRows(sel.r1, sel.r2) }, { label: 'Hide', run: () => shortcut('hide-rows') }, { label: 'Unhide', run: () => shortcut('unhide-rows') }]
            : [{ label: 'Sort A to Z', run: () => sortBy('asc') }, { label: 'Sort Z to A', run: () => sortBy('desc') }, { label: 'Custom Sort…', run: () => dialogs.sortDialog() }, { label: sheet().filter ? 'Remove Filter' : 'Filter', run: toggleFilter }, 'divider',
              ...(E.dvRuleAt(sheet(), active.r, active.c)?.type === 'list' ? [{ label: 'Pick From Drop-down List…', run: openDropdown }] : []),
              ...(fileMode ? [{ label: 'Comment', icon: 'commentPlus', run: () => commentHere() }] : []), { label: sheet().cells[E.cellKey(active.r, active.c)]?.n ? 'Edit Note' : 'New Note', run: editNote }, ...(sheet().cells[E.cellKey(active.r, active.c)]?.n ? [{ label: 'Delete Note', run: deleteNotes }] : []),
              ...(E.tableAt(sheet(), active.r, active.c) ? [{ label: 'Table: Totals Row', run: () => { const t = E.tableAt(sheet(), active.r, active.c); updateTable(t.name, { total: !t.total }); } }, { label: 'Table: Convert to Range', run: () => run('tbl-convert') }] : []),
              ...(pivotHere() ? [{ label: 'Refresh PivotTable', run: () => run('pv-refresh') }, { label: 'Show Field List', run: () => { pivotPanel = true; drawPivotPanel(); } }] : []),
              { label: 'Format Cells…', run: () => dialogs.formatCells() }, { label: 'Define Name…', run: () => dialogs.defineName() }, { label: sheet().cells[E.cellKey(active.r, active.c)]?.l ? 'Edit Hyperlink…' : 'Link…', run: () => dialogs.hyperlink() }, ...(sheet().cells[E.cellKey(active.r, active.c)]?.l ? [{ label: 'Open Hyperlink', run: () => followLink(sheet().cells[E.cellKey(active.r, active.c)].l) }, { label: 'Remove Hyperlink', run: () => setLink(null, null) }] : []), { label: 'Conditional Formatting…', run: () => openCf() }]),
      ] : []),
    ];
    openMenu(pseudo, items, { align: 'start' });
  });
  async function sizeDialog(kind) {
    const g = range(); const isCol = kind === 'col';
    const cur = isCol ? G.colW(g.c1) / zoom : G.rowH(g.r1) / zoom;
    const v = await ask(isCol ? 'Column Width' : 'Row Height', isCol ? 'Column width (pixels)' : 'Row height (pixels)', String(Math.round(cur)));
    const n = Math.round(Number(v)); if (!v || !Number.isFinite(n) || n < 0) return;
    editSheet((s) => {
      if (isCol) s.wa = s.wa.filter((nm) => E.colIndex(nm) < g.c1 || E.colIndex(nm) > g.c2);
      if (isCol) for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 702); c++) { if (n === 0) s.hc = [...new Set([...s.hc, c])]; else { s.w[E.colName(c)] = n; s.hc = s.hc.filter((x) => x !== c); } }
      else for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 20000); r++) { if (n === 0) s.hr = [...new Set([...s.hr, r])]; else { s.h[r] = n; s.hr = s.hr.filter((x) => x !== r); } }
    });
  }

  /* =================== Insert Function dialog =================== */
  function insertFunctionDialog(category = null) {
    let picked = null;
    const all = E.functionNames();
    openModal({
      title: 'Insert Function',
      body: `<div class="xl-fn"><input class="xl-fn-search" placeholder="Search for a function" aria-label="Search for a function"><select class="xl-fn-cat" aria-label="Category"><option value="">All</option>${Object.keys(FN_CATEGORIES).map((c) => `<option ${c === category ? 'selected' : ''}>${c}</option>`).join('')}</select><div class="xl-fn-list" role="listbox"></div><p class="xl-fn-sig"></p></div>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>OK</button>',
      onMount: (el, close) => {
        const list = el.querySelector('.xl-fn-list'), search = el.querySelector('.xl-fn-search'), cat = el.querySelector('.xl-fn-cat'), sig = el.querySelector('.xl-fn-sig');
        let cur = null;
        const show = () => {
          const q = search.value.trim().toUpperCase(); const pool = cat.value ? FN_CATEGORIES[cat.value] : all;
          const names = pool.filter((n) => !q || n.includes(q)).slice(0, 300);
          list.innerHTML = names.map((n, i) => `<div class="xl-fn-item ${i === 0 ? 'on' : ''}" data-fn="${n}">${n}</div>`).join('') || '<p class="muted">No functions match.</p>';
          cur = names[0] || null; sig.textContent = cur ? (FN_HINTS[cur] || `${cur}(…)`) : '';
        };
        search.addEventListener('input', show); cat.addEventListener('change', show);
        list.addEventListener('click', (ev) => { const it = ev.target.closest('[data-fn]'); if (!it) return; list.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); it.classList.add('on'); cur = it.dataset.fn; sig.textContent = FN_HINTS[cur] || `${cur}(…)`; });
        list.addEventListener('dblclick', (ev) => { const it = ev.target.closest('[data-fn]'); if (it) { picked = it.dataset.fn; close(); } });
        el.querySelector('[data-ok]').addEventListener('click', () => { picked = cur; close(); });
        show(); setTimeout(() => search.focus(), 30);
      },
      // let the dialog finish handing focus back before the editor takes it
      onClose: () => setTimeout(() => { if (picked) insertFunction(picked); else wrap.focus({ preventScroll: true }); }, 30),
    });
  }
  function insertFunctionName(n) { if (editing && editing.el.value.startsWith('=')) { const el = editing.el; const p = el.selectionStart; el.value = `${el.value.slice(0, p)}${n}${el.value.slice(p)}`; el.setSelectionRange(p + n.length, p + n.length); el.focus(); onEditInput(); return; } if (editing) finishEdit(true); startEdit(`=${n}`, { mode: 'enter' }); }
  function insertFunction(name) {
    if (editing && editing.el.value.startsWith('=')) { const el = editing.el; const p = el.selectionStart; el.value = `${el.value.slice(0, p)}${name}(${el.value.slice(p)}`; el.setSelectionRange(p + name.length + 1, p + name.length + 1); el.focus(); onEditInput(); return; }
    if (editing) finishEdit(true);
    startEdit(`=${name}(`, { mode: 'point' });
  }

  /* =================== Phase 2 operations (used by the dialogs) =================== */
  function pasteSpecial({ what = 'all', op = '', skip = false, transpose = false }) {
    if (!clip) return;
    const src = clip; const at = { r: range().r1, c: range().c1 }; const srcVals = values[src.sheetName] || {};
    const H = src.cells.length, W = src.cells[0]?.length || 1;
    if (what === 'widths') { const from = wb.sheets.find((x) => x.id === src.sheetId); editSheet((sh) => { for (let j = 0; j < W; j++) { const w = from?.w[E.colName(src.range.c1 + j)]; const k = E.colName(at.c + j); if (w) sh.w[k] = w; else delete sh.w[k]; } }); return; }
    const g = range(); const repR = !transpose && (g.r2 - g.r1 + 1) % H === 0 ? (g.r2 - g.r1 + 1) / H : 1, repC = !transpose && (g.c2 - g.c1 + 1) % W === 0 ? (g.c2 - g.c1 + 1) / W : 1;
    editSheet((sh) => {
      for (let rr = 0; rr < Math.min(repR, 5000); rr++) for (let cc = 0; cc < Math.min(repC, 200); cc++) src.cells.forEach((row, i) => row.forEach((cell, j) => {
        const r = transpose ? at.r + j : at.r + rr * H + i, c = transpose ? at.c + i : at.c + cc * W + j; if (r >= E.MAX_ROWS || c >= E.MAX_COLS) return;
        if (skip && (!cell || cell.v === '')) return;
        const k = E.cellKey(r, c); const ex = sh.cells[k] || null; const srcVal = srcVals[E.cellKey(src.range.r1 + i, src.range.c1 + j)]?.value;
        let next = ex ? { ...ex } : { v: '' };
        const fmtOnly = (s0) => (s0 ? { ...(s0.f ? { f: s0.f } : {}), ...(s0.nf ? { nf: s0.nf } : {}), ...(Number.isInteger(s0.dp) ? { dp: s0.dp } : {}) } : {});
        if (['all', 'noborders', 'formulas', 'formulasnum'].includes(what)) next.v = cell ? E.shiftRefs(cell.v, r - (src.range.r1 + i), c - (src.range.c1 + j)) : '';
        if (['values', 'valuesnum'].includes(what)) next.v = srcVal === null || srcVal === undefined ? '' : String(srcVal);
        if (what === 'all') { next.s = cell?.s; if (cell?.n) next.n = cell.n; }
        if (what === 'noborders') { const { bd, bc, ...rest } = cell?.s || {}; void bd; void bc; next.s = Object.keys(rest).length ? rest : undefined; }
        if (what === 'formats') next.s = cell?.s;
        if (['formulasnum', 'valuesnum'].includes(what)) next.s = { ...(ex?.s || {}), ...fmtOnly(cell?.s) };
        if (what === 'notes') { if (cell?.n) next.n = cell.n; else delete next.n; }
        if (what === 'validation') return; // handled below
        if (op && ['all', 'values', 'formulas', 'valuesnum', 'formulasnum', 'noborders'].includes(what)) { // Add / Subtract / Multiply / Divide into the existing values
          const a = Number(values[sh.name]?.[k]?.value ?? 0) || 0, b = Number(srcVal) || 0;
          const res = { add: a + b, sub: a - b, mul: a * b, div: b === 0 ? null : a / b }[op];
          next.v = res === null ? '#DIV/0!' : String(Number(res.toPrecision(15))); if (ex?.s) next.s = { ...ex.s, ...(next.s || {}) };
        }
        if (next.s && !Object.keys(next.s).length) delete next.s;
        if (next.v === '' && !next.s && !next.n && !next.l) delete sh.cells[k]; else sh.cells[k] = next;
      }));
      if (what === 'validation') { const from = wb.sheets.find((x) => x.id === src.sheetId); const rule = from && E.dvRuleAt(from, src.range.r1, src.range.c1); if (rule) sh.dv.push({ ...rule, range: E.rangeRef({ r1: at.r, c1: at.c, r2: at.r + (transpose ? W : H) - 1, c2: at.c + (transpose ? H : W) - 1 }) }); }
    });
  }
  function insertDelete(kind, isDelete) {
    if (kind === 'row') return isDelete ? deleteRows() : insertRows('above');
    if (kind === 'col') return isDelete ? deleteCols() : insertCols('left');
    commit(E.shiftCells(wb, si, range(), kind)); // shift cells down/right (insert) or up/left (delete)
    return null;
  }
  function setValidation(g, rule) {
    editSheet((sh) => {
      // remove this range from existing rules, then add the new one
      sh.dv = sh.dv.map((x) => ({ ...x, range: x.range.split(' ').filter((part) => { const pg = E.parseRange(part); return !(pg.r1 >= g.r1 && pg.r2 <= g.r2 && pg.c1 >= g.c1 && pg.c2 <= g.c2); }).join(' ') })).filter((x) => x.range);
      if (rule) sh.dv.push(rule);
    });
  }
  function setName(n, ref, replace = false) { const next = copyBook(); next.names = { ...(next.names || {}) }; if (replace) { const key = Object.keys(next.names).find((k) => k.toLowerCase() === n.toLowerCase()) || n; next.names[key] = ref; } else next.names[n] = ref; commit(next); }
  function deleteName(n) { const next = copyBook(); delete next.names[n]; commit(next); }
  function nameValue(n) { // as Excel's Name Manager shows it: a single value, or {a;b;c} for a range
    try {
      const ref = wb.names[n] || ''; const g = E.parseRange(ref.slice(ref.lastIndexOf('!') + 1).replace(/\$/g, ''));
      const tmp = copyBook(); const multi = g && (g.r2 > g.r1 || g.c2 > g.c1);
      tmp.sheets[0].cells.ZZ100000 = { v: multi ? `=TEXTJOIN(";",FALSE,${n})` : `=${n}` };
      const v = E.displayWorkbook(tmp)[tmp.sheets[0].name].ZZ100000?.text ?? '';
      return multi && !v.startsWith('#') ? `{${v}}` : v;
    } catch { return ''; }
  }
  function setLink(link, text) {
    editSheet((sh) => { const k = E.cellKey(active.r, active.c); const cur = sh.cells[k] || { v: '' }; const next = { ...cur }; if (link) next.l = link; else delete next.l; if (text !== null && text !== undefined && text !== '' && !String(cur.v).startsWith('=')) next.v = text; else if (link && !cur.v) next.v = link.replace(/^#/, '').replace(/^mailto:/, ''); sh.cells[k] = next; });
  }
  function followLink(link) {
    if (link.startsWith('#')) { navigate(link.slice(1)); return; }
    window.open(link, '_blank', 'noopener');
  }
  function editNote() {
    const k = E.cellKey(active.r, active.c); const cur = sheet().cells[k]?.n?.t || '';
    hidePop(); layout(); const pos = toView(active.r, active.c); const rc = rectOf({ r1: active.r, c1: active.c, r2: active.r, c2: active.c });
    const box = document.createElement('div'); box.className = 'xl-note editing'; box.style.left = `${pos.x + rc.w + 8}px`; box.style.top = `${pos.y}px`;
    const author = document.querySelector('[data-user-name]')?.dataset.userName || '';
    box.innerHTML = `<textarea aria-label="Note" spellcheck="true">${esc(cur)}</textarea>`; view.appendChild(box);
    const ta = box.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    noteEdit = { box, r: active.r, c: active.c };
    const done = (save) => { if (!noteEdit) return; const { r, c } = noteEdit; noteEdit = null; const t = ta.value; box.remove(); if (save && t !== cur) editSheet((sh) => { const key = E.cellKey(r, c); const cell = { ...(sh.cells[key] || { v: '' }) }; if (t.trim()) cell.n = { t, ...(author ? { a: author } : {}), d: new Date().toISOString().slice(0, 10) }; else delete cell.n; if (!cell.v && !cell.s && !cell.n && !cell.l) delete sh.cells[key]; else sh.cells[key] = cell; }); wrap.focus({ preventScroll: true }); };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(true); } e.stopPropagation(); });
    ta.addEventListener('blur', () => done(true));
  }
  function deleteNotes() { editSheet((sh) => { for (const g of ranges) for (const [k, cell] of Object.entries(sh.cells)) { const p = E.parseKey(k); if (p.row >= g.r1 && p.row <= g.r2 && p.col >= g.c1 && p.col <= g.c2 && cell.n) { const n = { ...cell }; delete n.n; if (!n.v && !n.s && !n.l) delete sh.cells[k]; else sh.cells[k] = n; } } }); }
  function noteStep(dir) { const list = Object.entries(sheet().cells).filter(([, c]) => c.n).map(([k]) => E.parseKey(k)).sort((a, b) => a.row - b.row || a.col - b.col); if (!list.length) { toast('There are no notes on this sheet'); return; } let i = list.findIndex((p) => p.row > active.r || (p.row === active.r && p.col > active.c)); if (dir < 0) { i = -1; for (let j = list.length - 1; j >= 0; j--) if (list[j].row < active.r || (list[j].row === active.r && list[j].col < active.c)) { i = j; break; } } if (i < 0) i = dir > 0 ? 0 : list.length - 1; setActive(list[i].row, list[i].col); const n = sheet().cells[E.cellKey(list[i].row, list[i].col)].n; showPopAt(list[i].row, list[i].col, esc(n.t), 'note'); }
  function openDropdown() {
    const rule = E.dvRuleAt(sheet(), active.r, active.c); if (rule?.type !== 'list') return;
    const items = E.dvListItems(rule, wb, sheet().name); if (!items.length) return;
    layout(); const pos = toView(active.r, active.c); const rc = rectOf({ r1: active.r, c1: active.c, r2: active.r, c2: active.c }); const b = view.getBoundingClientRect();
    const pseudo = { getBoundingClientRect: () => ({ left: b.left + pos.x, right: b.left + pos.x + rc.w, top: b.top + pos.y, bottom: b.top + pos.y + rc.h, width: rc.w, height: rc.h }) };
    openMenu(pseudo, items.map((it) => ({ label: it, run: () => editSheet((sh) => { const k = E.cellKey(active.r, active.c); sh.cells[k] = { ...(sh.cells[k] || {}), v: it }; }) })), { align: 'start' });
  }
  const dialogs = createDialogs({
    sheet, wb: () => wb, active: () => active, range, shown: () => shown, clip: () => clip, styleSel, pasteSpecial,
    insertDelete,
    sortTarget: () => { const g = range(); return g.r2 > g.r1 && !fullCols(g) ? clampToUsed(g) : currentRegion(); },
    sortRange: (g, keys, header) => editSheet((sh) => Object.assign(sh, E.sortRange(sh, values[sh.name] || {}, g, keys, header))),
    removeDuplicates: (g, cols, header) => { let res = null; editSheet((sh) => { res = E.removeDuplicates(sh, values[sh.name] || {}, g, cols, header); Object.assign(sh, res.sheet); }); toast(res.removed ? `${res.removed} duplicate value${res.removed === 1 ? '' : 's'} found and removed; ${res.kept} unique value${res.kept === 1 ? '' : 's'} remain.` : 'No duplicate values found.'); },
    textToColumns: (g, opts) => editSheet((sh) => Object.assign(sh, E.textToColumns(sh, g, opts).sheet)),
    setValidation, setName, deleteName, nameValue, setLink,
    setTabColor: (i, c) => editSheet((sh, book) => { book.sheets[i].tab = c; }),
    tableTarget: () => { const g = range(); return g.r1 === g.r2 && g.c1 === g.c2 ? currentRegion() : clampToUsed(g); },
    createTable, updateTable, createPivot, goalSeek: goalSeekRun, setProtect, unhideSheet, updateChart,
  });

  /* =================== Phase 3: tables, PivotTables, charts, Goal Seek, auditing, sheets, page layout =================== */
  const q = (n) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n}'`);
  const allTables = () => wb.sheets.flatMap((x) => x.tables || []);
  const freeName = (base, taken) => { let n = 1; while (taken.some((t) => t.toLowerCase() === `${base}${n}`.toLowerCase())) n++; return `${base}${n}`; };
  function createTable(g, header) {
    if (blocked('structure')) return;
    if ((sheet().tables || []).some((t) => { const tg = E.parseRange(t.range); return tg.r1 <= g.r2 && tg.r2 >= g.r1 && tg.c1 <= g.c2 && tg.c2 >= g.c1; })) { toast('A table can’t overlap another table.', { tone: 'error' }); return; }
    let next = copyBook(); let rg = { ...g };
    if (!header) { next = E.shiftCells(next, si, { r1: g.r1, c1: g.c1, r2: g.r1, c2: g.c2 }, 'down'); rg = { ...g, r2: g.r2 + 1 }; for (let c = g.c1; c <= g.c2; c++) next.sheets[si].cells[E.cellKey(g.r1, c)] = { v: `Column${c - g.c1 + 1}` }; }
    const name = freeName('Table', [...allTables().map((t) => t.name), ...Object.keys(wb.names || {})]);
    const sh = next.sheets[si];
    sh.tables.push({ name, range: E.rangeRef(rg), style: 'medium2', header: true, total: false, banded: true, filterBtn: true });
    if (!sh.filter) sh.filter = { range: E.rangeRef(rg), crit: {} };
    commit(next); toast(`Created ${name}`);
  }
  const TOTAL_FN = { sum: 109, average: 101, count: 103, counta: 103, max: 104, min: 105 };
  const totalFormula = (fn, t, col) => (fn && fn !== 'none' ? `=SUBTOTAL(${TOTAL_FN[fn]},${t}[${col}])` : '');
  function updateTable(name, patch) {
    const next = copyBook(); const sh = next.sheets[si]; const t = sh.tables.find((x) => x.name === name); if (!t) return;
    if (patch.name !== undefined && patch.name !== t.name) {
      const nn = patch.name.trim(); if (!E.isValidName(nn) || [...allTables().map((x) => x.name), ...Object.keys(wb.names || {})].some((x) => x.toLowerCase() === nn.toLowerCase())) { toast('That table name isn’t valid or is already used.', { tone: 'error' }); syncRibbon(); return; }
      const re = new RegExp(`(^|[^\\w.])${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[`, 'gi');
      for (const x of next.sheets) for (const [k, cell] of Object.entries(x.cells)) if (String(cell.v).startsWith('=')) x.cells[k] = { ...cell, v: String(cell.v).split('"').map((part, i) => (i % 2 ? part : part.replace(re, (m, pre) => `${pre}${nn}[`))).join('"') };
      t.name = nn;
    }
    const g = E.parseRange(t.range);
    if (patch.total !== undefined && patch.total !== t.total) {
      const cols = E.tableColumns(sh, t);
      if (patch.total) { const tr = g.r2 + 1; sh.cells[E.cellKey(tr, g.c1)] = { v: 'Total' }; t.totals = { [g.c2 - g.c1]: 'sum' }; sh.cells[E.cellKey(tr, g.c2)] = { v: totalFormula('sum', t.name, cols[cols.length - 1]) }; g.r2 = tr; }
      else { for (let c = g.c1; c <= g.c2; c++) delete sh.cells[E.cellKey(g.r2, c)]; g.r2 -= 1; t.totals = {}; }
      t.total = patch.total;
    }
    if (patch.range) Object.assign(g, E.parseRange(patch.range));
    for (const k of ['style', 'banded', 'bandedCols', 'firstCol', 'lastCol']) if (patch[k] !== undefined) t[k] = patch[k];
    if (patch.filterBtn !== undefined) { t.filterBtn = patch.filterBtn; if (patch.filterBtn && !sh.filter) sh.filter = { range: E.rangeRef(g), crit: {} }; if (!patch.filterBtn && sh.filter?.range === t.range) sh.filter = null; }
    if (sh.filter && sh.filter.range === t.range) sh.filter.range = E.rangeRef(g);
    t.range = E.rangeRef(g);
    commit(next);
  }
  function convertToRange(name) {
    const next = copyBook(); const sh = next.sheets[si]; const t = sh.tables.find((x) => x.name === name); if (!t) return;
    const g = E.parseRange(t.range);
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const k = E.cellKey(r, c); const look = withTable(sh, r, c, sh.cells[k]?.s); if (look && Object.keys(look).length) sh.cells[k] = { ...(sh.cells[k] || { v: '' }), s: look }; }
    for (const x of next.sheets) for (const [k, cell] of Object.entries(x.cells)) if (String(cell.v).startsWith('=') && new RegExp(`${t.name}\\[|\\[@`, 'i').test(cell.v)) { const p = E.parseKey(k); x.cells[k] = { ...cell, v: `=${E.expandStructured(String(cell.v).slice(1), next, x, p.row)}` }; }
    sh.tables = sh.tables.filter((x) => x.name !== name); if (sh.filter?.range === t.range) sh.filter = null;
    commit(next);
  }
  /** As in Excel: typing next to a table extends it; a formula in an empty table column fills the column. */
  function tableAfterEdit(sh, r, c, v) {
    for (const t of sh.tables || []) {
      const g = E.parseRange(t.range); const P = E.tableParts(t);
      if (!t.total && r === g.r2 + 1 && c >= g.c1 && c <= g.c2 && v !== '') { g.r2 += 1; t.range = E.rangeRef(g); if (sh.filter?.range && E.parseRange(sh.filter.range).r1 === g.r1) sh.filter.range = t.range; }
      else if (c === g.c2 + 1 && r >= g.r1 && r <= g.r2 && v !== '') { g.c2 += 1; if (t.header && r !== g.r1 && !sh.cells[E.cellKey(g.r1, c)]) sh.cells[E.cellKey(g.r1, c)] = { v: `Column${g.c2 - g.c1 + 1}` }; t.range = E.rangeRef(g); if (sh.filter?.range && E.parseRange(sh.filter.range).r1 === g.r1) sh.filter.range = t.range; }
      else if (String(v).startsWith('=') && r >= P.d1 && r <= P.d2 && c >= g.c1 && c <= g.c2) {
        let empty = true; for (let rr = P.d1; rr <= P.d2; rr++) if (rr !== r && (sh.cells[E.cellKey(rr, c)]?.v ?? '') !== '') { empty = false; break; }
        if (empty) for (let rr = P.d1; rr <= P.d2; rr++) if (rr !== r) sh.cells[E.cellKey(rr, c)] = { ...(sh.cells[E.cellKey(rr, c)] || {}), v: E.shiftRefs(v, rr - r, 0) };
      }
    }
  }
  function createPivot(src, at) {
    if (blocked('structure')) return;
    const next = copyBook(); let target = si; let cell = at;
    if (!at) { let n = next.sheets.length + 1; while (next.sheets.some((x) => x.name.toLowerCase() === `sheet${n}`)) n++; next.sheets.splice(si + 1, 0, E.emptySheet(undefined, undefined, `Sheet${n}`)); target = si + 1; cell = 'A3'; }
    const name = freeName('PivotTable', next.sheets.flatMap((x) => x.pivots || []).map((p) => p.name));
    const id = `pv${Date.now().toString(36)}`;
    next.sheets[target].pivots.push({ id, name, src, at: cell, rows: [], cols: [], vals: [], filters: {}, grand: true });
    const done = E.refreshPivot(next, target, id);
    si = target; const pos = E.parseKey(cell); active = { r: pos.row, c: pos.col }; anchor = { ...active }; ranges = [{ r1: pos.row, c1: pos.col, r2: pos.row, c2: pos.col }]; pivotPanel = true;
    commit(done);
  }
  const pivotHere = () => { for (const pv of sheet().pivots || []) { const g = E.parseRange(pv.out || pv.at); if (g && active.r >= g.r1 && active.r <= g.r2 && active.c >= g.c1 && active.c <= g.c2) return pv; } return null; };
  function updatePivot(id, fn) { const next = copyBook(); const pv = next.sheets[si].pivots.find((x) => x.id === id); if (!pv) return; fn(pv); commit(E.refreshPivot(next, si, id)); }
  function refreshAllPivots() { let next = copyBook(); next.sheets.forEach((x, i) => { for (const pv of x.pivots || []) next = E.refreshPivot(next, i, pv.id); }); commit(next); toast('PivotTables refreshed'); }
  const pivotPanelEl = document.createElement('aside'); pivotPanelEl.className = 'xl-pivot'; pivotPanelEl.hidden = true; root.appendChild(pivotPanelEl);
  function drawPivotPanel() {
    const pv = editable ? pivotHere() : null;
    if (!pv || !pivotPanel) { pivotPanelEl.hidden = true; root.classList.remove('with-pivot'); return; }
    const src = E.pivotSource(wb, pv.src); const fields = src?.fields || [];
    const areaOf = (f) => (pv.rows.includes(f) ? 'rows' : pv.cols.includes(f) ? 'cols' : pv.vals.some((v) => v.f === f) ? 'vals' : f in (pv.filters || {}) ? 'filters' : '');
    const item = (f, area, fn) => `<div class="xp-item"><span>${esc(area === 'vals' ? `${{ sum: 'Sum', count: 'Count', average: 'Average', max: 'Max', min: 'Min' }[fn]} of ${f}` : f)}</span>${area === 'vals' ? `<select data-pfn="${esc(f)}" aria-label="Summarize ${esc(f)} by">${['sum', 'count', 'average', 'max', 'min'].map((x) => `<option value="${x}" ${x === fn ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select>` : ''}${area === 'filters' ? `<button type="button" class="btn btn-plain btn-sm" data-pfilter="${esc(f)}">Values…</button>` : ''}<select data-pmove="${esc(f)}" data-from="${area}" aria-label="Move ${esc(f)}"><option value="">Move…</option><option value="filters">Filters</option><option value="cols">Columns</option><option value="rows">Rows</option><option value="vals">Values</option><option value="remove">Remove</option></select></div>`;
    pivotPanelEl.innerHTML = `<header><b>PivotTable Fields</b><button type="button" class="tb-btn" data-pclose aria-label="Close">${icon('x', { size: 15 })}</button></header>
      <div class="xp-fields">${fields.map((f) => `<label class="xl-check"><input type="checkbox" data-pfield="${esc(f)}" ${areaOf(f) ? 'checked' : ''}> ${esc(f)}</label>`).join('')}</div>
      ${[['filters', 'Filters', Object.keys(pv.filters || {})], ['cols', 'Columns', pv.cols], ['rows', 'Rows', pv.rows], ['vals', 'Values', pv.vals]].map(([k, l, list]) => `<div class="xp-area"><div class="menu-label">${l}</div>${list.map((x) => (k === 'vals' ? item(x.f, 'vals', x.fn) : item(x, k))).join('') || '<p class="muted">Choose a field above, or move one here.</p>'}</div>`).join('')}
      <footer><label class="xl-check"><input type="checkbox" data-pgrand ${pv.grand ? 'checked' : ''}> Grand totals</label><button type="button" class="btn btn-plain btn-sm" data-prefresh>Refresh</button></footer>`;
    pivotPanelEl.hidden = false; root.classList.add('with-pivot');
    pivotPanelEl.style.top = `${wrap.offsetTop}px`; pivotPanelEl.style.height = `${wrap.offsetHeight}px`; // beside the grid
    pivotPanelEl.dataset.id = pv.id;
  }
  pivotPanelEl.addEventListener('change', (e) => {
    const id = pivotPanelEl.dataset.id; const t = e.target;
    if (t.dataset.pfield !== undefined) { const f = t.dataset.pfield; const src = E.pivotSource(wb, sheet().pivots.find((x) => x.id === id)?.src || ''); const numeric = src?.rows.some((r) => typeof r[f] === 'number');
      updatePivot(id, (pv) => { if (t.checked) { if (numeric) pv.vals.push({ f, fn: 'sum' }); else pv.rows.push(f); } else { pv.rows = pv.rows.filter((x) => x !== f); pv.cols = pv.cols.filter((x) => x !== f); pv.vals = pv.vals.filter((x) => x.f !== f); delete pv.filters[f]; } }); }
    if (t.dataset.pfn) updatePivot(id, (pv) => { const v = pv.vals.find((x) => x.f === t.dataset.pfn); if (v) v.fn = t.value; });
    if (t.dataset.pmove && t.value) { const f = t.dataset.pmove, from = t.dataset.from, to = t.value; updatePivot(id, (pv) => {
      const fn = pv.vals.find((x) => x.f === f)?.fn || 'sum';
      if (from === 'rows') pv.rows = pv.rows.filter((x) => x !== f); if (from === 'cols') pv.cols = pv.cols.filter((x) => x !== f); if (from === 'vals') pv.vals = pv.vals.filter((x) => x.f !== f); if (from === 'filters') delete pv.filters[f];
      if (to === 'rows') pv.rows.push(f); if (to === 'cols') pv.cols.push(f); if (to === 'vals') pv.vals.push({ f, fn: from === 'vals' ? fn : (to === 'vals' ? 'count' : fn) }); if (to === 'filters') pv.filters[f] = null; }); }
    if (t.dataset.pgrand !== undefined) updatePivot(id, (pv) => { pv.grand = t.checked; });
  });
  pivotPanelEl.addEventListener('click', (e) => {
    const id = pivotPanelEl.dataset.id;
    if (e.target.closest('[data-pclose]')) { pivotPanel = false; drawPivotPanel(); return; }
    if (e.target.closest('[data-prefresh]')) { updatePivot(id, () => {}); return; }
    const fb = e.target.closest('[data-pfilter]');
    if (fb) { const f = fb.dataset.pfilter; const pv = sheet().pivots.find((x) => x.id === id); const src = E.pivotSource(wb, pv.src); const vals = [...new Set(src.rows.map((r) => String(r[f] ?? '(blank)')))].sort(); const cur = pv.filters[f];
      let chosen = null;
      openModal({ title: `Filter: ${f}`, body: `<form class="form" id="xl-pf">${vals.map((v) => `<label class="xl-check"><input type="checkbox" value="${esc(v)}" ${!cur || cur.includes(v) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</form>`, footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="xl-pf">OK</button>',
        onMount: (el, close) => el.querySelector('#xl-pf').addEventListener('submit', (ev) => { ev.preventDefault(); chosen = [...ev.target.querySelectorAll('input:checked')].map((x) => x.value); close(); }),
        onClose: () => setTimeout(() => { if (chosen) updatePivot(id, (p) => { p.filters[f] = chosen.length === vals.length ? null : chosen; }); }, 30) }); }
  });
  function insertChart(t) {
    if (blocked('structure')) return;
    const g = range(); const src = g.r1 === g.r2 && g.c1 === g.c2 ? currentRegion() : clampToUsed(g);
    if (src.r1 === src.r2 && src.c1 === src.c2) { toast('Select the data for the chart first.', { tone: 'error' }); return; }
    const id = `ch${Date.now().toString(36)}`;
    const x = Math.round(G.colL(src.c2 + 1) / zoom) + 16, y = Math.round(G.rowT(src.r1) / zoom);
    editSheet((sh) => { sh.charts.push({ id, t, range: E.rangeRef(src), title: E.tableAt(sh, src.r1, src.c1)?.name ? '' : '', x, y, w: 480, h: 288, legend: true, byRow: false }); });
    selChart = id; render(); syncRibbon();
  }
  function updateChart(id, patch) { editSheet((sh) => { const ch = sh.charts.find((x) => x.id === id); if (ch) Object.assign(ch, patch); }); }
  function goalSeekRun(set, to, by) {
    const res = E.goalSeek(wb, sheet().name, set, to, by);
    let keep = false;
    openModal({ title: 'Goal Seek Status', body: `<p>${res.ok ? `Goal Seeking with Cell ${set} found a solution.` : `Goal Seeking with Cell ${set} may not have found a solution.`}</p><p class="muted">Target value: ${esc(String(to))}<br>Current value: ${esc(Number.isFinite(res.result) ? String(Number(res.result.toPrecision(10))) : '#N/A')}<br>${esc(by)} = ${esc(String(res.value))}</p>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-keep>OK</button>',
      onMount: (el, close) => el.querySelector('[data-keep]').addEventListener('click', () => { keep = true; close(); }),
      onClose: () => setTimeout(() => { if (keep && res.ok !== undefined) editSheet((sh) => { sh.cells[by] = { ...(sh.cells[by] || {}), v: String(res.value) }; }); wrap.focus({ preventScroll: true }); }, 30) });
  }
  function trace(kind) {
    const k = E.cellKey(active.r, active.c);
    if (kind === 'pre') {
      const list = E.precedents(wb, sheet(), k);
      if (!list.length) { toast('This cell doesn’t refer to other cells.'); return; }
      const off = list.filter((x) => x.sheet.toLowerCase() !== sheet().name.toLowerCase()).length;
      for (const x of list) if (x.sheet.toLowerCase() === sheet().name.toLowerCase()) arrows.push({ from: x.g, to: { r1: active.r, c1: active.c, r2: active.r, c2: active.c } });
      if (off) toast(`${off} reference${off === 1 ? ' is' : 's are'} on another sheet.`);
    } else {
      const list = E.dependents(wb, sheet(), k);
      if (!list.length) { toast('No formulas refer to this cell.'); return; }
      for (const x of list) if (x.sheet === sheet().name) { const p = E.parseKey(x.key); arrows.push({ from: { r1: active.r, c1: active.c, r2: active.r, c2: active.c }, to: { r1: p.row, c1: p.col, r2: p.row, c2: p.col } }); }
    }
    render();
  }
  const ERR_HELP = { '#DIV/0!': 'Divide by Zero Error: the formula or function divides by zero or an empty cell.', '#N/A': 'Value Not Available Error: a value isn’t available to the formula or function (for example a lookup that found nothing).', '#NAME?': 'Invalid Name Error: the formula contains unrecognised text (a misspelt function or name).', '#REF!': 'Invalid Cell Reference Error: the formula refers to cells that were deleted.', '#VALUE!': 'Error in Value: a value is the wrong type (for example text where a number is needed).', '#NUM!': 'Invalid Number Error: a number is too large, too small or not valid for the function.', '#SPILL!': 'Spill range isn’t blank: cells where the results should go contain data.', '#CYCLE!': 'Circular Reference: the formula refers to its own cell, directly or indirectly.', '#CALC!': 'Calculation Error: for example FILTER found nothing and no "if empty" value was given.' };
  function errorChecking() {
    const list = Object.entries(sheet().cells).filter(([k, cell]) => errFlag(cell, shown[k], E.styleAt(sheet(), E.parseKey(k).row, E.parseKey(k).col))).map(([k]) => E.parseKey(k)).sort((a, b) => a.row - b.row || a.col - b.col);
    if (!list.length) { toast('The error check of the entire sheet is complete.'); return; }
    const nx = list.find((p) => p.row > active.r || (p.row === active.r && p.col > active.c)) || list[0];
    setActive(nx.row, nx.col); errMenu();
  }
  function errMenu() {
    const k = E.cellKey(active.r, active.c); const cell = sheet().cells[k]; const kind = errFlag(cell, shown[k], E.styleAt(sheet(), active.r, active.c)); if (!kind) return;
    layout(); const pos = toView(active.r, active.c); const b = view.getBoundingClientRect();
    const pseudo = { getBoundingClientRect: () => ({ left: b.left + pos.x - 18, right: b.left + pos.x, top: b.top + pos.y, bottom: b.top + pos.y + 20, width: 18, height: 20 }) };
    const items = kind === 'text'
      ? [{ label: 'Number Stored as Text', run: () => {} }, 'divider', { label: 'Convert to Number', run: () => editSheet((sh) => { const c0 = sh.cells[k]; const v = String(c0.v).replace(/^'/, '').trim(); const s0 = { ...(c0.s || {}) }; if (s0.f === 'text') delete s0.f; sh.cells[k] = { ...c0, v, ...(Object.keys(s0).length ? { s: s0 } : { s: undefined }) }; if (!Object.keys(s0).length) delete sh.cells[k].s; }) }]
      : [{ label: ERR_HELP[shown[k]?.text] || 'This formula returns an error.', run: () => {} }, 'divider', { label: 'Trace Precedents', run: () => trace('pre') }, { label: 'Edit in Formula Bar', run: () => fbar.focus() }];
    items.push({ label: 'Ignore Error', run: () => editSheet((sh) => { sh.cells[k] = { ...sh.cells[k], ig: 1 }; }) });
    openMenu(pseudo, items, { align: 'start' });
  }
  function setProtect(pr) { const next = copyBook(); if (pr) next.sheets[si].protect = pr; else delete next.sheets[si].protect; commit(next); toast(pr ? 'Sheet protected' : 'Sheet unprotected'); }
  function hideSheet(i) { if (wb.sheets.filter((x) => !x.hidden).length <= 1) { toast('A workbook must contain at least one visible worksheet.', { tone: 'error' }); return; } const next = copyBook(); next.sheets[i].hidden = true; const vis = next.sheets.findIndex((x, j) => !x.hidden && j !== i); si = vis; commit(next); }
  function unhideSheet(i) { const next = copyBook(); delete next.sheets[i].hidden; si = i; commit(next); }
  function printSetting(patch) { editSheet((sh) => { sh.print = { ...sh.print, ...patch }; for (const k of Object.keys(sh.print)) if (sh.print[k] === undefined || sh.print[k] === null) delete sh.print[k]; }); }
  function pageSetupCmd(patch, label) { if (!pageSetup) { toast('This spreadsheet is inside a document: set the paper and margins in the document’s ⋯ menu → Page setup.'); return; } pageSetup(patch); toast(label); }
  /* chart selection, moving and resizing */
  view.addEventListener('mousedown', (e) => {
    const chEl = e.target.closest('.xchart'); if (!chEl || e.button === 2) { if (selChart && !e.target.closest('.xchart')) { selChart = null; render(); syncRibbon(); } return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (editing) finishEdit(true);
    selChart = chEl.dataset.chart; render(); syncRibbon(); wrap.focus({ preventScroll: true });
    if (!editable || sheet().protect) return;
    const ch = sheet().charts.find((x) => x.id === selChart); if (!ch) return;
    const handle = e.target.closest('[data-chandle]')?.dataset.chandle; const sx = e.clientX, sy = e.clientY; const o = { ...ch };
    const move = (ev) => {
      const dx = (ev.clientX - sx) / zoom, dy = (ev.clientY - sy) / zoom; const nc = { ...o };
      if (!handle) { nc.x = Math.max(0, Math.round(o.x + dx)); nc.y = Math.max(0, Math.round(o.y + dy)); }
      else { if (handle.includes('e')) nc.w = Math.max(160, Math.round(o.w + dx)); if (handle.includes('s')) nc.h = Math.max(110, Math.round(o.h + dy)); if (handle.includes('w')) { nc.w = Math.max(160, Math.round(o.w - dx)); nc.x = o.x + (o.w - nc.w); } if (handle.includes('n')) { nc.h = Math.max(110, Math.round(o.h - dy)); nc.y = o.y + (o.h - nc.h); } }
      Object.assign(ch, nc); const elx = view.querySelectorAll(`.xchart[data-chart="${ch.id}"]`); elx.forEach((x) => { x.style.left = `${parseFloat(x.style.left) + (nc.x - (x._lx ?? o.x)) * zoom}px`; x.style.top = `${parseFloat(x.style.top) + (nc.y - (x._ly ?? o.y)) * zoom}px`; x._lx = nc.x; x._ly = nc.y; if (handle) { x.style.width = `${nc.w * zoom}px`; x.style.height = `${nc.h * zoom}px`; } });
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); const nc = { x: ch.x, y: ch.y, w: ch.w, h: ch.h }; Object.assign(ch, o); if (nc.x !== o.x || nc.y !== o.y || nc.w !== o.w || nc.h !== o.h) updateChart(ch.id, nc); else render(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }, true);
  view.addEventListener('dblclick', (e) => { const chEl = e.target.closest('.xchart'); if (chEl && editable) { e.stopImmediatePropagation(); dialogs.chartOptions(sheet().charts.find((x) => x.id === chEl.dataset.chart)); } }, true);
  view.addEventListener('click', (e) => {
    if (e.target.closest('[data-totaldrop]')) { e.stopPropagation(); const t = E.tableAt(sheet(), active.r, active.c); const col = E.tableColumns(sheet(), t)[active.c - E.parseRange(t.range).c1]; const b = e.target.closest('[data-totaldrop]');
      openMenu(b, [['none', 'None'], ['average', 'Average'], ['counta', 'Count'], ['count', 'Count Numbers'], ['max', 'Max'], ['min', 'Min'], ['sum', 'Sum']].map(([fn, l]) => ({ label: l, run: () => editSheet((sh) => { const tt = sh.tables.find((x) => x.name === t.name); tt.totals = { ...tt.totals, [active.c - E.parseRange(tt.range).c1]: fn }; const k = E.cellKey(active.r, active.c); const v = fn === 'count' ? `=SUBTOTAL(102,${t.name}[${col}])` : totalFormula(fn, t.name, col); if (v) sh.cells[k] = { ...(sh.cells[k] || {}), v }; else delete sh.cells[k]; }) })), { align: 'start' }); }
    if (e.target.closest('[data-errtag]')) { e.stopPropagation(); errMenu(); }
  });

  /* =================== Zoom =================== */
  function setZoom(z) { zoom = Math.max(0.5, Math.min(2, Math.round(z * 100) / 100)); buildGeo(); ensureVisible(active.r, active.c); render(); syncChrome(); }
  root.querySelector('.xl-zoom').addEventListener('click', (e) => { const b = e.target.closest('[data-zoom]'); if (b) setZoom(zoom + (b.dataset.zoom === '+' ? 0.1 : -0.1)); });
  zoomRange.addEventListener('input', () => setZoom(Number(zoomRange.value) / 100));
  function zoomMenu(anchorEl) { openMenu(anchorEl, [50, 75, 100, 125, 150, 200].map((p) => ({ label: `${p}%`, run: () => setZoom(p / 100) })).concat(['divider', { label: 'Zoom to Selection', run: zoomToSelection }]), { align: 'start' }); }
  function zoomToSelection() { const g = clampToUsed(range()); const w = (G.colL(g.c2 + 1) - G.colL(g.c1)) / zoom, h = (G.rowT(g.r2 + 1) - G.rowT(g.r1)) / zoom; setZoom(Math.min((L.vw - L.HW - 20) / w, (L.vh - L.HH - 20) / h, 2)); wrap.scrollLeft = G.colL(g.c1) - L.FW; wrap.scrollTop = G.rowT(g.r1) - L.FH; render(); }

  /* =================== Ribbon commands =================== */
  root.querySelector('.ribbon')?.addEventListener('mousedown', (e) => { if (e.target.closest('button') && editing?.from === 'cell') e.preventDefault(); });
  root.querySelector('.ribbon')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-rbtab]');
    if (tab) { if (tab.getAttribute('aria-expanded') === 'true') closeToolCard(); else openToolCard(tab); return; }
    const b = e.target.closest('button[data-cmd]'); if (!b) return;
    const inCard = !!b.closest('.rb-pop');
    run(b.dataset.cmd, b);
    if (inCard && !b.hasAttribute('aria-haspopup')) closeToolCard(); // a command was chosen (menus close the card when an item is picked)
  });
  /* Drop-down cards (Format, Insert, Page Layout …): each opens the full set of tools for that area under its button. */
  const toolCard = root.querySelector('.rb-pop');
  function openToolCard(tab) {
    if (!toolCard) return;
    root.querySelectorAll('.rb-tab').forEach((t) => { t.setAttribute('aria-expanded', String(t === tab)); t.classList.toggle('on', t === tab); });
    toolCard.querySelectorAll('.rb-panel').forEach((p) => { p.hidden = p.dataset.rbpanel !== tab.dataset.rbtab; });
    toolCard.setAttribute('aria-label', `${tab.textContent.trim()} tools`);
    toolCard.hidden = false;
    const host = root.querySelector('.ribbon').getBoundingClientRect(), tr = tab.getBoundingClientRect();
    toolCard.style.top = `${Math.round(tr.bottom - host.top + 6)}px`;
    const w = toolCard.offsetWidth; let left = tr.right - host.left - w; // right edge under the button, kept inside
    if (left < 0) left = Math.min(tr.left - host.left, host.width - w);
    toolCard.style.left = `${Math.max(0, Math.round(left))}px`;
  }
  closeToolCard = (focusBack = false) => {
    if (!toolCard || toolCard.hidden) return;
    const tab = root.querySelector('.rb-tab[aria-expanded="true"]');
    toolCard.hidden = true;
    root.querySelectorAll('.rb-tab').forEach((t) => { t.setAttribute('aria-expanded', 'false'); t.classList.remove('on'); });
    if (focusBack) tab?.focus();
  };
  toolCard?.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeToolCard(true); } });
  const onOutside = (e) => {
    if (!root.isConnected) { document.removeEventListener('pointerdown', onOutside, true); return; }
    if (toolCard?.hidden || e.target.closest?.('.rb-pop, .rb-tab, .menu, .modal')) return;
    closeToolCard();
  };
  document.addEventListener('pointerdown', onOutside, true);
  root.querySelector('.ribbon')?.addEventListener('dblclick', (e) => { const b = e.target.closest('[data-cmd="painter"]'); if (b) { painter = null; startPainter(true); } });
  root.querySelector('.ribbon')?.addEventListener('change', (e) => {
    const t = e.target; const cmd = t.dataset.cmd || '';
    if (cmd === 'font') styleSel((s) => ({ ...s, ff: t.value || undefined }));
    if (cmd === 'size') styleSel((s) => ({ ...s, fz: Number(t.value) === 11 ? undefined : Number(t.value) }));
    if (cmd === 'numfmt') styleSel((s) => ({ ...s, f: t.value === 'general' ? undefined : t.value, dp: undefined }));
    if (cmd === 'toggle-grid') editSheet((s) => { s.view = { ...s.view, grid: t.checked ? undefined : false }; });
    if (cmd === 'toggle-heads') editSheet((s) => { s.view = { ...s.view, heads: t.checked ? undefined : false }; });
    if (cmd === 'toggle-fbar') { root.classList.toggle('no-fbar', !t.checked); schedule(); }
    if (cmd === 'print-grid') printSetting({ grid: t.checked ? undefined : false });
    if (cmd === 'print-heads') printSetting({ heads: t.checked || undefined });
    if (t.dataset.tblopt) { const tb = E.tableAt(sheet(), active.r, active.c); if (tb) updateTable(tb.name, { [t.dataset.tblopt]: t.checked }); }
    if (t.classList.contains('rb-tblname')) { const tb = E.tableAt(sheet(), active.r, active.c); if (tb) updateTable(tb.name, { name: t.value }); }
    if (t.dataset.color) { const which = t.dataset.color; root.querySelector(`[data-swatch="${which}"]`).style.background = t.value; if (which === 'fill') styleSel((s) => ({ ...s, bg: t.value })); else styleSel((s) => ({ ...s, fg: t.value })); }
    if (!['toggle-fbar'].includes(cmd)) wrap.focus({ preventScroll: true });
  });
  root.querySelector('.xl-fx').addEventListener('click', () => insertFunctionDialog());
  zoomPct.addEventListener('click', () => zoomMenu(zoomPct));
  const swatch = (which) => root.querySelector(`[data-color="${which}"]`)?.value;
  async function run(cmd, el) {
    if (editing && !['insert-function', 'autosum'].includes(cmd) && !cmd.startsWith('fncat:')) finishEdit(true);
    const g = range();
    const menu = (items) => openMenu(el, items, { align: 'start' });
    switch (cmd) {
      case 'import': root.querySelector('.xl-file')?.click(); break;
      case 'export-xlsx': exportAs('xlsx'); break;
      case 'export-csv': exportAs('csv'); break;
      case 'paste': menu([{ label: 'Paste', run: () => clipboardCmd('all') }, { label: 'Paste Values', run: () => clipboardCmd('values') }, { label: 'Paste Formulas', run: () => clipboardCmd('formulas') }, { label: 'Paste Formatting', run: () => clipboardCmd('formats') }, { label: 'Transpose', run: () => clipboardCmd('transpose') }, 'divider', { label: 'Paste Special…', run: () => dialogs.pasteSpecial() }]); break;
      case 'strike': toggle('st'); break;
      case 'insert-table': if (E.tableAt(sheet(), active.r, active.c)) toast('This cell is already in a table.'); else dialogs.createTable(); break;
      case 'insert-pivot': dialogs.createPivot(); break;
      case 'insert-chart': menu([['column', 'Clustered Column'], ['bar', 'Clustered Bar'], ['line', 'Line'], ['pie', 'Pie']].map(([t, l]) => ({ label: l, run: () => insertChart(t) }))); break;
      case 'tbl-styles': { const t = E.tableAt(sheet(), active.r, active.c); if (t) menu(TABLE_STYLES.map((st) => ({ label: `${st.replace(/(\d+)/, ' $1').replace(/^./, (x) => x.toUpperCase())}`, run: () => updateTable(t.name, { style: st }) }))); break; }
      case 'tbl-resize': { const t = E.tableAt(sheet(), active.r, active.c); if (t) dialogs.resizeTable(t); break; }
      case 'tbl-convert': { const t = E.tableAt(sheet(), active.r, active.c); if (t && await confirmDialog({ title: 'Convert to Range', message: 'Do you want to convert the table to a normal range? The formatting is kept; references to the table become ordinary cell references.', confirmLabel: 'Yes', tone: 'primary' })) convertToRange(t.name); break; }
      case 'pv-refresh': { const pv = pivotHere(); if (pv) updatePivot(pv.id, () => {}); break; }
      case 'pv-refresh-all': refreshAllPivots(); break;
      case 'pv-fields': pivotPanel = !pivotPanel; drawPivotPanel(); break;
      case 'pv-source': { const pv = pivotHere(); if (!pv) break; const v = await ask('Change PivotTable Data Source', 'Table/Range', pv.src); if (v) { if (!E.pivotSource(wb, v.replace(/\$/g, ''))) toast('The source data reference isn’t valid.', { tone: 'error' }); else updatePivot(pv.id, (p) => { p.src = v.replace(/\$/g, ''); }); } break; }
      case 'pv-delete': { const pv = pivotHere(); if (!pv) break; editSheet((sh) => { const g = pv.out && E.parseRange(pv.out); if (g) for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) delete sh.cells[E.cellKey(r, c)]; sh.pivots = sh.pivots.filter((x) => x.id !== pv.id); }); break; }
      case 'ch-type': { const ch = sheet().charts.find((x) => x.id === selChart); if (ch) menu([['column', 'Clustered Column'], ['bar', 'Clustered Bar'], ['line', 'Line'], ['pie', 'Pie']].map(([t, l]) => ({ label: l, run: () => updateChart(ch.id, { t }) }))); break; }
      case 'ch-data': { const ch = sheet().charts.find((x) => x.id === selChart); if (ch) dialogs.chartOptions(ch); break; }
      case 'ch-switch': { const ch = sheet().charts.find((x) => x.id === selChart); if (ch) updateChart(ch.id, { byRow: !ch.byRow }); break; }
      case 'ch-title': { const ch = sheet().charts.find((x) => x.id === selChart); if (!ch) break; const v = await ask('Chart Title', 'Title', ch.title); if (v !== null) updateChart(ch.id, { title: v }); break; }
      case 'ch-legend': { const ch = sheet().charts.find((x) => x.id === selChart); if (ch) updateChart(ch.id, { legend: !ch.legend }); break; }
      case 'ch-delete': { const id = selChart; if (id) { selChart = null; editSheet((sh) => { sh.charts = sh.charts.filter((x) => x.id !== id); }); } break; }
      case 'trace-pre': trace('pre'); break;
      case 'trace-dep': trace('dep'); break;
      case 'trace-clear': arrows = []; render(); break;
      case 'err-check': errorChecking(); break;
      case 'what-if': menu([{ label: 'Goal Seek…', run: () => dialogs.goalSeek() }]); break;
      case 'protect': if (sheet().protect) dialogs.unprotectSheet(); else dialogs.protectSheet(); break;
      case 'pl-orient': menu([['portrait', 'Portrait'], ['landscape', 'Landscape']].map(([v, l]) => ({ label: l, run: () => pageSetupCmd({ orientation: v }, `Orientation: ${l}`) }))); break;
      case 'pl-size': menu([['letter', 'Letter (8.5 × 11 in)'], ['a4', 'A4 (210 × 297 mm)'], ['legal', 'Legal (8.5 × 14 in)']].map(([v, l]) => ({ label: l, run: () => pageSetupCmd({ size: v }, `Size: ${l}`) }))); break;
      case 'pl-margins': menu([['Normal', 1], ['Wide', 1.25], ['Narrow', 0.5]].map(([l, m]) => ({ label: `${l} (${m} in)`, run: () => pageSetupCmd({ margins: { top: m, bottom: m, left: m, right: m } }, `Margins: ${l}`) }))); break;
      case 'pl-area': menu([{ label: 'Set Print Area', run: () => { printSetting({ area: E.rangeRef(clampToUsed(range())) }); toast(`Print area: ${E.rangeRef(clampToUsed(range()))}`); } }, { label: 'Clear Print Area', run: () => printSetting({ area: undefined }) }]); break;
      case 'pl-titles': { const v = await ask('Print Titles', 'Rows to repeat at top (for example 1:1 or 1:2)', sheet().print?.titles || `${range().r1 + 1}:${range().r1 + 1}`); if (v !== null) { if (v.trim() && !/^\d+:\d+$/.test(v.trim())) toast('Type rows such as 1:1', { tone: 'error' }); else printSetting({ titles: v.trim() || undefined }); } break; }
      case 'pl-fit': menu([['', 'No Scaling'], ['width', 'Fit All Columns on One Page'], ['page', 'Fit Sheet on One Page']].map(([v, l]) => ({ label: l, run: () => printSetting({ fit: v || undefined }) }))); break;
      case 'format-cells': dialogs.formatCells(); break;
      case 'font-dialog': dialogs.formatCells(2); break;
      case 'align-dialog': dialogs.formatCells(1); break;
      case 'indent-more': styleSel((s) => ({ ...s, ind: Math.min(15, (s.ind || 0) + 1), al: s.al === 'right' ? 'right' : 'left' })); break;
      case 'indent-less': styleSel((s) => ({ ...s, ind: Math.max(0, (s.ind || 0) - 1) || undefined })); break;
      case 'orientation': menu([['45', 'Angle Counterclockwise'], ['-45', 'Angle Clockwise'], ['255', 'Vertical Text'], ['90', 'Rotate Text Up'], ['-90', 'Rotate Text Down'], ['0', 'No Rotation']].map(([v, l]) => ({ label: l, run: () => styleSel((s) => ({ ...s, rot: Number(v) || undefined })) })).concat(['divider', { label: 'Format Cell Alignment…', run: () => dialogs.formatCells(1) }])); break;
      case 'more-formats': dialogs.formatCells(0); break;
      case 'cell-styles': menu(Object.entries(CELL_STYLES).flatMap(([group, styles], gi) => [...(gi ? ['divider'] : []), ...Object.entries(styles).map(([name, st]) => ({ label: `${group === 'Number Format' ? '' : ''}${name}`, run: () => styleSel((s) => (name === 'Normal' ? {} : { ...s, ...st })) }))])); break;
      case 'insert-link': dialogs.hyperlink(); break;
      case 'note-new': editNote(); break;
      case 'note-delete': deleteNotes(); break;
      case 'note-prev': noteStep(-1); break;
      case 'note-next': noteStep(1); break;
      case 'note-all': showAllNotes = !showAllNotes; drawNotes(); el.classList.toggle('pressed', showAllNotes); break;
      case 'define-name': dialogs.defineName(); break;
      case 'name-manager': dialogs.nameManager(); break;
      case 'use-name': { const names = Object.keys(wb.names || {}); if (!names.length) { toast('There are no names yet. Use Define Name first.'); break; } menu(names.map((n) => ({ label: n, run: () => insertFunctionName(n) }))); break; }
      case 'sort-dialog': dialogs.sortDialog(); break;
      case 'text-to-cols': dialogs.textToColumns(); break;
      case 'remove-dups': dialogs.removeDuplicates(); break;
      case 'validation': menu([{ label: 'Data Validation…', run: () => dialogs.validation() }, { label: circleInvalid ? 'Clear Validation Circles' : 'Circle Invalid Data', run: () => { circleInvalid = !circleInvalid; render(); if (circleInvalid && !invalidCells().length) toast('No invalid data found'); } }]); break;
      case 'cut': clipboardCmd('cut'); break;
      case 'copy': clipboardCmd('copy'); break;
      case 'painter': if (painter) { painter = null; root.classList.remove('painting'); syncChrome(); } else startPainter(false); break;
      case 'grow': case 'shrink': styleSel((s) => { const SZ = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]; const cur = s.fz || 11; const i = SZ.findIndex((x) => x >= cur); const n = cmd === 'grow' ? SZ[Math.min(SZ.length - 1, (SZ[i] === cur ? i : i - 1) + 1)] : SZ[Math.max(0, i - 1)]; return { ...s, fz: n === 11 ? undefined : n }; }); break;
      case 'bold': toggle('b'); break;
      case 'italic': toggle('i'); break;
      case 'underline': toggle('u'); break;
      case 'borders': menu([['bottom', 'Bottom Border'], ['top', 'Top Border'], ['left', 'Left Border'], ['right', 'Right Border'], 'divider', ['none', 'No Border'], ['all', 'All Borders'], ['outside', 'Outside Borders'], ['thick', 'Thick Outside Borders'], 'divider', ['double-bottom', 'Bottom Double Border'], ['thick-bottom', 'Thick Bottom Border']].map((x) => (x === 'divider' ? x : { label: x[1], run: () => borders(x[0]) }))); break;
      case 'fill': styleSel((s) => ({ ...s, bg: swatch('fill') })); break;
      case 'fontcolor': styleSel((s) => ({ ...s, fg: swatch('fontcolor') })); break;
      case 'va-top': case 'va-middle': case 'va-bottom': styleSel((s) => ({ ...s, va: cmd === 'va-bottom' ? undefined : cmd.slice(3) })); break;
      case 'al-left': case 'al-center': case 'al-right': { const v = cmd.slice(3); const on = E.styleAt(sheet(), active.r, active.c)?.al === v; styleSel((s) => ({ ...s, al: on ? undefined : v })); break; }
      case 'wrap': toggle('wr'); break;
      case 'merge': menu([{ label: 'Merge & Center', run: () => merge('center') }, { label: 'Merge Across', run: () => merge('across') }, { label: 'Merge Cells', run: () => merge('cells') }, { label: 'Unmerge Cells', run: () => merge('unmerge') }]); break;
      case 'fmt-currency': shortcut('currency'); break;
      case 'fmt-percent': shortcut('percent'); break;
      case 'fmt-comma': styleSel((s) => ({ ...s, f: 'number', dp: 2 })); break;
      case 'dp-more': case 'dp-less': styleSel((s, r, c) => { const sv = r >= 0 && c >= 0 ? shown[E.cellKey(r, c)] : null; const curDp = Number.isInteger(s.dp) ? s.dp : (s.f === 'number' || s.f === 'currency' ? 2 : s.f === 'percent' ? 0 : ((String(sv?.value ?? '').split('.')[1] || '').length)); return { ...s, f: s.f || 'number', dp: Math.max(0, Math.min(10, curDp + (cmd === 'dp-more' ? 1 : -1))) }; }); break;
      case 'cf': menu([{ label: 'Greater Than…', run: () => openCf('gt') }, { label: 'Less Than…', run: () => openCf('lt') }, { label: 'Equal To…', run: () => openCf('eq') }, { label: 'Text that Contains…', run: () => openCf('contains') }, { label: 'Color Scale…', run: () => openCf('scale') }, 'divider', { label: 'Clear Rules from Selected Cells', run: () => editSheet((s) => { const gg = clampToUsed(g); s.cf = s.cf.filter((x) => { const rg = E.parseRange(x.range); return !(rg.r1 >= gg.r1 && rg.r2 <= gg.r2 && rg.c1 >= gg.c1 && rg.c2 <= gg.c2); }); }) }, { label: 'Clear Rules from Entire Sheet', run: () => editSheet((s) => { s.cf = []; }) }, { label: 'Manage Rules…', run: () => openCf() }]); break;
      case 'insert-menu': menu([{ label: 'Insert Cells…', run: () => dialogs.insertCells(false) }, { label: 'Insert Sheet Rows', run: () => insertRows('above') }, { label: 'Insert Sheet Columns', run: () => insertCols('left') }, { label: 'Insert Sheet', run: addSheet }]); break;
      case 'delete-menu': menu([{ label: 'Delete Cells…', run: () => dialogs.insertCells(true) }, { label: 'Delete Sheet Rows', run: deleteRows }, { label: 'Delete Sheet Columns', run: deleteCols }, ...(wb.sheets.length > 1 ? [{ label: 'Delete Sheet', run: () => tabMenu(si, tabs.querySelector('.sheet-tab.on')) }] : [])]); break;
      case 'format-menu': menu([{ label: 'Row Height…', run: () => sizeDialog('row') }, { label: 'AutoFit Row Height', run: () => autofitRows(g.r1, clampToUsed(g).r2) }, 'divider', { label: 'Column Width…', run: () => sizeDialog('col') }, { label: 'AutoFit Column Width', run: () => autofitCols(g.c1, clampToUsed(g).c2) }, 'divider', { label: 'Hide Rows', run: () => shortcut('hide-rows') }, { label: 'Hide Columns', run: () => shortcut('hide-cols') }, { label: 'Unhide Rows', run: () => shortcut('unhide-rows') }, { label: 'Unhide Columns', run: () => shortcut('unhide-cols') }, 'divider', { label: 'Hide Sheet', run: () => hideSheet(si) }, { label: 'Unhide Sheet…', run: () => dialogs.unhideSheet() }, 'divider', { label: 'Rename Sheet', run: () => renameTab(si) }, { label: 'Move or Copy Sheet…', run: () => tabMenu(si, tabs.querySelector('.sheet-tab.on')) }, { label: 'Tab Color…', run: () => dialogs.tabColor(si) }, 'divider', { label: sheet().protect ? 'Unprotect Sheet…' : 'Protect Sheet…', run: () => (sheet().protect ? dialogs.unprotectSheet() : dialogs.protectSheet()) }, { label: E.styleAt(sheet(), active.r, active.c)?.unl ? 'Lock Cell' : 'Unlock Cell (Lock Cell off)', run: () => { const on = !E.styleAt(sheet(), active.r, active.c)?.unl; const pr = sheet().protect; if (pr) { toast(PROTECTED_MSG, { tone: 'error' }); return; } styleSel((s) => ({ ...s, unl: on ? 1 : undefined })); } }, { label: 'Format Cells…', run: () => dialogs.formatCells() }]); break;
      case 'autosum': menu([['SUM', 'Sum'], ['AVERAGE', 'Average'], ['COUNT', 'Count Numbers'], ['MAX', 'Max'], ['MIN', 'Min']].map(([f, l]) => ({ label: l, run: () => autoSum(f) })).concat(['divider', { label: 'More Functions…', run: () => insertFunctionDialog() }])); break;
      case 'fill-menu': menu([{ label: 'Down', run: () => shortcut('fill-down') }, { label: 'Right', run: () => shortcut('fill-right') }, { label: 'Up', run: () => { if (g.r2 > g.r1) fill({ ...g, r1: g.r2 }, 'up', g.r2 - g.r1); } }, { label: 'Left', run: () => { if (g.c2 > g.c1) fill({ ...g, c1: g.c2 }, 'left', g.c2 - g.c1); } }]); break;
      case 'clear-menu': menu([{ label: 'Clear All', run: () => clearSel('all') }, { label: 'Clear Formats', run: () => clearSel('formats') }, { label: 'Clear Contents', run: () => clearSel('contents') }]); break;
      case 'sortfilter': menu([{ label: 'Sort A to Z', run: () => sortBy('asc') }, { label: 'Sort Z to A', run: () => sortBy('desc') }, 'divider', { label: 'Filter', run: toggleFilter }, { label: 'Clear', run: () => editSheet((s) => { if (s.filter) s.filter.crit = {}; }) }, { label: 'Reapply', run: draw }]); break;
      case 'findselect': menu([{ label: 'Find…', run: () => openFind(false) }, { label: 'Replace…', run: () => openFind(true) }, { label: 'Go To…', run: goTo }]); break;
      case 'insert-function': insertFunctionDialog(); break;
      case 'show-formulas': showFormulas = !showFormulas; render(); syncChrome(); break;
      case 'calc-now': draw(); toast('Calculated'); break;
      case 'sort-asc': sortBy('asc'); break;
      case 'sort-desc': sortBy('desc'); break;
      case 'filter': toggleFilter(); break;
      case 'filter-clear': editSheet((s) => { if (s.filter) s.filter.crit = {}; }); break;
      case 'filter-reapply': draw(); break;
      case 'freeze-menu': { const fz = sheet().freeze; menu([fz.r || fz.c ? { label: 'Unfreeze Panes', run: () => editSheet((s) => { s.freeze = { r: 0, c: 0 }; }) } : { label: 'Freeze Panes', run: () => editSheet((s) => { s.freeze = { r: active.r, c: active.c }; }) }, { label: 'Freeze Top Row', run: () => editSheet((s) => { s.freeze = { r: 1, c: 0 }; }) }, { label: 'Freeze First Column', run: () => editSheet((s) => { s.freeze = { r: 0, c: 1 }; }) }]); break; }
      case 'zoom-menu': zoomMenu(el); break;
      case 'zoom-100': setZoom(1); break;
      case 'zoom-sel': zoomToSelection(); break;
      case 'align-menu': openMenu(el, [ // the Align drop-down (like the document toolbar's)
        { label: 'Align left', icon: 'alignLeft', run: () => run('al-left', el) }, { label: 'Centre', icon: 'alignCenter', run: () => run('al-center', el) }, { label: 'Align right', icon: 'alignRight', run: () => run('al-right', el) }, 'divider',
        { label: 'Top', run: () => run('va-top', el) }, { label: 'Middle', run: () => run('va-middle', el) }, { label: 'Bottom', run: () => run('va-bottom', el) }, 'divider',
        { label: 'Decrease indent', icon: 'outdent', run: () => run('indent-less', el) }, { label: 'Increase indent', icon: 'indent', run: () => run('indent-more', el) }, 'divider',
        { label: 'Wrap text', run: () => run('wrap', el) }, { label: 'Text direction…', run: () => setTimeout(() => run('orientation', el), 0) },
      ]); break;
      case 'undo': step(undo, redo, 'before'); break;
      case 'redo': step(redo, undo, 'after'); break;
      case 'ribbon-collapse': break;
      default:
        if (cmd.startsWith('fncat:')) { const cat = cmd.slice(6); menu(FN_CATEGORIES[cat].map((n) => ({ label: n, run: () => insertFunction(n) })).concat(['divider', { label: 'Insert Function…', run: () => insertFunctionDialog(cat) }])); }
    }
    if (!['import', 'paste', 'borders', 'merge', 'cf', 'insert-menu', 'delete-menu', 'format-menu', 'autosum', 'fill-menu', 'clear-menu', 'sortfilter', 'findselect', 'freeze-menu', 'zoom-menu', 'insert-function', 'format-cells', 'font-dialog', 'align-dialog', 'orientation', 'more-formats', 'cell-styles', 'insert-link', 'note-new', 'define-name', 'name-manager', 'use-name', 'sort-dialog', 'text-to-cols', 'remove-dups', 'validation', 'insert-table', 'insert-pivot', 'insert-chart', 'tbl-styles', 'tbl-resize', 'tbl-convert', 'pv-source', 'ch-type', 'ch-data', 'ch-title', 'what-if', 'protect', 'pl-orient', 'pl-size', 'pl-margins', 'pl-area', 'pl-titles', 'pl-fit', 'tbl-name'].includes(cmd) && !cmd.startsWith('fncat:') && !editing) wrap.focus({ preventScroll: true });
  }
  async function exportAs(format) {
    try {
      const res = await fetch('/api/sheets/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workspace' }, body: JSON.stringify({ data: wb, format, title: root.dataset.title || 'Spreadsheet', sheet: si }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Couldn’t export');
      const blob = await res.blob();
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${root.dataset.title || 'Spreadsheet'}.${format}` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) { toast(err.message, { tone: 'error' }); }
  }
  // file import
  const fileInput = Object.assign(document.createElement('input'), { type: 'file', className: 'xl-file', hidden: true, accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  root.appendChild(fileInput);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; fileInput.value = ''; if (!file) return;
    const hasData = wb.sheets.some((s) => Object.keys(s.cells).length);
    if (hasData && !(await confirmDialog({ title: 'Replace this spreadsheet?', message: `“${file.name}” replaces what’s here (Undo brings it back).`, confirmLabel: 'Replace', tone: 'primary' }))) return;
    try {
      const res = await fetch('/api/sheets/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'workspace', 'X-Filename': encodeURIComponent(file.name) }, body: file });
      const out = await res.json(); if (!res.ok) throw new Error(out.error || 'Couldn’t import that file');
      const next = E.normalizeWorkbook(out.workbook || out.sheet);
      next.sheets.forEach((s, i) => { if (wb.sheets[i]) s.id = wb.sheets[i].id; });
      si = 0; ranges = [{ r1: 0, c1: 0, r2: 0, c2: 0 }]; active = { r: 0, c: 0 }; anchor = { r: 0, c: 0 };
      commit(next); toast(`Imported ${file.name}${out.note ? ` (${out.note})` : ''}`);
    } catch (err) { toast(err.message, { tone: 'error' }); }
  });
  if (remove) { const b = document.createElement('button'); b.type = 'button'; b.className = 'tb-btn sheet-remove xl-remove'; b.title = 'Delete spreadsheet'; b.setAttribute('aria-label', 'Delete spreadsheet'); b.innerHTML = icon('trash', { size: 16 }); root.querySelector('.rb-tabs')?.appendChild(b); b.addEventListener('click', async () => { if (await confirmDialog({ title: 'Delete this spreadsheet?', message: 'It’s removed from the document. Undo (in the editor) brings it back.', confirmLabel: 'Delete' })) remove(); }); }

  draw();
  return {
    update(next) {
      const d = parse(next);
      if (JSON.stringify(d) === JSON.stringify(wb)) return;
      const curId = sheet()?.id; wb = d;
      const idx = wb.sheets.findIndex((s) => s.id === curId); si = idx >= 0 ? idx : Math.min(si, wb.sheets.length - 1);
      if (!editing) draw(); else { recalc(); buildGeo(); render(); }
    },
    destroy() { document.removeEventListener('comments:anchors', onCommentAnchors); document.removeEventListener('sheet:goto', onCommentGoto); finishEdit(true); ro.disconnect(); document.removeEventListener('mouseup', onUp); document.removeEventListener('mousemove', onMove); document.querySelector('.sheet-filter-pop')?.remove(); },
  };
}
