// Files from the app embedded in documents and presentations: fetching (with the server's access check), drawing
// the embed card, keeping linked files up to date, and the picker used by Insert → Existing file.
import { esc } from './util.js';
import { icon } from './icons.js';
import { openModal } from './ui.js';
import { state } from './store.js';
import { renderNote } from './markdown.js';
import { loadSheetEngine, sheetEngine } from './sheet-lazy.js';
import { staticSheetHtml } from './sheet-core.js';
import { staticDeckHtml } from './slides.js';
import { FILE_KINDS, cleanRef, blockOf, sheetRange, deckSlide, withoutFileLinks } from '/shared/embeds.mjs';

const KIND_ICON = { note: 'file', sheet: 'table', slides: 'presentation' };
const cache = new Map(); // id → { etag, data }

/** The file for embedding, or null when this person can't open it (or it no longer exists). */
export async function fetchEmbed(id, { fresh = false } = {}) {
  const hit = cache.get(id);
  try {
    const res = await fetch(`/api/notes/${id}/embed`, { headers: { 'X-Requested-With': 'workspace', ...(hit?.etag && !fresh ? { 'If-None-Match': hit.etag } : {}) } });
    if (res.status === 304 && hit) return { ...hit.data, changed: false };
    if (!res.ok) { cache.delete(id); return null; }
    const data = await res.json(); cache.set(id, { etag: res.headers.get('ETag'), data });
    return { ...data, changed: true };
  } catch { return hit ? { ...hit.data, changed: false } : null; } // offline: keep what we had
}

export const partLabel = (ref) => (ref.part?.range ? `${ref.part.sheet ? `${ref.part.sheet}!` : ''}${ref.part.range}` : ref.part?.slide ? `Slide ${(ref.part.n ?? 0) + 1}` : '');

/** The preview inside the card. */
async function bodyHtml(ref, f) {
  if (f.kind === 'sheet') {
    const d = blockOf(f.content, 'sheet'); if (!d) return '<p class="fe-empty">This spreadsheet is empty.</p>';
    await loadSheetEngine();
    return `<div class="fe-sheet">${staticSheetHtml(JSON.stringify(ref.part ? sheetRange(sheetEngine(), d, ref.part) : d))}</div>`;
  }
  if (f.kind === 'slides') {
    const d = blockOf(f.content, 'slides'); if (!d?.slides?.length) return '<p class="fe-empty">This presentation has no slides.</p>';
    const slides = ref.part ? deckSlide(d, ref.part).slides : d.slides;
    return `<div class="fe-deck" data-i="0" data-n="${slides.length}">${slides.map((s, i) => `<div class="fe-slide" data-i="${i}"${i ? ' hidden' : ''}>${staticDeckHtml(JSON.stringify({ ...d, slides: [s] }))}</div>`).join('')}
      ${slides.length > 1 ? `<div class="fe-deck-nav"><button type="button" class="icon-btn" data-fe="prev" aria-label="Previous slide">${icon('chevronLeft', { size: 16 })}</button><span class="fe-count">1 / ${slides.length}</span><button type="button" class="icon-btn" data-fe="next" aria-label="Next slide">${icon('chevronRight', { size: 16 })}</button></div>` : ''}</div>`;
  }
  return `<div class="fe-doc prose">${renderNote(withoutFileLinks(f.content), { readOnly: true })}</div>`;
}

function cardHtml(ref, { title, body, state: st, copy = false }) {
  const p = partLabel(ref);
  return `<div class="fe-head">
      <span class="fe-ic" aria-hidden="true">${icon(KIND_ICON[ref.kind] || 'file', { size: 16 })}</span>
      <span class="fe-title">${esc(title || ref.title)}</span>
      <span class="fe-badge">${FILE_KINDS[ref.kind] || 'File'}${p ? ` · ${esc(p)}` : ''} · Linked</span>
      ${st === 'ok' && copy ? '<button type="button" class="btn btn-ghost btn-sm fe-copy" data-fe="copy" title="Replace the link with an editable copy">Make a copy here</button>' : ''}${st === 'ok' ? `<button type="button" class="icon-btn fe-refresh" data-fe="refresh" title="Refresh" aria-label="Refresh">${icon('refresh', { size: 15 })}</button><a class="btn btn-ghost btn-sm fe-open" href="#/files/${ref.id}" data-fe="open">Open</a>` : ''}
    </div>
    <div class="fe-body">${body}</div>`;
}

