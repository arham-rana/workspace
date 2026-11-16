// Files from the app embedded in documents and presentations: shared helpers for the browser and the server.
// A linked embed stores only { id, kind, title, part } — the file itself is fetched (with an access check) when shown.
export const FILE_KINDS = { note: 'Document', sheet: 'Spreadsheet', slides: 'Presentation' };
const enc = (o) => (typeof Buffer !== 'undefined' ? Buffer.from(JSON.stringify(o)).toString('base64url') : btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
const dec = (b) => { try { const s = typeof Buffer !== 'undefined' ? Buffer.from(b, 'base64url').toString('utf8') : decodeURIComponent(escape(atob(b.replace(/-/g, '+').replace(/_/g, '/')))); return JSON.parse(s); } catch { return null; } };
export const encodeData = enc; export const decodeData = dec;

/** A linked embed's settings, cleaned. part: { sheet, range } for a spreadsheet range, { slide } for one slide. */
export function cleanRef(d) {
  if (!d || typeof d !== 'object' || !/^[0-9a-f-]{36}$/.test(String(d.id || ''))) return null;
  const kind = ['note', 'sheet', 'slides'].includes(d.kind) ? d.kind : 'note';
  const p = d.part && typeof d.part === 'object' ? d.part : null;
  const range = String(p?.range || '').toUpperCase().replace(/\s+/g, '');
  const part = kind === 'sheet' && /^\$?[A-Z]{1,2}\$?\d{1,6}(:\$?[A-Z]{1,2}\$?\d{1,6})?$/.test(range) ? { sheet: String(p.sheet || '').slice(0, 100), range } // a proper range, or the whole sheet
    : kind === 'slides' && (p?.slide || Number.isInteger(p?.n)) ? { slide: String(p.slide || '').slice(0, 64), ...(Number.isInteger(p.n) ? { n: p.n } : {}) } : null; // by id, with its position as a fallback
  return { id: d.id, kind, title: String(d.title || 'Untitled').slice(0, 200), ...(part ? { part } : {}) };
}

/** The spreadsheet or presentation inside a file's content. */
export function blockOf(content, kind) {
  const m = new RegExp(`\\[\\[${kind === 'slides' ? 'slides' : 'sheet'}:([A-Za-z0-9_-]+)\\]\\]`).exec(content || '');
  return m ? dec(m[1]) : null;
}

/** A range of a spreadsheet as its own small workbook: the values people see (formulas would point outside the
 *  range) with their formatting and column widths. E is the spreadsheet engine. */
export function sheetRange(E, data, part) {
  const wb = E.normalizeWorkbook(data);
  const sh = wb.sheets.find((s) => s.name === part?.sheet) || wb.sheets.find((s) => !s.hidden) || wb.sheets[0];
  if (!sh) return { sheets: [] };
  const vals = E.evaluateWorkbook(wb)[sh.name] || {};
  let g = null; try { g = E.parseRange(String(part?.range || '').replace(/\$/g, '')); } catch { g = null; }
  if (!g) return { sheets: [sh] };
  const cells = {}, w = {};
  for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 499); r++) for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 51); c++) {
    const v = vals[E.cellKey(r, c)]; const src = sh.cells[E.cellKey(r, c)];
    if (!src && (v?.value === null || v?.value === undefined)) continue;
    const value = v?.error ? v.error : v?.value === null || v?.value === undefined ? '' : String(v.value);
    cells[E.cellKey(r - g.r1, c - g.c1)] = { v: value, ...(src?.s ? { s: src.s } : {}) };
    const col = E.colName(c); if (sh.w?.[col]) w[E.colName(c - g.c1)] = sh.w[col];
  }
  return { sheets: [{ name: sh.name, cells, w, r: Math.max(1, g.r2 - g.r1 + 1), c: Math.max(1, g.c2 - g.c1 + 1) }] };
}

/** One slide of a presentation, as a presentation (theme and deck settings kept). */
export function deckSlide(deck, part) {
  if (!deck || !Array.isArray(deck.slides)) return deck;
  const s = deck.slides.find((x) => x.id === part?.slide) || deck.slides[part?.n ?? 0] || deck.slides[0];
  return { ...deck, slides: s ? [s] : [] };
}

/** A document's text with links to other files shown as plain mentions (so previews never embed recursively). */
export function withoutFileLinks(md) {
  return String(md || '').replace(/^[ \t]*\[\[file:([A-Za-z0-9_-]+)\]\][ \t]*$/gm, (m, b) => { const d = dec(b); return d ? `*${FILE_KINDS[d.kind] || 'File'}: ${String(d.title || 'Untitled').replace(/[*_[\]]/g, '')}*` : ''; });
}
/** Plain text of a document (for a text box on a slide). */
export function plainOf(md) {
  return withoutFileLinks(md).replace(/^[ \t]*\[\[[a-z]+:[A-Za-z0-9_-]+\]\][ \t]*$/gm, '').replace(/^#{1,6}\s+/gm, '').replace(/^[ \t]*[-*+][ \t]+(\[[ x]\][ \t]+)?/gm, '• ').replace(/[*_`~]+/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}
