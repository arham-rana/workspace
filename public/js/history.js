import { esc, timeAgo } from './util.js';
import { icon, tile } from './icons.js';
import { renderNote } from './markdown.js';
import { request, store } from './store.js';
import { openModal, confirmDialog, toast } from './ui.js';
import { diffDocument, diffWords, diffWorkbooks, diffDecks } from '/shared/diff.mjs';
import * as Slides from '/shared/slides-engine.mjs';
import { blockOf } from '/shared/embeds.mjs';
import { loadSheetEngine, sheetEngine } from './sheet-lazy.js';
import { staticDeckHtml } from './slides.js';

const when = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const dayLabel = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));

/* ---------- Trash ---------- */

export function openTrash() {
  openModal({
    title: 'Deleted files',
    size: 'lg',
    body: '<p class="muted small trash-intro">Deleted documents stay here for 30 days, then they and their files are removed for good.</p><div class="trash-list"><p class="muted small">Loading…</p></div>',
    footer: '<button class="btn btn-ghost-danger" data-empty hidden>Delete all permanently</button><span class="spacer"></span><button class="btn btn-primary" data-close>Done</button>',
    onMount: async (el) => {
      const box = el.querySelector('.trash-list');
      const emptyBtn = el.querySelector('[data-empty]');
      async function draw() {
        let items = [];
        try { items = await request('GET', '/api/trash'); } catch (err) { box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
        emptyBtn.hidden = !items.length;
        box.innerHTML = items.length ? items.map((n) => {
          const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - Date.parse(n.deletedAt)) / 86400000));
          return `<div class="trash-row">
            ${tile(n.icon || 'file', n.color || 'blue', 'sm')}
            <span class="trash-info"><b>${esc(n.title || 'Untitled')}</b><span>Deleted ${timeAgo(n.deletedAt)} · removed ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}</span></span>
            <button class="btn btn-outline btn-sm" data-restore="${n.id}">${icon('restore', { size: 15 })}Restore</button>
            <button class="icon-btn" data-forever="${n.id}" data-title="${esc(n.title || 'Untitled')}" aria-label="Delete forever" title="Delete forever">${icon('trash', { size: 17 })}</button>
          </div>`;
        }).join('') : `<div class="cp-empty">${icon('trash', { size: 22 })}<p>The Trash is empty.</p></div>`;
      }
      box.addEventListener('click', async (e) => {
        const r = e.target.closest('[data-restore]');
        const f = e.target.closest('[data-forever]');
        try {
          if (r) { await request('POST', `/api/trash/${r.dataset.restore}/restore`); await store.refresh(); toast('Restored to your files'); draw(); }
          if (f && await confirmDialog({ title: 'Delete forever?', message: `“${f.dataset.title}” and its files will be permanently deleted. This can’t be undone.`, confirmLabel: 'Delete forever' })) {
            await request('DELETE', `/api/trash/${f.dataset.forever}`); toast('Deleted forever'); draw();
          }
        } catch (err) { toast(err.message, { tone: 'error' }); }
      });
      emptyBtn.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Permanently delete everything in Deleted?', message: 'Everything in Deleted, and its files, will be permanently deleted. This can’t be undone.', confirmLabel: 'Delete all permanently' }))) return;
        try { const r = await request('DELETE', '/api/trash'); toast(`Deleted ${r.deleted} document${r.deleted === 1 ? '' : 's'} forever`); draw(); } catch (err) { toast(err.message, { tone: 'error' }); }
      });
      draw();
    },
  });
}

/* ---------- Version history ---------- */

