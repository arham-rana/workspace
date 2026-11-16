// Spreadsheets, shared parts: the engine binding, helpers, read-only tables (reading view, print, PDF),
// and workbook change tracking (for live co-editing and undo).
import { esc } from './util.js';
import { icon } from './icons.js';
import { sheetEngine, loadSheetEngine } from './sheet-lazy.js';

export let E = null; // the engine (loaded on demand); a live binding shared by the spreadsheet modules
export const bind = (engine) => { E = engine; };

/* ---------- Shared helpers ---------- */
export const parse = (json) => { try { return E.normalizeWorkbook(typeof json === 'string' ? JSON.parse(json) : json); } catch { return E.emptyWorkbook(); } };
export const REF_COLORS = ['#1a73e8', '#d93025', '#188038', '#9334e6', '#e37400', '#007b83', '#c5221f', '#3c4043'];
export const FN_HINTS = {
  SUM: 'SUM(number1, [number2], …)', AVERAGE: 'AVERAGE(number1, [number2], …)', MIN: 'MIN(number1, [number2], …)', MAX: 'MAX(number1, [number2], …)',
  COUNT: 'COUNT(value1, [value2], …)', COUNTA: 'COUNTA(value1, [value2], …)', COUNTIF: 'COUNTIF(range, criterion)', COUNTIFS: 'COUNTIFS(range1, criterion1, …)',
  SUMIF: 'SUMIF(range, criterion, [sum_range])', SUMIFS: 'SUMIFS(sum_range, range1, criterion1, …)', AVERAGEIF: 'AVERAGEIF(range, criterion, [average_range])',
  IF: 'IF(condition, value_if_true, [value_if_false])', IFS: 'IFS(condition1, value1, …)', IFERROR: 'IFERROR(value, value_if_error)', AND: 'AND(logical1, …)', OR: 'OR(logical1, …)', NOT: 'NOT(logical)',
  VLOOKUP: 'VLOOKUP(lookup_value, table, column_index, [exact_match: FALSE])', HLOOKUP: 'HLOOKUP(lookup_value, table, row_index, [exact_match: FALSE])',
  XLOOKUP: 'XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])', INDEX: 'INDEX(range, row, [column])', MATCH: 'MATCH(lookup_value, range, [match_type])',
  ROUND: 'ROUND(number, digits)', ROUNDUP: 'ROUNDUP(number, digits)', ROUNDDOWN: 'ROUNDDOWN(number, digits)', ABS: 'ABS(number)', SQRT: 'SQRT(number)', POWER: 'POWER(number, power)', MOD: 'MOD(number, divisor)',
  CONCAT: 'CONCAT(text1, [text2], …)', TEXTJOIN: 'TEXTJOIN(delimiter, ignore_empty, text1, …)', LEFT: 'LEFT(text, [count])', RIGHT: 'RIGHT(text, [count])', MID: 'MID(text, start, count)', LEN: 'LEN(text)',
  UPPER: 'UPPER(text)', LOWER: 'LOWER(text)', PROPER: 'PROPER(text)', TRIM: 'TRIM(text)', SUBSTITUTE: 'SUBSTITUTE(text, old, new, [instance])', TEXT: 'TEXT(value, format)',
  TODAY: 'TODAY()', NOW: 'NOW()', DATE: 'DATE(year, month, day)', YEAR: 'YEAR(date)', MONTH: 'MONTH(date)', DAY: 'DAY(date)', EDATE: 'EDATE(start_date, months)', EOMONTH: 'EOMONTH(start_date, months)',
  PMT: 'PMT(rate, periods, present_value, [future_value], [type])', FV: 'FV(rate, periods, payment, [present_value], [type])', NPV: 'NPV(rate, value1, …)', MEDIAN: 'MEDIAN(number1, …)',
  LARGE: 'LARGE(range, k)', SMALL: 'SMALL(range, k)', RANK: 'RANK(number, range, [order])', UNIQUE: 'UNIQUE(range)', SUMPRODUCT: 'SUMPRODUCT(array1, [array2], …)',
};
export const mergeMap = (sheet) => {
  const anchors = {}, covered = new Set();
  for (const m of sheet.merges) { const g = E.parseRange(m); if (!g) continue; anchors[E.cellKey(g.r1, g.c1)] = g; for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (r !== g.r1 || c !== g.c1) covered.add(E.cellKey(r, c)); }
  return { anchors, covered };
};
export function hiddenRows(sheet, values) {
  const hidden = new Set(); const f = sheet.filter; if (!f) return hidden;
  const g = E.parseRange(f.range); if (!g) return hidden;
  for (let r = g.r1 + 1; r <= g.r2; r++) {
    for (const [col, cr] of Object.entries(f.crit)) {
      const k = E.cellKey(r, Number(col)); const val = values[k]?.value; const text = E.formatValue(val, sheet.cells[k]?.s?.f, sheet.cells[k]?.s?.dp);
      let ok = true;
      if (cr.vals) ok = cr.vals.includes(text);
      if (ok && cr.op) {
        const n = Number(cr.val), isNum = typeof val === 'number' && Number.isFinite(n);
        ok = cr.op === 'gt' ? isNum && val > n : cr.op === 'lt' ? isNum && val < n : cr.op === 'eq' ? (isNum ? val === n : text.toLowerCase() === String(cr.val).toLowerCase()) : cr.op === 'ne' ? (isNum ? val !== n : text.toLowerCase() !== String(cr.val).toLowerCase()) : text.toLowerCase().includes(String(cr.val).toLowerCase());
      }
      if (!ok) { hidden.add(r); break; }
    }
  }
  return hidden;
}
export function cfStyles(sheet, values) {
  const out = {};
  for (const rule of sheet.cf) {
    const g = E.parseRange(rule.range); if (!g) continue;
    if (rule.type === 'scale') {
      const nums = []; for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const v = values[E.cellKey(r, c)]?.value; if (typeof v === 'number') nums.push(v); }
      if (!nums.length) continue;
      const lo = Math.min(...nums), hi = Math.max(...nums);
      const mix = (a, b, t) => `#${[1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`;
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const k = E.cellKey(r, c); const v = values[k]?.value; if (typeof v === 'number') out[k] = { bg: mix(rule.lo || '#ffffff', rule.hi || '#57bb8a', hi === lo ? 1 : (v - lo) / (hi - lo)), fg: '#1f1f1f' }; }
      continue;
    }
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
      const k = E.cellKey(r, c); const v = values[k]?.value; if (v === null || v === undefined || v === '') continue;
      const n = Number(rule.value);
      const hit = rule.type === 'gt' ? typeof v === 'number' && v > n : rule.type === 'lt' ? typeof v === 'number' && v < n : rule.type === 'eq' ? (typeof v === 'number' ? v === n : String(v).toLowerCase() === rule.value.toLowerCase()) : String(v).toLowerCase().includes(rule.value.toLowerCase());
      if (hit) out[k] = { bg: rule.bg, fg: rule.fg };
    }
  }
  return out;
}
export function cellCss(cell, shown, cf, { forPrint = false, style = null } = {}) {
  const s = style || cell?.s || {};
  const css = [];
  if (s.b) css.push('font-weight:700'); if (s.i) css.push('font-style:italic'); if (s.u) css.push('text-decoration:underline');
  if (s.ff) css.push(`font-family:'${s.ff}',sans-serif`); if (s.fz) css.push(`font-size:${s.fz}px`);
  const fg = cf?.fg || s.fg, bg = cf?.bg || s.bg;
  if (fg) css.push(`color:${fg}`); if (bg) css.push(`background:${bg}`);
  css.push(`text-align:${s.al || (shown?.number ? 'right' : shown?.error ? 'center' : 'left')}`);
  css.push(`vertical-align:${s.va === 'middle' ? 'middle' : s.va === 'top' ? 'top' : 'bottom'}`);
  if (s.wr) css.push('white-space:pre-wrap;overflow-wrap:anywhere');
  const line = forPrint ? '1.5px solid #555' : '1.5px solid var(--sheet-border, #3c4043)';
  if (s.bd?.t) css.push(`border-top:${line}`); if (s.bd?.r) css.push(`border-right:${line}`); if (s.bd?.b) css.push(`border-bottom:${line}`); if (s.bd?.l) css.push(`border-left:${line}`);
  return css.join(';');
}

