// "Download everything": a zip with the restorable backup (backup.json), the person's uploaded files,
// and readable copies of their work (documents as Markdown, spreadsheets as Excel, presentations as PowerPoint).
// Importing the zip restores everything, including the files (they get new ids, and every reference is updated).
import fs from 'node:fs';
import JSZip from 'jszip';
import { exportSheet } from './sheets.mjs';
import { exportPptx } from './slides.mjs';
import { workbookRows } from '../shared/sheet-engine.mjs';
import { normalizeDeck, plainText } from '../shared/slides-engine.mjs';

const TOKEN = /\[\[(\w+):([A-Za-z0-9_-]+)\]\]/g;
const decode = (b) => { try { return JSON.parse(Buffer.from(b, 'base64url').toString('utf8')); } catch { return null; } };
const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const safeName = (s) => (String(s || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 80) || 'Untitled');
const mdCell = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** A document's text with spreadsheet and presentation blocks turned into tables and outlines. */
export function readableMarkdown(content) {
  return String(content || '').replace(TOKEN, (m, kind, b) => {
    const d = decode(b);
    if (kind === 'sheet' && d) {
      try {
        return workbookRows(d).map((s) => {
          if (!s.rows.length) return `**${s.name}** (empty)`;
          const [head, ...rest] = s.rows;
          return `**${s.name}**\n\n| ${head.map(mdCell).join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${rest.map((r) => `| ${r.map(mdCell).join(' | ')} |`).join('\n')}`;
        }).join('\n\n');
      } catch { return '[spreadsheet]'; }
    }
    if (kind === 'slides' && d) {
      try { return normalizeDeck(d).slides.map((s, i) => `**Slide ${i + 1}**\n\n${s.items.map((x) => (x.html ? plainText(x.html).trim() : x.t === 'wordart' ? x.text : '')).filter(Boolean).join('\n\n')}`).join('\n\n'); } catch { return '[presentation]'; }
    }
    return `[${kind}]`;
  });
}

