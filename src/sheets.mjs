// Spreadsheet files: import .xlsx (all worksheets) / .csv, and export .xlsx (all sheets) / .csv (current sheet).
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { normalizeWorkbook, evaluateWorkbook, workbookRows, cellKey, colName, parseCsv, toCsv, parseRange, parseKey, rangeRef, expandStructured, tableStyleAt, MAX_ROWS, MAX_COLS, MAX_SHEETS } from '../shared/sheet-engine.mjs';

const BORDER_IN = { thin: 1, hair: 1, medium: 2, double: 3, dashed: 4, mediumDashed: 4, dashDot: 4, dotted: 5, thick: 6 };
const BORDER_OUT = { 1: 'thin', 2: 'medium', 3: 'double', 4: 'dashed', 5: 'dotted', 6: 'thick' };

const argb = (hex) => `FF${hex.slice(1).toUpperCase()}`;
const hexOf = (c) => (c && typeof c.argb === 'string' && /^[0-9A-F]{8}$/i.test(c.argb) ? `#${c.argb.slice(2).toLowerCase()}` : null);
const fmtOf = (numFmt) => {
  if (!numFmt || numFmt === 'General') return null;
  if (/%/.test(numFmt)) return { f: 'percent', dp: ((/0\.(0+)/.exec(numFmt) || [])[1] || '').length };
  if (/[$€£¥]|currency/i.test(numFmt)) return { f: 'currency', dp: ((/0\.(0+)/.exec(numFmt) || [])[1] || '').length };
  if (/[dmy]{1,4}/i.test(numFmt) && !/0/.test(numFmt)) return { f: 'date' };
  if (/@/.test(numFmt)) return { f: 'text' };
  if (/0\.0|#,##0/.test(numFmt)) return { f: 'number', dp: ((/0\.(0+)/.exec(numFmt) || [])[1] || '').length };
  return null;
};
const NUMFMT = (f, dp) => {
  const d = Number.isInteger(dp) ? dp : (f === 'percent' ? 0 : 2);
  const dec = d ? `.${'0'.repeat(d)}` : '';
  return { number: `#,##0${dec}`, currency: `"$"#,##0${dec}`, percent: `0${dec}%`, date: 'yyyy-mm-dd', text: '@' }[f];
};
const excelSerial = (d) => d.getTime() / 86400000 + 25569;
const FONT_OK = new Set(['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS']);

function readWorksheet(ws, notes) {
  const cells = {};
  let maxR = 0, maxC = 0;
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn > MAX_ROWS) return;
    row.eachCell({ includeEmpty: false }, (cell, cn) => {
      if (cn > MAX_COLS || (cell.isMerged && cell.master !== cell)) return;
      let v = cell.value; const s = {}; let link = null;
      if (v && typeof v === 'object') {
        if (v.formula || v.sharedFormula) v = `=${v.formula || cell.formula || ''}`;
        else if (v.richText) v = v.richText.map((t) => t.text).join('');
        else if (v.hyperlink) { link = String(v.hyperlink); v = typeof v.text === 'object' ? (v.text.richText || []).map((t) => t.text).join('') : String(v.text ?? v.hyperlink); }
        else if (v.text !== undefined) v = String(v.text);
        else if (v instanceof Date) { v = String(excelSerial(v)); s.f = 'date'; }
        else if (v.error) v = v.error;
        else v = '';
      }
      if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE';
      v = v == null ? '' : String(v);
      const font = cell.font || {};
      if (font.bold) s.b = 1; if (font.italic) s.i = 1; if (font.underline) s.u = 1; if (font.strike) s.st = 1;
      if (font.vertAlign === 'superscript') s.vs = 'sup'; if (font.vertAlign === 'subscript') s.vs = 'sub';
      if (font.name && FONT_OK.has(font.name)) s.ff = font.name;
      if (font.size && font.size !== 11) s.fz = Math.round(font.size); // points, as in Excel
      const fg = hexOf(font.color); if (fg && fg !== '#000000') s.fg = fg;
      const bg = cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' ? hexOf(cell.fill.fgColor) : null; if (bg && bg !== '#ffffff') s.bg = bg;
      const al = cell.alignment || {};
      if (['left', 'center', 'right'].includes(al.horizontal)) s.al = al.horizontal;
      if (al.vertical === 'top' || al.vertical === 'middle') s.va = al.vertical;
      if (al.wrapText) s.wr = 1;
      if (al.indent) s.ind = al.indent;
      if (al.textRotation === 'vertical') s.rot = 255; else if (Number(al.textRotation)) s.rot = Number(al.textRotation) > 90 ? 90 - Number(al.textRotation) : Number(al.textRotation);
      const b = cell.border || {}; const bd = {}; let bc = null;
      for (const [side, k] of [['top', 't'], ['right', 'r'], ['bottom', 'b'], ['left', 'l']]) if (b[side]?.style) { bd[k] = BORDER_IN[b[side].style] || 1; bc ||= hexOf(b[side].color); }
      if (Object.keys(bd).length) s.bd = bd; if (bc && bc !== '#000000') s.bc = bc;
      const nf = s.f === 'date' ? null : fmtOf(cell.numFmt); if (nf) { s.f = nf.f; if (nf.dp !== undefined) s.dp = nf.dp; }
      if (cell.protection?.locked === false) s.unl = 1; if (cell.protection?.hidden) s.hf = 1;
      if (cell.numFmt && cell.numFmt !== 'General' && !/^(0|0\.0+|#,##0|#,##0\.0+|0%|0\.0+%|"\$"#,##0\.00|\$#,##0\.00|yyyy-mm-dd|@)$/.test(cell.numFmt)) s.nf = cell.numFmt; // keep Excel's own format code
      const note = cell.note ? (typeof cell.note === 'string' ? cell.note : (cell.note.texts || []).map((t) => t.text).join('')) : '';
      if (v === '' && !Object.keys(s).length && !note && !link) return;
      cells[cellKey(rn - 1, cn - 1)] = { v, ...(Object.keys(s).length ? { s } : {}), ...(note.trim() ? { n: { t: note } } : {}), ...(link ? { l: /^(https?:|mailto:)/i.test(link) ? link : `#${link.replace(/^#/, '')}` } : {}) };
      maxR = Math.max(maxR, rn); maxC = Math.max(maxC, cn);
    });
  });
  if (ws.rowCount > MAX_ROWS) notes.add(`only the first ${MAX_ROWS} rows of a sheet`);
  if (ws.columnCount > MAX_COLS) notes.add(`only the first ${MAX_COLS} columns of a sheet`);
  const w = {};
  (ws.columns || []).slice(0, MAX_COLS).forEach((col, i) => { if (col?.width) w[colName(i)] = Math.round(Math.max(30, Math.min(800, col.width * 7.5))); });
  const h = {};
  ws.eachRow({ includeEmpty: true }, (row, rn) => { if (rn <= MAX_ROWS && row.height) h[rn - 1] = Math.round(row.height * 4 / 3); });
  const merges = Object.keys(ws._merges || {}).map((k) => ws._merges[k]?.range || ws._merges[k]?.model && `${ws._merges[k].tl}:${ws._merges[k].br}`).filter(Boolean)
    .concat((ws.model?.merges || [])).filter((m, i, a) => typeof m === 'string' && a.indexOf(m) === i && parseRange(m));
  const view = (ws.views || [])[0] || {};
  const freeze = view.state === 'frozen' ? { r: Math.min(200, view.ySplit || 0), c: Math.min(50, view.xSplit || 0) } : { r: 0, c: 0 };
  const hr = []; (ws._rows || []).forEach((row, i) => { if (row?.hidden && i < MAX_ROWS) hr.push(i); }); // includes hidden rows that are empty
  const hc = []; (ws.columns || []).slice(0, MAX_COLS).forEach((col, i) => { if (col?.hidden) hc.push(i); });
  const grid = view.showGridLines === false ? { grid: false } : {};
  const dvIn = ws.dataValidations?.model || {};
  const groups = new Map();
  for (const [addr, x] of Object.entries(dvIn)) {
    if (!x || !x.type) continue;
    const type = { list: 'list', whole: 'whole', decimal: 'decimal', date: 'date', textLength: 'textlen', custom: 'custom' }[x.type]; if (!type) continue;
    const f1 = String(x.formulae?.[0] ?? ''), f2 = String(x.formulae?.[1] ?? '');
    const rule = { type, op: { between: 'between', notBetween: 'notbetween', equal: 'eq', notEqual: 'ne', greaterThan: 'gt', lessThan: 'lt', greaterThanOrEqual: 'ge', lessThanOrEqual: 'le' }[x.operator] || 'between',
      v1: type === 'list' ? (f1.startsWith('"') ? f1.replace(/^"|"$/g, '') : `=${f1.replace(/^=/, '')}`) : f1.replace(/^=/, ''), v2: f2.replace(/^=/, ''), blank: x.allowBlank !== false, drop: x.showDropDown !== true,
      ...(x.promptTitle || x.prompt ? { msg: { title: x.promptTitle || '', text: x.prompt || '' } } : {}), err: { style: x.errorStyle === 'warning' ? 'warning' : x.errorStyle === 'information' ? 'info' : 'stop', title: x.errorTitle || '', text: x.error || '' } };
    const key = JSON.stringify(rule); if (!groups.has(key)) groups.set(key, { rule, refs: [] });
    groups.get(key).refs.push(...String(addr).split(/\s+/).filter((a) => parseRange(a.replace(/\$/g, ''))));
  }
  // Excel lists validated cells one by one; join runs of cells in the same column back into ranges.
  const compact = (refs) => {
    const cellsIn = []; for (const ref of refs) { const g = parseRange(ref.replace(/\$/g, '')); for (let c = g.c1; c <= g.c2; c++) for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 5000); r++) cellsIn.push([c, r]); }
    cellsIn.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const out = [];
    for (const [c, r] of cellsIn) { const last = out[out.length - 1]; if (last && last.c1 === c && last.r2 === r - 1) last.r2 = r; else if (!(last && last.c1 === c && last.r2 >= r)) out.push({ r1: r, r2: r, c1: c, c2: c }); }
    return out.map(rangeRef).join(' ');
  };
  const dv = [...groups.values()].map((g) => ({ ...g.rule, range: compact(g.refs) })).filter((x) => x.range);
  const ps = ws.pageSetup || {};
  const print = { ...(ps.printArea && parseRange(String(ps.printArea).split(',')[0].replace(/\$/g, '')) ? { area: String(ps.printArea).split(',')[0].replace(/\$/g, '') } : {}), ...(ps.printTitlesRow ? { titles: String(ps.printTitlesRow).replace(/\$/g, '') } : {}), ...(ps.fitToPage ? { fit: ps.fitToHeight === 1 ? 'page' : 'width' } : {}), ...(ps.printHeadings ? { heads: true } : {}) };
  const sp = ws.sheetProtection || ws.model?.sheetProtection;
  const protect = sp && sp.sheet ? { on: true, allow: { format: sp.formatCells === false ? false : !!sp.formatCells, insert: !!sp.insertRows, delete: !!sp.deleteRows, sort: !!sp.sort, filter: !!sp.autoFilter, selectLocked: sp.selectLockedCells !== false } } : null;
  const tables = Object.values(ws.tables || {}).map((t) => t.table || t).filter((t) => t && (t.ref || t.tableRef) && t.name).map((t) => ({ name: t.name, range: String(t.ref || t.tableRef).replace(/\$/g, ''), header: t.headerRow !== false, total: !!t.totalsRow, style: /TableStyle(Light|Medium|Dark)(\d+)/i.test(t.style?.theme || '') ? `${RegExp.$1.toLowerCase()}${((Number(RegExp.$2) - 1) % 6) + 1}` : 'medium2', banded: t.style?.showRowStripes !== false, firstCol: !!t.style?.showFirstColumn, lastCol: !!t.style?.showLastColumn, bandedCols: !!t.style?.showColumnStripes }));
  if (tables.length) notes.add('tables came in with their names and styles');
  return { name: ws.name, cells, w, h, hr, hc, merges, freeze, filter: null, cf: [], dv, tables, ...(protect ? { protect } : {}), ...(ws.state === 'hidden' || ws.state === 'veryHidden' ? { hidden: true } : {}), print, view: grid, tab: hexOf(ws.properties?.tabColor) };
}

