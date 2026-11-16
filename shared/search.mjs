// Searching inside files: document text (and spreadsheets/presentations embedded in it), spreadsheet cells and sheet
// names, slide text and speaker notes, uploaded file names. Each file is read once per version (remembered).
import { decodeData } from './embeds.mjs';

const strip = (html) => String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li|tr|td|th)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const mdPlain = (md) => String(md || '').replace(/^\s*\[\[[a-z]+:[A-Za-z0-9_-]+\]\]\s*$/gm, ' ').replace(/\{\{[^|}]*\|([^}]*)\}\}/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^#{1,6}\s+|^\s*[-*+]\s+(\[[ x]\]\s+)?|^\s*\d+\.\s+|^>\s?/gm, '').replace(/[*_`~|]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The places in a file that can be found: [{ text, label?, goto? }] (label/goto say where: a cell or a slide). */
function partsOf(note) {
  const parts = [{ text: [note.title, note.tag, note.summary].filter(Boolean).join(' '), label: '' }];
  const content = note.content || '';
  const sheetParts = (wb) => { for (const sh of wb?.sheets || []) { if (sh.hidden) continue; parts.push({ text: sh.name, label: sh.name, goto: { type: 'cell', sheet: sh.id, cell: 'A1' } }); for (const [k, c] of Object.entries(sh.cells || {})) { const v = c?.v; if (v === undefined || v === '' || v === null) continue; parts.push({ text: String(v), label: `${sh.name}!${k}`, goto: { type: 'cell', sheet: sh.id, cell: k } }); } } };
  const deckParts = (deck) => (deck?.slides || []).forEach((s, i) => {
    for (const it of s.items || []) { const t = it.t === 'wordart' ? it.text : it.t === 'table' ? (it.rows || []).flat().map((c) => strip(c?.html)).join(' ') : strip(it.html); if (t) parts.push({ text: t, label: `Slide ${i + 1}`, goto: { type: 'item', slide: s.id, item: it.id } }); }
    if (s.notes) parts.push({ text: strip(s.notes), label: `Slide ${i + 1} notes`, goto: { type: 'item', slide: s.id, item: '' } });
  });
  if (note.kind === 'upload') { const m = /\[\[upload:([A-Za-z0-9_-]+)\]\]/.exec(content); const d = m && decodeData(m[1]); if (d?.name) parts.push({ text: d.name, label: '' }); return parts; }
  if (note.kind === 'sheet' || note.kind === 'slides') {
    const m = new RegExp(`\\[\\[${note.kind}:([A-Za-z0-9_-]+)\\]\\]`).exec(content); const d = m && decodeData(m[1]);
    if (note.kind === 'sheet') sheetParts(d); else deckParts(d);
    return parts;
  }
  parts.push({ text: mdPlain(content), label: '' });
  for (const m of content.matchAll(/^\s*\[\[(sheet|slides):([A-Za-z0-9_-]+)\]\]\s*$/gm)) { const d = decodeData(m[2]); if (m[1] === 'sheet') sheetParts(d); else deckParts(d); } // blocks inside the document
  for (const p of parts) if (p.goto && note.kind !== 'sheet' && note.kind !== 'slides') delete p.goto; // inside a document: open the document
  return parts;
}

const memo = new Map(); // note id → { key, parts, all }
function indexOf(note) {
  const key = `${note.updatedAt}|${(note.content || '').length}|${note.title}|${note.tag}|${note.summary}`;
  const hit = memo.get(note.id); if (hit?.key === key) return hit;
  const parts = partsOf(note).map((p) => ({ ...p, low: p.text.toLowerCase() }));
  const entry = { key, parts, all: parts.map((p) => p.low).join('\n') }; memo.set(note.id, entry); if (memo.size > 5000) memo.delete(memo.keys().next().value);
  return entry;
}

/** Does this file contain the (lower-case) query anywhere? */
export const fileMatches = (note, q) => !q || indexOf(note).all.includes(q);
/** Where the query was found first: { label, snippet, goto } (null when it isn't there). Title matches come first. */
export function findInFile(note, q) {
  if (!q) return null;
  for (const p of indexOf(note).parts) {
    const i = p.low.indexOf(q); if (i < 0) continue;
    const from = Math.max(0, i - 30); const snippet = `${from ? '…' : ''}${p.text.slice(from, i + q.length + 50).trim()}${i + q.length + 50 < p.text.length ? '…' : ''}`;
    return { label: p.label, snippet, goto: p.goto || null };
  }
  return null;
}
