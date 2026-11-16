// Files uploaded into Files (like Google Drive): kept as they are, previewed where possible (pictures, PDFs, video,
// audio, text), downloadable, and Word / Excel / PowerPoint files can be opened as an editable copy.
import { esc } from './util.js';
import { icon } from './icons.js';
import { toast } from './ui.js';
import { state, store } from './store.js';
import { decData } from './markdown.js';

const H = { 'X-Requested-With': 'workspace' };
const OFFICE = /\.(docx|xlsx|csv|pptx)$/i;

/** The uploaded file behind a Files entry: { src, name, mime, size } (or null). */
export function uploadOf(note) {
  const m = /\[\[upload:([A-Za-z0-9_-]+)\]\]/.exec(note?.content || '');
  const d = m ? decData(m[1]) : null;
  return d && /^\/api\/files\/[0-9a-f-]{36}$/.test(d.src || '') ? d : null;
}
export function uploadKind(up) {
  const mime = up?.mime || '', name = up?.name || '';
  if (/^image\/(png|jpe?g|gif|webp|avif)$/.test(mime)) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/^video\//.test(mime)) return 'video';
  if (/^audio\//.test(mime)) return 'audio';
  if (/^text\/|json$|xml$/.test(mime) || /\.(txt|md|csv|json|log)$/i.test(name)) return 'text';
  return 'other';
}
const KIND_ICON = { image: 'image', pdf: 'file', video: 'play', audio: 'play', text: 'file', other: 'file' };
export const uploadIcon = (note) => KIND_ICON[uploadKind(uploadOf(note))] || 'file';
export const canOpenAsEditable = (note) => OFFICE.test(uploadOf(note)?.name || '');
const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);
const officeLabel = (name) => (/\.docx$/i.test(name) ? 'Open as editable document' : /\.(xlsx|csv)$/i.test(name) ? 'Open as editable spreadsheet' : 'Open as editable presentation');

/** The page for an uploaded file: its preview, and Download / Open in new tab / Open as editable. */
export function uploadViewHtml(note) {
  const up = uploadOf(note);
  if (!up) return '<p class="muted">This file is no longer available.</p>';
  const kind = uploadKind(up), url = up.src, view = `${url}?view`;
  const preview = {
    image: `<img class="up-image" src="${esc(url)}" alt="${esc(up.name)}">`,
    pdf: `<iframe class="up-pdf" src="${esc(view)}" title="${esc(up.name)}"></iframe>`,
    video: `<video class="up-media" src="${esc(view)}" controls preload="metadata"></video>`,
    audio: `<audio class="up-audio" src="${esc(view)}" controls preload="metadata"></audio>`,
    text: `<pre class="up-text" data-src="${esc(url)}?download">Loading…</pre>`,
    other: `<div class="up-card">${icon('file', { size: 40 })}<b>${esc(up.name)}</b><span class="muted">${sizeText(up.size || 0)} · This file can’t be previewed here. Download it to open it.</span></div>`,
  }[kind];
  return `<div class="up-view">
    <div class="up-actions">
      <span class="up-meta">${esc(up.name)} · ${sizeText(up.size || 0)}</span>
      ${canOpenAsEditable(note) ? `<button type="button" class="btn btn-primary btn-sm" data-action="convert-upload" data-id="${note.id}">${icon('edit', { size: 16 })}${officeLabel(up.name)}</button>` : ''}
      ${['image', 'pdf', 'video', 'audio'].includes(kind) ? `<a class="btn btn-outline btn-sm" href="${esc(kind === 'image' ? url : view)}" target="_blank" rel="noopener">${icon('open', { size: 16 })}Open in new tab</a>` : ''}
      <a class="btn btn-outline btn-sm" href="${esc(url)}?download" download="${esc(up.name)}">${icon('download', { size: 16 })}Download</a>
    </div>
    <div class="up-preview up-kind-${kind}">${preview}</div>
  </div>`;
}
/** Text previews are loaded after the page is drawn (shown as plain text, never as a web page). */
export async function hydrateUploadView(root) {
  const pre = root.querySelector('.up-text[data-src]'); if (!pre) return;
  try {
    const res = await fetch(pre.dataset.src, { headers: H }); const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(buf.slice(0, 512 * 1024));
    pre.textContent = text + (buf.byteLength > 512 * 1024 ? '\n\n… (download the file to see the rest)' : '');
  } catch { pre.textContent = 'Couldn’t load this file.'; }
}

/** Upload files into Files (into the open folder, if any). Office files are converted when that setting is on. */
export async function uploadFiles(list, { folderId = null } = {}) {
  const files = [...(list || [])]; if (!files.length) return [];
  const convert = !!state.settings?.convertUploads; const made = []; const failed = [];
  const progress = toast(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`, { duration: 120000 });
  for (const f of files) {
    try {
      const res = await fetch('/api/uploads', { method: 'POST', headers: { ...H, 'X-File-Name': encodeURIComponent(f.name), 'X-File-Type': f.type || 'application/octet-stream', ...(folderId ? { 'X-Folder-Id': folderId } : {}) }, body: f });
      const note = await res.json(); if (!res.ok) throw new Error(note.error || 'Upload failed');
      if (convert && OFFICE.test(f.name)) {
        const c = await fetch(`/api/notes/${note.id}/convert`, { method: 'POST', headers: H });
        if (c.ok) { made.push(await c.json()); await fetch(`/api/notes/${note.id}`, { method: 'DELETE', headers: H }); continue; } // the original goes to Deleted (restorable)
      }
      made.push(note);
    } catch (err) { failed.push(`${f.name}: ${err.message}`); }
  }
  await store.load(); window.dispatchEvent(new Event('app:rerender')); progress?.();
  if (failed.length) toast(failed.length === files.length ? `Couldn’t upload: ${failed.join('; ')}` : `Uploaded ${made.length}; couldn’t upload ${failed.join('; ')}`, { tone: 'error' });
  else toast(`Uploaded ${made.length} file${made.length === 1 ? '' : 's'}`);
  return made;
}

/** Open as editable: an editable document / spreadsheet / presentation copy beside the original. */
export async function convertUpload(id) {
  const progress = toast('Converting…', { duration: 120000 });
  const res = await fetch(`/api/notes/${id}/convert`, { method: 'POST', headers: H }); const out = await res.json().catch(() => ({})); progress?.();
  if (!res.ok) { toast(out.error || 'Couldn’t convert this file', { tone: 'error' }); return null; }
  await store.load(); location.hash = `#/files/${out.id}`; toast('Opened as an editable copy. The original is unchanged.');
  return out;
}

/** Drag files onto the Files page to upload them. */
export function installDropZone(getFolder) {
  let depth = 0; let overlay = null;
  const onFiles = () => location.hash.replace(/\/$/, '') === '#/files' || location.hash === '' || location.hash === '#/';
  const show = (on) => { if (on && !overlay) { overlay = document.createElement('div'); overlay.className = 'drop-overlay'; overlay.innerHTML = `<div>${icon('upload', { size: 28 })}<b>Drop files to upload</b><span>They’ll be added to ${getFolder() ? 'this folder' : 'Files'}</span></div>`; document.body.appendChild(overlay); } if (!on && overlay) { overlay.remove(); overlay = null; } };
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => { if (!hasFiles(e) || !onFiles()) return; depth += 1; show(true); });
  document.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) show(false); });
  document.addEventListener('dragover', (e) => { if (hasFiles(e) && onFiles()) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (!hasFiles(e) || !onFiles()) return; e.preventDefault(); depth = 0; show(false); uploadFiles(e.dataTransfer.files, { folderId: getFolder() }); });
}