/* ---------- Table styles (Format as Table): defined in the shared engine ---------- */
export const TABLE_STYLES = Array.from({ length: 18 }, (_, i) => `${['light', 'medium', 'dark'][Math.floor(i / 6)]}${(i % 6) + 1}`);
export const tableStyleDef = (name) => E.tableStyleDef(name);
export const tableStyleAt = (sheet, r, c) => E.tableStyleAt(sheet, r, c);
export const withTable = (sheet, r, c, own) => { const ts = sheet.tables?.length ? tableStyleAt(sheet, r, c) : null; return ts ? { ...ts, ...(own || {}) } : own; };

/* ---------- Read-only tables (reading view, print, PDF) ---------- */
export function staticSheetHtml(json) {
  if (!sheetEngine()) return quickHtml(json);
  bind(sheetEngine());
  const wb = parse(json);
  const values = E.evaluateWorkbook(wb);
  return wb.sheets.filter((x) => !x.hidden).map((sheet) => {
    const v = values[sheet.name] || {};
    const shown = E.displayFrom(sheet, v);
    const used = E.usedRange(sheet, v); const pa = sheet.print?.area ? E.parseRange(sheet.print.area) : null;
    let rows = Math.max(used.rows, ...((sheet.tables || []).map((t) => E.parseRange(t.range).r2 + 1))), cols = Math.max(used.cols, ...((sheet.tables || []).map((t) => E.parseRange(t.range).c2 + 1)));
    const r0 = pa ? pa.r1 : 0, c0 = pa ? pa.c1 : 0; if (pa) { rows = pa.r2 + 1; cols = pa.c2 + 1; }
    const titles = sheet.print?.titles ? sheet.print.titles.split(':').map((n) => Number(n) - 1) : null;
    const heads = !!sheet.print?.heads; const grid = sheet.print?.grid !== false;
    let totalW = 0; for (let c = c0; c < cols; c++) if (!(sheet.hc || []).includes(c)) totalW += sheet.w[E.colName(c)] || E.DEF_W;
    const fit = sheet.print?.fit && totalW > 624 ? 624 / totalW : 1;
    const { anchors, covered } = mergeMap(sheet);
    const hidden = hiddenRows(sheet, v);
    const cf = cfStyles(sheet, v);
    const visible = wb.sheets.filter((x) => !x.hidden).length;
    let html = `${visible > 1 ? `<div class="sheet-static-name">${esc(sheet.name)}</div>` : ''}<div class="sheet-static${grid ? '' : ' no-grid'}${sheet.print?.fit === 'page' ? ' fit-page' : ''}"><table${fit < 1 ? ` style="font-size:${fit.toFixed(3)}em;width:100%"` : ''}><colgroup>`;
    const hc = new Set(sheet.hc || []), hr = new Set(sheet.hr || []);
    if (heads) html += `<col style="width:${fit < 1 ? `${((34 / (totalW + 34)) * 100).toFixed(2)}%` : '34px'}">`;
    for (let c = c0; c < cols; c++) if (!hc.has(c)) { const w = sheet.w[E.colName(c)] || E.DEF_W; html += `<col style="width:${fit < 1 ? `${((w / (totalW + (heads ? 34 : 0))) * 100).toFixed(2)}%` : `${w}px`}">`; }
    html += '</colgroup>';
    const rowHtml = (r) => {
      let out = `<tr${sheet.h[r] ? ` style="height:${sheet.h[r]}px"` : ''}>${heads ? `<th class="sheet-static-rh">${r + 1}</th>` : ''}`;
      for (let c = c0; c < cols; c++) {
        const k = E.cellKey(r, c); if (covered.has(k) || hc.has(c)) continue;
        const g = anchors[k];
        out += `<td${g ? ` rowspan="${g.r2 - g.r1 + 1}" colspan="${g.c2 - g.c1 + 1}"` : ''} class="${shown[k]?.error ? 'sheet-err' : ''}" style="${cellCss(sheet.cells[k], shown[k], cf[k], { forPrint: true, style: withTable(sheet, r, c, E.styleAt(sheet, r, c)) })}">${esc(shown[k]?.text ?? '')}</td>`;
      }
      return `${out}</tr>`;
    };
    // headings row and rows to repeat at the top of every printed page go in <thead>
    const headRows = [];
    if (heads) { let hrow = '<tr><th class="sheet-static-rh"></th>'; for (let c = c0; c < cols; c++) if (!hc.has(c)) hrow += `<th class="sheet-static-ch">${E.colName(c)}</th>`; headRows.push(`${hrow}</tr>`); }
    const titleSet = new Set(); if (titles) for (let r = titles[0]; r <= titles[1]; r++) { if (r >= r0 && !hidden.has(r) && !hr.has(r)) { headRows.push(rowHtml(r)); titleSet.add(r); } }
    if (headRows.length) html += `<thead>${headRows.join('')}</thead>`;
    html += '<tbody>';
    for (let r = r0; r < rows; r++) { if (hidden.has(r) || hr.has(r) || titleSet.has(r)) continue; html += rowHtml(r); }
    html += '</tbody></table></div>';
    // charts on the sheet, after its table
    for (const ch of sheet.charts || []) { const spec = chartSpec(wb, sheet, ch, values); if (spec) html += `<figure class="sheet-static-chart" style="max-width:${ch.w}px">${chartSvgFn ? chartSvgFn(spec, { width: ch.w, height: ch.h }) : ''}</figure>`; }
    return html;
  }).join('');
}
function quickHtml(json) {
  loadSheetEngine();
  let d = {}; try { d = typeof json === 'string' ? JSON.parse(json) : (json || {}); } catch { d = {}; }
  const sheets = Array.isArray(d.sheets) ? d.sheets : [d];
  const col = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
  return sheets.map((sh) => {
    const cells = sh.cells || {}; let rows = 1, cols = 1;
    for (const k of Object.keys(cells)) { const m = /^([A-Z]{1,2})(\d+)$/.exec(k); if (!m) continue; const c = m[1].length === 1 ? m[1].charCodeAt(0) - 65 : (m[1].charCodeAt(0) - 64) * 26 + m[1].charCodeAt(1) - 65; rows = Math.max(rows, Number(m[2])); cols = Math.max(cols, c + 1); }
    let html = '<div class="sheet-static sheet-loading"><table><tbody>';
    for (let r = 0; r < rows; r++) { html += '<tr>'; for (let c = 0; c < cols; c++) { const v = String(cells[`${col(c)}${r + 1}`]?.v ?? ''); html += `<td>${esc(v.startsWith('=') ? '…' : v)}</td>`; } html += '</tr>'; }
    return `${html}</tbody></table></div>`;
  }).join('');
}