/** Draw a linked file into `dom` and keep it up to date while it's on screen. Returns { destroy }. */
export function mountFileEmbed(dom, data, { compact = false, onCopy = null, canCopy = () => false } = {}) {
  let ref = null; try { ref = cleanRef(typeof data === 'string' ? JSON.parse(data) : data); } catch { ref = null; }
  dom.classList.add('file-embed'); if (compact) dom.classList.add('fe-compact');
  if (!ref) { dom.innerHTML = cardHtml({ kind: 'note', title: 'File' }, { body: '<p class="fe-empty">This embedded file is damaged.</p>' }); return { destroy() {} }; }
  dom.innerHTML = cardHtml(ref, { body: '<p class="fe-empty">Loading…</p>' });
  let alive = true, timer = null;
  const draw = async (fresh = false) => {
    const f = await fetchEmbed(ref.id, { fresh });
    if (!alive) return;
    if (!f) { dom.dataset.state = 'none'; dom.innerHTML = cardHtml(ref, { body: `<p class="fe-empty">${icon('lock', { size: 15 })} You don’t have access to this ${(FILE_KINDS[ref.kind] || 'file').toLowerCase()}, or it was deleted. Ask its owner to share it with you.</p>`, state: 'none' }); return; }
    if (!f.changed && dom.dataset.state === 'ok') return; // unchanged since last time
    dom.dataset.state = 'ok';
    dom.innerHTML = cardHtml(ref, { title: f.title, body: await bodyHtml(ref, f), state: 'ok', copy: !!onCopy && canCopy() });
  };
  dom.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fe]'); if (!b) return;
    if (b.dataset.fe === 'refresh') { e.preventDefault(); draw(true); }
    if (b.dataset.fe === 'copy') { e.preventDefault(); onCopy?.(); }
    if (b.dataset.fe === 'prev' || b.dataset.fe === 'next') {
      e.preventDefault(); const deck = dom.querySelector('.fe-deck'); const n = Number(deck.dataset.n); const i = (Number(deck.dataset.i) + (b.dataset.fe === 'next' ? 1 : n - 1)) % n;
      deck.dataset.i = String(i); deck.querySelectorAll('.fe-slide').forEach((s) => { s.hidden = Number(s.dataset.i) !== i; }); deck.querySelector('.fe-count').textContent = `${i + 1} / ${n}`;
    }
  });
  draw();
  // live: check for changes while shown (the server answers "unchanged" cheaply), and when the tab comes back
  const tick = () => { if (!alive) return; if (!dom.isConnected) { stop(); return; } if (document.visibilityState === 'visible') draw(); };
  timer = setInterval(tick, 15000);
  const onVis = () => { if (document.visibilityState === 'visible') tick(); };
  document.addEventListener('visibilitychange', onVis);
  const stop = () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  return { destroy: stop };
}

/** Linked files in a rendered (read-only) document. */
export function hydrateFileEmbeds(root) {
  for (const el of root.querySelectorAll('.file-embed[data-file]:not([data-hydrated])')) { el.dataset.hydrated = '1'; mountFileEmbed(el, el.dataset.file); }
}

/** Insert → Existing file: choose a file, link or copy, whole file or a part.
 *  Resolves to { mode: 'link'|'copy', ref, file } or null. `exclude`: the document being edited (no self-embedding). */