/** Build the zip for one person. */
export async function exportEverything({ db, uid, filePath }) {
  const payload = db.exportAll(uid);
  const files = db.listFiles(uid).map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, noteId: f.noteId || null }));
  payload.files = files;
  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify(payload, null, 1));
  const own = new Map(files.map((f) => [f.id, f]));
  for (const f of files) { const p = filePath(f.id); if (fs.existsSync(p)) zip.file(`files/${f.id}`, fs.readFileSync(p), { compression: 'STORE' }); }
  // readable copies, in the same folders as in the app
  const folders = new Map((payload.folders || []).map((f) => [f.id, f]));
  const folderPath = (id, depth = 0) => { const f = folders.get(id); if (!f || depth > 10) return ''; return `${folderPath(f.parentId, depth + 1)}${safeName(f.name)}/`; };
  const noteFolder = new Map((payload.noteFolders || []).map((x) => [x.noteId, x.folderId]));
  const used = new Set();
  const unique = (p) => { let out = p; let n = 2; while (used.has(out.toLowerCase())) { out = p.replace(/(\.[^.]+)$/, ` (${n})$1`); n += 1; } used.add(out.toLowerCase()); return out; };
  const readImage = async (src) => { const id = /\/api\/files\/([0-9a-f-]{36})/.exec(src || '')?.[1]; const f = id && own.get(id); if (!f || !fs.existsSync(filePath(id))) return null; return { data: `${f.mime};base64,${fs.readFileSync(filePath(id)).toString('base64')}` }; };
  for (const n of payload.notes) {
    const dir = `documents/${folderPath(noteFolder.get(n.id))}`; const base = safeName(n.title);
    if (n.kind === 'upload') { // an uploaded file: the file itself
      const up = /\[\[upload:([A-Za-z0-9_-]+)\]\]/.exec(n.content || ''); let d = null; try { d = up && JSON.parse(Buffer.from(up[1], 'base64url').toString()); } catch { d = null; }
      const fid = /\/api\/files\/([0-9a-f-]{36})/.exec(d?.src || '')?.[1];
      if (fid && own.has(fid) && fs.existsSync(filePath(fid))) zip.file(unique(`${dir}${safeName(d.name || n.title)}`), fs.readFileSync(filePath(fid)), { compression: 'STORE' });
      continue;
    }
    try {
      const m = /\[\[(sheet|slides):([A-Za-z0-9_-]+)\]\]/.exec(n.content || '');
      if (n.kind === 'sheet' && m) { zip.file(unique(`${dir}${base}.xlsx`), await exportSheet(decode(m[2]), 'xlsx')); continue; }
      if (n.kind === 'slides' && m) { zip.file(unique(`${dir}${base}.pptx`), await exportPptx(decode(m[2]), { readImage, title: base })); continue; }
    } catch { /* fall back to Markdown */ }
    zip.file(unique(`${dir}${base}.md`), `# ${n.title || 'Untitled'}\n\n${readableMarkdown(n.content)}\n`);
  }
  zip.file('README.txt', [
    'Your data.',
    '',
    'backup.json + files/              Everything, restorable: Settings → Your data → Restore, and choose this zip.',
    'documents/                        Readable copies: documents as Markdown, spreadsheets as Excel, presentations as PowerPoint.',
    '',
    `Exported ${payload.exportedAt}: ${payload.notes.length} documents, ${files.length} files.`,
  ].join('\n'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Replace file ids everywhere in a document's content, including inside spreadsheet and presentation blocks. */
export function remapFiles(text, map) {
  if (!text || !map.size) return text;
  const swap = (s) => s.replace(/\/api\/files\/([0-9a-f-]{36})/g, (m, id) => (map.has(id) ? `/api/files/${map.get(id)}` : m));
  return swap(String(text).replace(TOKEN, (m, kind, b) => { const d = decode(b); if (!d) return m; const out = swap(JSON.stringify(d)); return out === JSON.stringify(d) ? m : `[[${kind}:${encode(JSON.parse(out))}]]`; }));
}

/** Restore from a "Download everything" zip. */
export async function importEverything({ db, uid, buffer, writeFile }) {
  let zip;
  const { guardZip } = await import('./zip-guard.mjs');
  zip = await guardZip(buffer, { label: 'backup', maxEntryMb: 1024, maxTotalMb: Math.max(2048, Math.ceil((buffer.length / 1048576) * 3)) }); // zip bombs (uploaded files are stored, not compressed)
  // backup.json (zips made before it was renamed hold the same data under its earlier name)
  const entry = zip.file('backup.json') || zip.file(`${['still', 'point'].join('')}-backup.json`);
  if (!entry) throw Object.assign(new Error('This zip has no backup.json, so it isn’t a backup from this app'), { status: 400 });
  let payload; try { payload = JSON.parse(await entry.async('string')); } catch { throw Object.assign(new Error('The backup data in the zip is damaged'), { status: 400 }); }
  const map = new Map(); const attach = [];
  for (const f of Array.isArray(payload.files) ? payload.files : []) {
    const z = /^[0-9a-f-]{36}$/.test(f?.id || '') && zip.file(`files/${f.id}`); if (!z) continue;
    const data = await z.async('nodebuffer');
    const info = db.createFile(uid, { noteId: null, name: String(f.name || 'file').slice(0, 200), mime: String(f.mime || 'application/octet-stream').slice(0, 100), size: data.length });
    writeFile(info.id, data); map.set(f.id, info.id); if (f.noteId) attach.push([info.id, f.noteId]);
  }
  if (Array.isArray(payload.notes)) payload.notes = payload.notes.map((n) => ({ ...n, content: remapFiles(n.content, map) }));
  const result = db.importAll(uid, payload);
  for (const [fid, nid] of attach) db.attachFile(fid, result.noteIds?.[nid] || nid, uid); // documents may have new ids here
  const { noteIds, ...rest } = result; void noteIds;
  return { ...rest, files: map.size };
}