/* ---------- Changes as sheet/cell-level differences (co-editing and undo) ---------- */
// every sheet-level setting must be listed here, or changes to it aren't tracked (or saved)
const META = ['name', 'r', 'c', 'w', 'wa', 'h', 'cs', 'rs', 'hr', 'hc', 'merges', 'freeze', 'filter', 'cf', 'dv', 'view', 'tab', 'protect', 'tables', 'pivots', 'charts', 'print', 'hidden'];
const flat = (wb) => {
  const meta = {}, cells = {};
  for (const s of wb.sheets) { meta[s.id] = Object.fromEntries(META.map((k) => [k, s[k]])); for (const [k, v] of Object.entries(s.cells)) cells[`${s.id}/${k}`] = v; }
  return { order: wb.sheets.map((s) => s.id), meta, cells, names: wb.names || {} };
};
export function diffBooks(a, b) {
  const A = flat(a), B = flat(b);
  const before = { order: A.order, meta: {}, cells: {} }, after = { order: B.order, meta: {}, cells: {} };
  // defined names (workbook level): each changed name is tracked on its own
  for (const k of new Set([...Object.keys(A.names), ...Object.keys(B.names)])) if ((A.names[k] ?? null) !== (B.names[k] ?? null)) { (before.names ||= {})[k] = A.names[k] ?? null; (after.names ||= {})[k] = B.names[k] ?? null; }
  for (const k of new Set([...Object.keys(A.meta), ...Object.keys(B.meta)])) if (JSON.stringify(A.meta[k] || null) !== JSON.stringify(B.meta[k] || null)) { before.meta[k] = A.meta[k] || null; after.meta[k] = B.meta[k] || null; }
  for (const k of new Set([...Object.keys(A.cells), ...Object.keys(B.cells)])) if (A.cells[k] !== B.cells[k] && JSON.stringify(A.cells[k] || null) !== JSON.stringify(B.cells[k] || null)) /* shared (unchanged) cells: one cheap check */ { before.cells[k] = A.cells[k] || null; after.cells[k] = B.cells[k] || null; }
  const changed = Object.keys(after.meta).length || Object.keys(after.cells).length || A.order.join() !== B.order.join() || after.names;
  return changed ? { before, after } : null;
}
export function applySide(cur, side) {
  const C = flat(parse(cur));
  for (const [k, v] of Object.entries(side.meta)) { if (v) C.meta[k] = v; else delete C.meta[k]; }
  for (const [k, v] of Object.entries(side.cells)) { if (v) C.cells[k] = v; else delete C.cells[k]; }
  const order = side.order.filter((id) => C.meta[id]);
  C.order.forEach((id) => { if (!order.includes(id) && C.meta[id] && !(id in side.meta && side.meta[id] === null)) order.push(id); });
  const names = { ...C.names }; for (const [k, v] of Object.entries(side.names || {})) { if (v === null) delete names[k]; else names[k] = v; }
  return E.normalizeWorkbook({ names, sheets: order.map((id) => ({ id, ...C.meta[id], cells: Object.fromEntries(Object.entries(C.cells).filter(([k]) => k.startsWith(`${id}/`)).map(([k, v]) => [k.slice(id.length + 1), v])) })) });
}