/* ---------- What changed between two versions ---------- */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const wordsHtml = (before, after) => diffWords(before, after).map((p) => (p.op === 'same' ? esc(p.text) : p.op === 'add' ? `<ins>${esc(p.text)}</ins>` : `<del>${esc(p.text)}</del>`)).join('');
const plainOf = (md) => String(md).replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+(\[[ x]\]\s+)?/gm, '• ').replace(/\*\*|__|\*|_|`/g, '');
const BLOCK_NAMES = { sheet: 'An embedded spreadsheet', slides: 'An embedded presentation', chart: 'A chart', file: 'A linked file', sig: 'A signature', embed: 'An embed' };
async function changesHtml(before, after) {
  const kind = /^\s*\[\[sheet:[A-Za-z0-9_-]+\]\]\s*$/.test(after.content) ? 'sheet' : /^\s*\[\[slides:[A-Za-z0-9_-]+\]\]\s*$/.test(after.content) ? 'slides' : 'note';
  const titleNote = before.title !== after.title ? `<p class="vh-sum">Renamed from “${esc(before.title || 'Untitled')}”</p>` : '';
  if (kind === 'sheet') {
    await loadSheetEngine(); const d = diffWorkbooks(sheetEngine(), blockOf(before.content, 'sheet'), blockOf(after.content, 'sheet'));
    if (!d.sheets.length) return `${titleNote}<p class="vh-sum">No changes to the spreadsheet.</p>`;
    return `${titleNote}<p class="vh-sum">${plural(d.count, 'cell')} changed${d.sheets.length > 1 ? ` across ${plural(d.sheets.length, 'sheet')}` : ''}</p>${d.sheets.map((sh) => `
      <section class="vh-block"><h4>${esc(sh.name)} <span class="vh-tag vh-tag-${sh.status === 'added' ? 'add' : sh.status === 'removed' ? 'del' : 'edit'}">${esc(sh.status === 'changed' ? `${plural(sh.cells.length, 'cell')} changed` : sh.status)}</span></h4>
      ${sh.cells.length ? `<div class="vh-table-wrap"><table class="vh-table"><thead><tr><th>Cell</th><th>Before</th><th>After</th></tr></thead><tbody>${sh.cells.slice(0, 300).map((c) => `<tr><td>${esc(c.cell)}</td><td>${c.before === '' ? '<span class="muted">empty</span>' : `<del>${esc(c.before)}</del>`}</td><td>${c.format ? `<span class="muted">${esc(c.after)} · formatting changed</span>` : c.after === '' ? '<span class="muted">cleared</span>' : `<ins>${esc(c.after)}</ins>`}</td></tr>`).join('')}</tbody></table></div>${sh.cells.length > 300 ? `<p class="muted small">…and ${sh.cells.length - 300} more</p>` : ''}` : ''}</section>`).join('')}`;
  }
  if (kind === 'slides') {
    const A = blockOf(before.content, 'slides'), B = blockOf(after.content, 'slides'); const d = diffDecks(Slides, A, B);
    if (!d.slides.length && !d.deckChanged) return `${titleNote}<p class="vh-sum">No changes to the slides.</p>`;
    const counts = ['changed', 'added', 'removed', 'moved'].map((st) => [st, d.slides.filter((x) => x.status === st).length]).filter(([, n]) => n).map(([st, n]) => `${plural(n, 'slide')} ${st}`);
    const thumb = (deck, slide) => (slide ? `<div class="vh-thumb">${staticDeckHtml(JSON.stringify({ ...deck, slides: [slide] }))}</div>` : '<div class="vh-thumb vh-thumb-none muted small">—</div>');
    const na = Slides.normalizeDeck(A || {}), nb = Slides.normalizeDeck(B || {});
    return `${titleNote}<p class="vh-sum">${counts.join(', ') || 'Theme or slide size changed'}</p>${d.slides.map((x) => {
      const was = na.slides.find((s) => s.id === x.id), now = nb.slides.find((s) => s.id === x.id);
      return `<section class="vh-block"><h4>Slide ${x.status === 'removed' ? x.n : x.n} <span class="vh-tag vh-tag-${x.status === 'added' ? 'add' : x.status === 'removed' ? 'del' : 'edit'}">${x.status === 'moved' ? `moved from ${x.from}` : x.status}</span></h4>
        ${x.status === 'moved' ? '' : `<div class="vh-pair">${thumb(na, x.status === 'added' ? null : was)}<span class="vh-arrow" aria-hidden="true">→</span>${thumb(nb, x.status === 'removed' ? null : now)}</div>`}
        ${x.changes.length ? `<ul class="vh-changes">${x.changes.map((c) => `<li class="vh-${c.op}"><b>${esc(c.what)}</b> ${c.op === 'add' ? 'added' : c.op === 'del' ? 'removed' : c.moved ? 'moved or restyled' : 'edited'}${c.op === 'edit' && !c.moved && (c.before || c.text) ? `: ${wordsHtml(c.before || '', c.text || '')}` : c.text ? `: “${esc(c.text.slice(0, 120))}”` : ''}</li>`).join('')}</ul>` : ''}</section>`;
    }).join('')}`;
  }
  const d = diffDocument(before.content, after.content);
  const n = (op) => d.filter((x) => x.op === op).length;
  const sum = [n('edit') && `${plural(n('edit'), 'paragraph')} edited`, n('add') && `${n('add')} added`, n('del') && `${n('del')} removed`].filter(Boolean).join(', ');
  const tokenName = (t) => { const m = /^\s*\[\[([a-z]+):/.exec(t); return m ? BLOCK_NAMES[m[1]] || 'A block' : null; };
  const block = (x) => {
    if (x.op === 'same') return renderNote(x.text, { readOnly: true });
    if (x.op === 'edit') return tokenName(x.text) ? `<p class="vh-edit-block">${esc(tokenName(x.text))} changed</p>` : `<p class="vh-edit-block">${wordsHtml(plainOf(x.before), plainOf(x.text))}</p>`;
    return `<div class="vh-${x.op}-block">${renderNote(x.text, { readOnly: true })}</div>`;
  };
  return `${titleNote}<p class="vh-sum">${sum || 'No changes to the text.'}</p><div class="prose vh-diff">${d.map(block).join('')}</div>`;
}

export function openVersionHistory(noteId) {
  const note = store.find('notes', noteId);
  if (!note) return;
  openModal({
    title: 'Version history',
    size: 'xl',
    body: `<div class="vh"><div class="vh-list" role="listbox" aria-label="Versions"><p class="muted small">Loading…</p></div><div class="vh-view"><div class="vh-bar"></div><div class="vh-doc prose"></div></div></div>`,
    footer: '<span class="muted small vh-note">Restoring keeps the current version in the history, so you can always go back.</span><span class="spacer"></span><button class="btn btn-ghost" data-close>Close</button><button class="btn btn-primary" data-restore-version hidden>' + icon('restore', { size: 16 }) + 'Restore this version</button>',
    onMount: async (el, close) => {
      const list = el.querySelector('.vh-list'), view = el.querySelector('.vh-doc'), bar = el.querySelector('.vh-bar'), restoreBtn = el.querySelector('[data-restore-version]');
      let data;
      try { data = await request('GET', `/api/notes/${noteId}/versions`); } catch (err) { list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
      let selected = 'current';
      const items = [{ id: 'current', createdAt: data.current.updatedAt, author: data.current.author, current: true }, ...data.versions];
      let lastDay = '';
      list.innerHTML = items.map((v) => {
        const day = dayLabel(v.createdAt);
        const head = day !== lastDay ? `<div class="vh-day">${esc(day)}</div>` : '';
        lastDay = day;
        return `${head}<button type="button" role="option" class="vh-item ${v.current ? 'active' : ''}" data-version="${v.id}" aria-selected="${!!v.current}">
          <b>${v.current ? 'Current version' : esc(new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(v.createdAt)))}</b>
          <span>${esc(v.author)}${v.current ? ` · ${timeAgo(v.createdAt)}` : ''}</span></button>`;
      }).join('') + (data.versions.length ? '' : '<p class="muted small vh-none">No earlier versions yet. Versions are saved as the document is edited.</p>');
      const contents = new Map(); // version id → { title, content }
      const versionOf = async (id) => {
        if (id === 'current') { const n = store.find('notes', noteId); return { title: n?.title || '', content: n?.content || '' }; }
        if (!contents.has(id)) contents.set(id, await request('GET', `/api/notes/${noteId}/versions/${id}`));
        return contents.get(id);
      };
      let showChanges = true;
      async function show(id) {
        selected = id;
        list.querySelectorAll('.vh-item').forEach((b) => { const on = b.dataset.version === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
        restoreBtn.hidden = id === 'current' || !data.canRestore;
        const idx = items.findIndex((v) => v.id === id); const prevId = items[idx + 1]?.id || null; // the version before it
        const toggle = `<label class="vh-toggle"><input type="checkbox" data-vh-changes${showChanges ? ' checked' : ''}> Show changes</label>`;
        if (id === 'current') {
          const n = store.find('notes', noteId);
          bar.innerHTML = `<b>${esc(n?.title || '')}</b><span class="muted small">Current version</span>${prevId ? toggle : ''}`;
          view.innerHTML = showChanges && prevId ? await changesHtml(await versionOf(prevId), { title: n?.title, content: n?.content || '' }) : renderNote(n?.content || '', { readOnly: true });
          return;
        }
        view.innerHTML = '<p class="muted small">Loading…</p>';
        try {
          const v = await versionOf(id);
          if (selected !== id) return;
          bar.innerHTML = `<b>${esc(v.title)}</b><span class="muted small">${esc(when(v.createdAt))}</span>${prevId ? toggle : '<span class="muted small vh-first">The first saved version</span>'}`;
          view.innerHTML = showChanges && prevId ? await changesHtml(await versionOf(prevId), v) : renderNote(v.content, { readOnly: true }) || '<p class="muted">This version was empty.</p>';
          if (selected !== id) return;
        } catch (err) { view.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
      }
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-version]'); if (b) show(b.dataset.version); });
      bar.addEventListener('change', (e) => { if (e.target.matches('[data-vh-changes]')) { showChanges = e.target.checked; show(selected); } });
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const btns = [...list.querySelectorAll('.vh-item')];
        const i = btns.findIndex((b) => b.dataset.version === selected);
        const next = btns[Math.min(btns.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        next.focus(); show(next.dataset.version);
      });
      restoreBtn.addEventListener('click', async () => {
        try {
          await request('POST', `/api/notes/${noteId}/versions/${selected}/restore`);
          await store.refresh();
          close();
          toast('Version restored. The version you replaced is in the history.');
        } catch (err) { toast(err.message, { tone: 'error' }); }
      });
      show('current');
    },
  });
}