/** Read a .xlsx (all worksheets) or .csv file into a workbook. */
export async function importSheet(buffer, filename = '') {
  if (!/\.csv$/i.test(String(filename || ''))) { const { guardZip } = await import('./zip-guard.mjs'); await guardZip(buffer, { label: 'spreadsheet' }); } // zip bombs
  const notes = new Set();
  if (/\.csv$/i.test(filename) || (!/\.xlsx$/i.test(filename) && buffer.slice(0, 2).toString() !== 'PK')) {
    const rows = parseCsv(buffer.toString('utf8'));
    const cells = {};
    rows.slice(0, MAX_ROWS).forEach((row, r) => row.slice(0, MAX_COLS).forEach((v, c) => { if (v !== '') cells[cellKey(r, c)] = { v }; }));
    if (rows.length > MAX_ROWS) notes.add(`only the first ${MAX_ROWS} rows`);
    const name = (filename.replace(/\.csv$/i, '') || 'Sheet1').slice(0, 31);
    return { workbook: normalizeWorkbook({ sheets: [{ name, r: Math.max(40, Math.min(MAX_ROWS, rows.length + 10)), c: Math.max(12, Math.min(MAX_COLS, Math.max(0, ...rows.map((r) => r.length)) + 2)), cells }] }), note: [...notes].join('; ') };
  }
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  if (!book.worksheets.length) throw Object.assign(new Error('That file has no worksheets'), { status: 400 });
  if (book.worksheets.length > MAX_SHEETS) notes.add(`only the first ${MAX_SHEETS} sheets`);
  const sheets = book.worksheets.slice(0, MAX_SHEETS).map((ws) => readWorksheet(ws, notes));
  const names = {};
  for (const dn of book.definedNames?.model || []) { const ref = (dn.ranges || [])[0]; if (dn.name && ref && !/^_xlnm\./i.test(dn.name)) names[dn.name] = ref; }
  return { workbook: normalizeWorkbook({ sheets, names }), note: [...notes].slice(0, 3).join('; ') };
}