/* ---------- Charts linked to cells ---------- */
let chartSvgFn = null;
export const setChartRenderer = (fn) => { chartSvgFn = fn; };
export const CHART_COLORS = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e'];
/** Turn a chart's cell range into a chart spec: first row = series names, first column = categories (or the other way round). */
export function chartSpec(wb, sheet, ch, values = null) {
  const i = ch.range.lastIndexOf('!');
  const sh = i > 0 ? wb.sheets.find((x) => x.name.toLowerCase() === ch.range.slice(0, i).replace(/^'|'$/g, '').toLowerCase()) : sheet;
  const g = E.parseRange(ch.range.slice(i + 1).replace(/\$/g, '')); if (!sh || !g) return null;
  const vals = (values || E.evaluateWorkbook(wb))[sh.name] || {};
  const at = (r, c) => vals[E.cellKey(r, c)]?.value;
  const grid = []; for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 500); r++) { const row = []; for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 50); c++) row.push(at(r, c)); grid.push(row); }
  const data = ch.byRow ? grid : grid[0].map((_, j) => grid.map((row) => row[j])); // series are rows of `data`
  const hasHead = data.length > 1 && data[0].length > 1 && typeof data[0][0] !== 'number';
  const firstNum = data.every((s) => typeof s[1] === 'number' || s[1] === null || s[1] === undefined);
  const labelsSeries = typeof data[0][1] !== 'number' || !firstNum ? data[0] : null; // a column of category labels
  const body = labelsSeries ? data.slice(1) : data;
  const labels = (labelsSeries || data[0].map((_, k) => String(k + 1))).slice(hasHead || labelsSeries ? 1 : 0).map((x) => String(x ?? ''));
  const series = body.map((s, k) => ({ n: hasHead || labelsSeries ? String(s[0] ?? `Series ${k + 1}`) : `Series ${k + 1}`, v: s.slice(hasHead || labelsSeries ? 1 : 0).map((x) => (typeof x === 'number' ? x : Number(x) || 0)), c: CHART_COLORS[k % CHART_COLORS.length] }));
  return { t: ch.t, title: ch.title, labels, series: ch.t === 'pie' ? series.slice(0, 1) : series, legend: ch.legend };
}