export function pickFile({ exclude = null, title = 'Insert an existing file' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const files = state.notes.filter((n) => n.id !== exclude && !n.deletedAt && n.kind !== 'upload'); // uploaded files aren't embedded
    files.sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || '') || (b.updatedAt || '').localeCompare(a.updatedAt || '')); // recently opened first
    openModal({
      title, size: 'md',
      body: `<div class="fp">
        <div class="fp-top"><input type="search" class="input fp-q" placeholder="Search documents, spreadsheets and presentations" aria-label="Search files">
          <div class="fp-kinds" role="radiogroup" aria-label="Type">${[['', 'All'], ['note', 'Documents'], ['sheet', 'Spreadsheets'], ['slides', 'Presentations']].map(([k, l], i) => `<label class="fp-kind"><input type="radio" name="fpk" value="${k}"${i ? '' : ' checked'}> ${l}</label>`).join('')}</div></div>
        <ul class="fp-list" role="listbox" aria-label="Files"></ul>
        <div class="fp-opts" hidden>
          <fieldset><legend>Insert as</legend>
            <label class="opt"><input type="radio" name="mode" value="link" checked><span class="opt-text"><b>Link</b><small>Always shows the latest version. Edit the original to change it.</small></span></label>
            <label class="opt"><input type="radio" name="mode" value="copy"><span class="opt-text"><b>Copy</b><small>Becomes part of this file. You can edit it, and it won’t change.</small></span></label></fieldset>
          <fieldset class="fp-part" hidden><legend>What to embed</legend>
            <label><input type="radio" name="part" value="whole" checked> <span class="fp-whole">The whole file</span></label>
            <label class="fp-part-sheet" hidden><input type="radio" name="part" value="range"> A range: <select class="select fp-sheet" aria-label="Sheet"></select> <input class="input fp-range" value="A1:F20" aria-label="Range" size="10"></label>
            <label class="fp-part-slide" hidden><input type="radio" name="part" value="slide"> One slide: <select class="select fp-slide" aria-label="Slide"></select></label></fieldset>
        </div></div>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary fp-ok" disabled>Insert</button>',
      onMount: (el, close) => {
        const q = el.querySelector('.fp-q'), list = el.querySelector('.fp-list'), opts = el.querySelector('.fp-opts'), ok = el.querySelector('.fp-ok');
        let chosen = null;
        const draw = () => {
          const kind = el.querySelector('[name=fpk]:checked').value, t = q.value.trim().toLowerCase();
          const shown = files.filter((n) => (!kind || (n.kind || 'note') === kind) && (!t || (n.title || 'Untitled').toLowerCase().includes(t))).slice(0, 200);
          list.innerHTML = shown.length ? shown.map((n) => `<li role="option" tabindex="0" aria-selected="${chosen?.id === n.id}" class="fp-item${chosen?.id === n.id ? ' on' : ''}" data-id="${n.id}">${icon(KIND_ICON[n.kind || 'note'], { size: 16 })}<span>${esc(n.title || 'Untitled')}</span><small>${FILE_KINDS[n.kind || 'note']}</small></li>`).join('') : '<li class="fp-none">No matching files</li>';
        };
        const choose = async (id) => {
          chosen = files.find((n) => n.id === id); if (!chosen) return; draw(); ok.disabled = false; opts.hidden = false;
          const kind = chosen.kind || 'note', part = el.querySelector('.fp-part');
          part.hidden = kind === 'note'; el.querySelector('.fp-part-sheet').hidden = kind !== 'sheet'; el.querySelector('.fp-part-slide').hidden = kind !== 'slides';
          el.querySelector('[name=part][value=whole]').checked = true;
          el.querySelector('.fp-whole').textContent = kind === 'sheet' ? 'The whole spreadsheet' : 'The whole presentation';
          if (kind === 'sheet') { const d = blockOf(chosen.content, 'sheet'); el.querySelector('.fp-sheet').innerHTML = (d?.sheets || []).filter((s) => !s.hidden).map((s) => `<option>${esc(s.name)}</option>`).join(''); }
          if (kind === 'slides') { const d = blockOf(chosen.content, 'slides'); el.querySelector('.fp-slide').innerHTML = (d?.slides || []).map((s, i) => { const t2 = (s.items || []).find((x) => x.role === 'title')?.html?.replace(/<[^>]+>/g, '').trim(); return `<option value="${i}">${i + 1}${t2 ? ` — ${esc(t2.slice(0, 50))}` : ''}</option>`; }).join(''); }
        };
        q.addEventListener('input', draw); el.querySelectorAll('[name=fpk]').forEach((r) => r.addEventListener('change', draw));
        list.addEventListener('click', (e) => { const li = e.target.closest('[data-id]'); if (li) choose(li.dataset.id); });
        list.addEventListener('keydown', (e) => { const li = e.target.closest('[data-id]'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(li.dataset.id); } });
        el.querySelector('.fp-range').addEventListener('focus', () => { el.querySelector('[name=part][value=range]').checked = true; });
        el.querySelector('.fp-sheet').addEventListener('change', () => { el.querySelector('[name=part][value=range]').checked = true; });
        el.querySelector('.fp-slide').addEventListener('change', () => { el.querySelector('[name=part][value=slide]').checked = true; });
        ok.addEventListener('click', () => {
          if (!chosen) return; const kind = chosen.kind || 'note'; const how = el.querySelector('[name=part]:checked')?.value || 'whole';
          let part = null;
          if (kind === 'sheet' && how === 'range') { const range = el.querySelector('.fp-range').value.trim().toUpperCase(); if (!/^\$?[A-Z]{1,2}\$?\d+(:\$?[A-Z]{1,2}\$?\d+)?$/.test(range)) { el.querySelector('.fp-range').focus(); return; } part = { sheet: el.querySelector('.fp-sheet').value, range }; }
          if (kind === 'slides' && how === 'slide') { const i = Number(el.querySelector('.fp-slide').value); const d = blockOf(chosen.content, 'slides'); part = { slide: d?.slides?.[i]?.id || '', n: i }; }
          result = { mode: el.querySelector('[name=mode]:checked').value, ref: cleanRef({ id: chosen.id, kind, title: chosen.title, part }), file: chosen };
          close();
        });
        draw(); setTimeout(() => q.focus(), 30);
      },
      onClose: () => resolve(result),
    });
  });
}

/* Linked files on slides: slides are redrawn often, so one watcher fills in any new card wherever a slide is shown
   (editor, slideshow, presenter view). Thumbnails keep the light placeholder (title only). */
function hydrateSlideFiles(root) {
  if (!root?.getElementsByClassName) return;
  const found = root.classList?.contains('sl-file') ? [root] : [...root.getElementsByClassName('sl-file')];
  for (const el of found) {
    if (el.dataset.h || !el.dataset.file || el.closest('.deck-thumb, .gs-film, .gs-grid')) continue;
    el.dataset.h = '1'; mountFileEmbed(el.querySelector('.file-embed') || el, el.dataset.file, { compact: true });
  }
}
if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) hydrateSlideFiles(n); }).observe(document.documentElement, { childList: true, subtree: true });
}