/** Write a workbook as .xlsx (all sheets: formulas, values, styles, merges, freeze panes, sizes) or .csv (one sheet). */
export async function exportSheet(raw, format = 'xlsx', sheetIndex = 0) {
  const wb = normalizeWorkbook(raw);
  if (format === 'csv') { const all = workbookRows(wb); const one = all[Math.min(Math.max(0, Number(sheetIndex) || 0), all.length - 1)]; return Buffer.from(`\uFEFF${toCsv(one.rows)}`, 'utf8'); }
  const values = evaluateWorkbook(wb);
  const book = new ExcelJS.Workbook();
  for (const sheet of wb.sheets) {
    const ws = book.addWorksheet(sheet.name, { ...(sheet.freeze.r || sheet.freeze.c ? { views: [{ state: 'frozen', xSplit: sheet.freeze.c, ySplit: sheet.freeze.r, showGridLines: sheet.view?.grid !== false }] } : sheet.view?.grid === false ? { views: [{ showGridLines: false }] } : {}), ...(sheet.tab ? { properties: { tabColor: { argb: argb(sheet.tab) } } } : {}) });
    for (const c of sheet.hc || []) ws.getColumn(c + 1).hidden = true;
    for (const r of sheet.hr || []) ws.getRow(r + 1).hidden = true;
    // whole-column and whole-row formatting
    const applyStyle = (target, s) => { if (s.b || s.i || s.u || s.fg || s.ff || s.fz) target.font = { bold: !!s.b, italic: !!s.i, underline: !!s.u, ...(s.fg ? { color: { argb: argb(s.fg) } } : {}), ...(s.ff ? { name: s.ff } : {}), ...(s.fz ? { size: s.fz } : {}) }; if (s.bg) target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(s.bg) } }; if (s.f && NUMFMT(s.f, s.dp)) target.numFmt = NUMFMT(s.f, s.dp); if (s.al || s.va || s.wr) target.alignment = { ...(s.al ? { horizontal: s.al } : {}), ...(s.va ? { vertical: s.va } : {}), ...(s.wr ? { wrapText: true } : {}) }; };
    for (const [col, s] of Object.entries(sheet.cs || {})) applyStyle(ws.getColumn(col), s);
    for (const [r, s] of Object.entries(sheet.rs || {})) applyStyle(ws.getRow(Number(r) + 1), s);
    for (let c = 0; c < sheet.c; c++) if (sheet.w[colName(c)]) ws.getColumn(c + 1).width = sheet.w[colName(c)] / 7.5;
    for (const [r, px] of Object.entries(sheet.h)) ws.getRow(Number(r) + 1).height = px * 0.75;
    const vals = values[sheet.name] || {};
    sheet.cells = Object.fromEntries(Object.entries(sheet.cells).map(([k, c]) => [k, { ...c }])); // our own copies: tidy cells are frozen
    // table cells without their own formatting still need the table's look
    for (const t of sheet.tables || []) { const g = parseRange(t.range); for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const k = cellKey(r, c); if (!sheet.cells[k]) sheet.cells[k] = { v: '' }; } }
    for (const [key, cell] of Object.entries(sheet.cells)) {
      const xc = ws.getCell(key);
      const pk = parseKey(key); const ts = sheet.tables?.length ? tableStyleAt(sheet, pk.row, pk.col) : null;
      if (ts) cell.s = { ...ts, ...(cell.s || {}) };
      let v = String(cell.v ?? ''); if (v.startsWith('=') && /\[/.test(v)) v = `=${expandStructured(v.slice(1), wb, sheet, pk.row)}`; const res = vals[key];
      if (v.startsWith('=') && res?.spillRange) xc.value = { formula: v.slice(1), result: res.value ?? undefined, shareType: 'array', ref: res.spillRange };
      else if (v.startsWith('=')) xc.value = { formula: v.slice(1), result: res?.error ? { error: res.error === '#CYCLE!' || res.error === '#SPILL!' ? '#REF!' : res.error } : res?.value ?? undefined };
      else if (res && typeof res.value === 'number') xc.value = res.value;
      else if (res && typeof res.value === 'boolean') xc.value = res.value;
      else xc.value = v.startsWith("'") ? v.slice(1) : v;
      const s = cell.s || {};
      if (s.b || s.i || s.u || s.fg || s.ff || s.fz) xc.font = { bold: !!s.b, italic: !!s.i, underline: !!s.u, ...(s.fg ? { color: { argb: argb(s.fg) } } : {}), ...(s.ff ? { name: s.ff } : {}), ...(s.fz ? { size: s.fz } : {}) };
      if (s.bg) xc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(s.bg) } };
      if (s.al || s.va || s.wr) xc.alignment = { ...(s.al ? { horizontal: s.al } : {}), ...(s.va ? { vertical: s.va } : {}), ...(s.wr ? { wrapText: true } : {}) };
      if (s.bd) { const line = (v) => ({ style: BORDER_OUT[v] || 'thin', color: { argb: s.bc ? argb(s.bc) : 'FF000000' } }); xc.border = { ...(s.bd.t ? { top: line(s.bd.t) } : {}), ...(s.bd.r ? { right: line(s.bd.r) } : {}), ...(s.bd.b ? { bottom: line(s.bd.b) } : {}), ...(s.bd.l ? { left: line(s.bd.l) } : {}) }; }
      if (s.st || s.vs) xc.font = { ...(xc.font || {}), ...(s.st ? { strike: true } : {}), ...(s.vs ? { vertAlign: s.vs === 'sup' ? 'superscript' : 'subscript' } : {}) };
      if (s.ind || s.rot) xc.alignment = { ...(xc.alignment || {}), ...(s.ind ? { indent: s.ind } : {}), ...(s.rot ? { textRotation: s.rot === 255 ? 'vertical' : s.rot < 0 ? 90 - s.rot : s.rot } : {}) };
      if (s.nf) xc.numFmt = s.nf;
      else if (s.f && NUMFMT(s.f, s.dp)) xc.numFmt = NUMFMT(s.f, s.dp);
      else if (Number.isInteger(s.dp)) xc.numFmt = s.dp ? `0.${'0'.repeat(s.dp)}` : '0';
      if (cell.n?.t) xc.note = cell.n.t;
      if (cell.s?.unl || cell.s?.hf) xc.protection = { locked: !cell.s.unl, hidden: !!cell.s.hf };
      if (cell.l && !v.startsWith('=')) xc.value = { text: v || cell.l, hyperlink: cell.l.startsWith('#') ? `#${cell.l.slice(1)}` : cell.l };
    }
    for (const [key, res] of Object.entries(vals)) if (res?.spill && !sheet.cells[key]) ws.getCell(key).value = res.value ?? null; // spilled results
    for (const m of sheet.merges) { try { ws.mergeCells(m); } catch { /* overlapping merge: skip */ } }
    for (const rule of sheet.dv || []) {
      const type = { list: 'list', whole: 'whole', decimal: 'decimal', date: 'date', textlen: 'textLength', custom: 'custom' }[rule.type];
      const formulae = rule.type === 'list' ? [rule.v1.startsWith('=') ? rule.v1.slice(1) : `"${rule.v1}"`] : [rule.v1, ...(['between', 'notbetween'].includes(rule.op || 'between') && rule.v2 ? [rule.v2] : [])];
      const def = { type, allowBlank: rule.blank !== false, formulae, ...(rule.type !== 'list' ? { operator: { between: 'between', notbetween: 'notBetween', eq: 'equal', ne: 'notEqual', gt: 'greaterThan', lt: 'lessThan', ge: 'greaterThanOrEqual', le: 'lessThanOrEqual' }[rule.op || 'between'] } : {}), showErrorMessage: true, errorStyle: rule.err?.style === 'info' ? 'information' : rule.err?.style || 'stop', ...(rule.err?.title ? { errorTitle: rule.err.title } : {}), ...(rule.err?.text ? { error: rule.err.text } : {}), ...(rule.msg ? { showInputMessage: true, promptTitle: rule.msg.title, prompt: rule.msg.text } : {}) };
      for (const part of rule.range.split(' ')) { const g = parseRange(part); if (!g) continue; for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 2000); r++) for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 100); c++) ws.getCell(cellKey(r, c)).dataValidation = def; }
    }
    if (sheet.filter) ws.autoFilter = sheet.filter.range;
    if (sheet.hidden) ws.state = 'hidden';
    const pr = sheet.print || {};
    ws.pageSetup = { ...ws.pageSetup, ...(pr.area ? { printArea: pr.area } : {}), ...(pr.titles ? { printTitlesRow: pr.titles } : {}), ...(pr.fit ? { fitToPage: true, fitToWidth: 1, fitToHeight: pr.fit === 'page' ? 1 : 0 } : {}), ...(pr.grid === false ? {} : { showGridLines: true }), ...(pr.heads ? { printHeadings: true } : {}) };
    if (sheet.protect) await ws.protect('', { selectLockedCells: sheet.protect.allow?.selectLocked !== false, selectUnlockedCells: true, formatCells: !!sheet.protect.allow?.format, insertRows: !!sheet.protect.allow?.insert, insertColumns: !!sheet.protect.allow?.insert, deleteRows: !!sheet.protect.allow?.delete, deleteColumns: !!sheet.protect.allow?.delete, sort: !!sheet.protect.allow?.sort, autoFilter: !!sheet.protect.allow?.filter });
  }
  for (const [name, ref] of Object.entries(wb.names || {})) { try { book.definedNames.add(ref, name); } catch { /* skip an unusable name */ } }
  let buf = Buffer.from(await book.xlsx.writeBuffer());
  // ExcelJS doesn't write rows that have no cells, so an empty hidden row would lose its "hidden" flag. Add those rows to the sheet XML.
  const missing = wb.sheets.map((sheet) => (sheet.hr || []).filter((r) => !Object.keys(sheet.cells).some((k) => Number(k.replace(/^[A-Z]+/, '')) === r + 1)));
  if (missing.some((m) => m.length)) {
    const zip = await JSZip.loadAsync(buf);
    for (let i = 0; i < wb.sheets.length; i++) {
      if (!missing[i].length) continue;
      const file = `xl/worksheets/sheet${i + 1}.xml`; let xml = await zip.file(file)?.async('string'); if (!xml) continue;
      const rows = [...xml.matchAll(/<row [^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)].map((m) => ({ r: Number(m[1]), xml: m[0] }));
      const have = new Set(rows.map((x) => x.r));
      for (const r of missing[i]) if (!have.has(r + 1)) rows.push({ r: r + 1, xml: `<row r="${r + 1}" hidden="1"/>` });
      rows.sort((a, b) => a.r - b.r);
      const body = rows.map((x) => x.xml).join('');
      xml = /<sheetData\/>/.test(xml) ? xml.replace('<sheetData/>', `<sheetData>${body}</sheetData>`) : xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${body}</sheetData>`);
      zip.file(file, xml);
    }
    buf = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  }
  return buf;
}
