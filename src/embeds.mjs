// Linked files inside documents, resolved on the server: for embedding (with an access check) and for exports
// (Word, printing, Markdown), where each link becomes a snapshot of the file as it is now.
import crypto from 'node:crypto';
import { cleanRef, decodeData, encodeData, blockOf, sheetRange, deckSlide, withoutFileLinks, plainOf, FILE_KINDS } from '../shared/embeds.mjs';
import * as E from '../shared/sheet-engine.mjs';

/** A file for embedding, if this person may open it (else null: the same answer whether it's missing or not shared). */
export function embedFor({ db, collab }, noteId, uid) {
  const note = db.get('notes', noteId, uid);
  if (!note) return null;
  const content = collab?.liveMarkdown(note.id) ?? note.content ?? ''; // the latest, even between batched saves
  return { id: note.id, title: note.title || 'Untitled', kind: note.kind || 'note', updatedAt: note.updatedAt, content, etag: `"${crypto.createHash('sha1').update(content).update(note.title || '').digest('base64url')}"` };
}

/** A document's text with each linked file replaced by a snapshot (or a "no access" line). */
export function resolveEmbeds(ctx, content, uid) {
  return String(content || '').replace(/^[ \t]*\[\[file:([A-Za-z0-9_-]+)\]\][ \t]*$/gm, (m, b) => {
    const ref = cleanRef(decodeData(b)); if (!ref) return '';
    const f = embedFor(ctx, ref.id, uid);
    const label = `${FILE_KINDS[ref.kind] || 'File'}: ${(f?.title || ref.title).replace(/[*_[\]]/g, '')}`;
    if (!f) return `*${label} (not available to you)*`;
    if (f.kind === 'sheet') { const d = blockOf(f.content, 'sheet'); if (!d) return `*${label}*`; return `**${label}**\n\n[[sheet:${encodeData(ref.part ? sheetRange(E, d, ref.part) : d)}]]`; }
    if (f.kind === 'slides') { const d = blockOf(f.content, 'slides'); if (!d) return `*${label}*`; return `**${label}**\n\n[[slides:${encodeData(ref.part ? deckSlide(d, ref.part) : d)}]]`; }
    return `**${label}**\n\n${withoutFileLinks(f.content)}`;
  });
}

/** A linked file on a slide, as a snapshot for PowerPoint: a spreadsheet becomes a table, a document its text,
 *  a presentation a text box naming it (with "not available" when this person can't open it). */
export function fileItemSnapshot(ctx, it, uid) {
  const ref = cleanRef(it.ref); const box = { id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, z: it.z, rot: it.rot };
  const f = ref && embedFor(ctx, ref.id, uid);
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const label = `${FILE_KINDS[ref?.kind] || 'File'}: ${f?.title || ref?.title || 'Untitled'}`;
  if (!f) return { ...box, t: 'text', html: `<div>${esc(label)} (not available)</div>`, fs: 16 };
  if (f.kind === 'sheet') {
    const d = blockOf(f.content, 'sheet');
    if (d) {
      const wb = E.normalizeWorkbook(ref.part ? sheetRange(E, d, ref.part) : d); const sh = wb.sheets.find((x) => !x.hidden) || wb.sheets[0];
      const shown = sh ? E.displayWorkbook(wb)[sh.name] || {} : {}; let rows = 1, cols = 1;
      for (const k of Object.keys(sh?.cells || {})) { const p = E.parseKey(k); if (p) { rows = Math.max(rows, p.row + 1); cols = Math.max(cols, p.col + 1); } }
      rows = Math.min(rows, 20); cols = Math.min(cols, 8);
      return { ...box, t: 'table', rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ html: esc(shown[E.cellKey(r, c)]?.text ?? '') }))), colW: Array(cols).fill(Math.round(it.w / cols)), rowH: Array(rows).fill(Math.max(18, Math.round(it.h / rows))), bc: '#9aa0a6', bw: 1, fs: 12 };
    }
  }
  if (f.kind === 'note') { const text = plainOf(f.content).slice(0, 1500); return { ...box, t: 'text', html: `<div><b>${esc(f.title || 'Untitled')}</b></div>${text.split('\n').map((l) => `<div>${esc(l) || '<br>'}</div>`).join('')}`, fs: 12 }; }
  return { ...box, t: 'text', html: `<div>${esc(label)}</div>`, fs: 16 };
}
