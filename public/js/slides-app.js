// The presentation editor, laid out and behaving like Google Slides:
// menu bar + one context toolbar, filmstrip (with multi-select and grid view), canvas with zoom, rulers and grid,
// 8 resize handles + rotation, groups, text fitting/spacing, Format options and Themes side panel, Find and replace.
import { esc, kbd } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { toast, confirmDialog, openMenu, openModal, announce } from './ui.js';
import { openChartDialog } from './charts.js';
import { slideFrame, present, printDeck, slideBackground, playStep, deckOutline } from './slides.js';
import { state as appState } from './store.js';
import { loadSheetEngine, sheetEngine } from './sheet-lazy.js';
import { pickFile, fetchEmbed } from './file-embed.js';
import { blockOf, sheetRange, deckSlide, plainOf } from '/shared/embeds.mjs';
import { bind as bindSheet, chartSpec as sheetChartSpec } from './sheet-core.js';
import * as S from '/shared/slides-engine.mjs';

const parse = (json) => { try { return S.normalizeDeck(typeof json === 'string' ? JSON.parse(json) : json); } catch { return S.emptyDeck(); } };
const PX_IN = 96; // the slide is 960 px = 10 in wide
const GRID = 24; // snap-to-grid step (¼ in)
const SNAP = 6; // screen pixels for smart guides
let clipboard = null; // copied objects or slides (within this app)

export function mountSlides(root, json, { editable = true, change, remove, fileMode = false, noteId = null, title = 'Presentation' } = {}) {
  let deck = parse(json);
  let cur = 0, sel = null, editingId = null, multi = new Set(), selSlides = new Set([0]), enteredGroup = null;
  let lastCellTap = {}; // for double-click / double-tap on a table cell
  let commentedItems = new Map(); // "slide/object" → comment id, for open comments (filled in by the comments panel)
  let zoom = 'fit', showRuler = true, showNotes = true, snapGrid = false, snapGuides = true, showGrid = false, gridView = false;
  let panel = null; // 'format' | 'themes' | null
  let tool = 'select', painter = null, stopText = null;
  let target = null; // null: slides; 'master' or a layout key: the theme builder
  let cellSel = null, cropId = null, animSel = null; // the animation picked in the Motion panel
  const linkedFresh = new Map(); // chart id → the up-to-date spec from its spreadsheet (when it differs) // table cell selection { id, r1, c1, r2, c2 }; image being cropped
  const undo = [], redo = [];
  const H = () => S.heightFor(deck.ratio);
  /** What the canvas edits: the current slide, or (theme builder) the master or a layout. */
  const targetOf = (d) => {
    if (target === 'master') { d.master ||= { items: [] }; return d.master; }
    if (target) { d.layouts ||= {}; d.layouts[target] ||= { items: S.layoutItems(target, d.ratio) }; return d.layouts[target]; }
    return d.slides[cur];
  };
  const slide = () => (target ? targetOf(deck) : deck.slides[cur]);
  const item = (id = sel) => slide()?.items.find((it) => it.id === id);
  const selected = () => slide()?.items.filter((it) => multi.has(it.id)) || [];
  const groupOf = (it) => (it?.g && it.g !== enteredGroup ? slide().items.filter((x) => x.g === it.g) : [it]);
  const setSel = (id) => { sel = id; const it = item(id); multi = new Set(it ? groupOf(it).map((x) => x.id) : []); };
  root.classList.add('deck-ui', 'gs-ui');
  if (fileMode) root.classList.add('deck-file-ui');

  const MENUS = ['File', 'Edit', 'View', 'Insert', 'Format', 'Slide', 'Arrange', 'Tools'];
  // icons for the menu bar's items (by the start of their name), like the document menus
  const MENU_ICONS = [[/^Image/, 'image'], [/^Shape/, 'shapes'], [/^(Line|Elbow|Curved)/, 'minus'], [/^Arrow/, 'arrowRight'], [/^Table/, 'table'], [/^Chart/, 'barChart'], [/^Link/, 'link'],
    [/^Undo/, 'undo'], [/^Redo/, 'redo'], [/^Cut/, 'scissors'], [/^(Copy|Duplicate)/, 'copy'], [/^Paste/, 'clipboard'], [/^Delete/, 'trash'], [/^Find/, 'search'], [/^New slide/, 'plus'],
    [/^Existing file/, 'file'], [/^Animation/, 'sparkles'], [/^(Change theme|Theme)/, 'palette'], [/^(Slideshow|Present)/, 'play'], [/^Presenter/, 'presentation'], [/^(Show|Hide)/, 'eye'], [/^(Format options|Preferences)/, 'settings']];
  const withIcons = (items) => items.map((it) => (it && typeof it === 'object' && !it.icon ? { ...it, icon: MENU_ICONS.find(([re]) => re.test(it.label || ''))?.[1] } : it));
  root.innerHTML = `
    ${editable ? `<div class="gs-menubar"><span class="gs-menus" role="menubar" aria-label="Presentation menus">${MENUS.map((m) => `<button type="button" class="gs-menu" role="menuitem" aria-haspopup="menu" data-menu="${m}">${m}</button>`).join('')}</span>
      <span class="gs-spacer"></span>
      <div class="gs-present"><button type="button" class="btn btn-primary btn-sm" data-c="present" title="${kbd('Slideshow (Cmd+F5)')}">${icon('play', { size: 14 })}Slideshow</button><button type="button" class="btn btn-primary btn-sm gs-present-more" data-c="present-menu" aria-label="Slideshow options" aria-haspopup="menu">▾</button></div>
      ${remove ? `<button type="button" class="tb-btn deck-remove" data-c="remove" title="Delete presentation" aria-label="Delete presentation">${icon('trash', { size: 16 })}</button>` : ''}
    </div>
    <div class="gs-toolbar" role="toolbar" aria-label="Presentation tools"></div>` : ''}
    <div class="gs-body">
      <ol class="gs-film deck-thumbs" role="listbox" aria-multiselectable="true" aria-label="Slides" tabindex="0"></ol>
      <div class="gs-center">
        <div class="gs-scroll"><div class="gs-stagewrap"><div class="gs-ruler-h" aria-hidden="true"></div><div class="gs-ruler-v" aria-hidden="true"></div><div class="gs-canvas deck-canvas" tabindex="0" role="application" aria-roledescription="slide editor" aria-label="Slide. Tab selects each object, arrows move it, Enter edits text, Escape deselects."></div></div></div>
        ${editable ? '<div class="gs-notes-wrap"><textarea class="gs-notes deck-notes" rows="3" placeholder="Click to add speaker notes" aria-label="Speaker notes"></textarea></div>' : ''}
      </div>
      <aside class="gs-panel" hidden></aside>
    </div>
    <div class="gs-grid" hidden tabindex="0" aria-label="Grid view of all slides"></div>
    <input type="file" class="deck-file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden>
    <input type="file" class="deck-img" accept="image/*" hidden>`;
  const film = root.querySelector('.gs-film'), canvas = root.querySelector('.gs-canvas'), scroller = root.querySelector('.gs-scroll');
  const stageWrap = root.querySelector('.gs-stagewrap'), notes = root.querySelector('.gs-notes'), panelEl = root.querySelector('.gs-panel');
  const toolbar = root.querySelector('.gs-toolbar'), gridEl = root.querySelector('.gs-grid');
  const rulerH = root.querySelector('.gs-ruler-h'), rulerV = root.querySelector('.gs-ruler-v');

  /* =================== Drawing =================== */
  const frameWidth = () => { const fit = Math.max(240, Math.min(scroller.clientWidth - 56, (scroller.clientHeight - 56) * (S.W / H()))); return zoom === 'fit' ? fit : S.W * zoom; };
  const scale = () => frameWidth() / S.W;
  function drawFilm() {
    if (target) {
      const entries = [['master', 'Master (on every slide)', { items: deck.master?.items || [], layout: 'blank' }], ...Object.entries(S.LAYOUTS).map(([k2, l]) => [k2, l, { items: deck.layouts?.[k2]?.items || S.layoutItems(k2, deck.ratio), layout: k2 }])];
      film.setAttribute('aria-label', 'Theme builder: master and layouts');
      film.innerHTML = `${entries.map(([k2, l, sl]) => `<li class="deck-thumb gs-thumb ${target === k2 ? 'on' : ''}" role="option" aria-selected="${target === k2}" data-target="${k2}" tabindex="-1"><span class="gs-thumb-label">${esc(l)}</span>${slideFrame({ ...deck, slides: [] }, { ...sl, id: k2 }, { placeholders: true, master: k2 !== 'master' })}</li>`).join('')}`;
      return;
    }
    film.setAttribute('aria-label', 'Slides');
    film.innerHTML = deck.slides.map((s, i) => `<li class="deck-thumb gs-thumb ${i === cur ? 'on' : ''} ${selSlides.has(i) ? 'picked' : ''} ${s.skip ? 'skipped' : ''}" role="option" data-i="${i}" draggable="${editable}" tabindex="-1" aria-label="Slide ${i + 1}${s.skip ? ' (skipped)' : ''}" aria-current="${i === cur}" aria-selected="${selSlides.has(i)}">${[...commentedItems.keys()].some((k) => k.startsWith(`${s.id}/`)) ? `<span class="thumb-cmt" title="Has comments" aria-label="Has comments">${icon('messageSquare', { size: 11 })}</span>` : ''}<span class="deck-thumb-n">${i + 1}</span>${slideFrame(deck, s)}<span class="gs-thumb-flags">${s.skip ? '<i title="Skipped in the slideshow">skip</i>' : ''}${s.tr || s.anims?.length ? '<i title="Has transitions or animations">✦</i>' : ''}</span></li>`).join('');
  }
  function drawGrid() {
    gridEl.innerHTML = `<div class="gs-grid-head"><b>Grid view</b><span class="muted">${deck.slides.length} slides · click to select, drag to reorder, double-click to open</span><button type="button" class="btn btn-plain btn-sm" data-c="grid-view">Close grid view</button></div><ol class="gs-grid-list">${deck.slides.map((s, i) => `<li class="deck-thumb gs-thumb ${i === cur ? 'on' : ''} ${selSlides.has(i) ? 'picked' : ''}" data-i="${i}" draggable="${editable}"><span class="deck-thumb-n">${i + 1}</span>${slideFrame(deck, s)}</li>`).join('')}</ol>`;
  }
  function drawCanvas() {
    stopText?.();
    const fw = frameWidth(); const k = fw / S.W;
    canvas.style.width = `${fw}px`;
    canvas.innerHTML = target ? slideFrame({ ...deck, slides: [] }, { id: target, layout: target === 'master' ? 'blank' : target, items: slide().items }, { placeholders: true, cls: 'deck-stage-frame', master: target !== 'master' }) : slideFrame(deck, slide(), { placeholders: editable, cls: 'deck-stage-frame' });
    root.classList.toggle('gs-building', !!target);
    const frame = canvas.querySelector('.sl-frame'); frame?.style.setProperty('--k', String(k));
    const stage = canvas.querySelector('.sl-stage');
    if (showGrid) stage.insertAdjacentHTML('beforeend', `<div class="gs-gridlines" style="background-size:${GRID}px ${GRID}px"></div>`);
    if (editable) drawSelection(stage);
    if (!target) for (const [key, cid] of commentedItems) { // open comments: a badge at the object's top-right (or the slide's)
      const [sid, iid] = key.split('/'); if (sid !== slide().id) continue; const it = iid ? item(iid) : null; if (iid && !it) continue;
      stage.insertAdjacentHTML('beforeend', `<button type="button" class="gs-cmt" data-cmt="${cid}" style="left:${it ? it.x + it.w : S.W - 16}px;top:${it ? it.y : 16}px" title="Comments" aria-label="Show comments on ${it ? esc(itemLabel(it)) : 'this slide'}">${icon('messageSquare', { size: 13 })}</button>`);
    }
    if (editable && !target) for (const it of slide().items) if (it.t === 'chart' && linkedFresh.has(it.id)) stage.insertAdjacentHTML('beforeend', `<button type="button" class="gs-chart-update" data-chart-update="${it.id}" style="left:${it.x + it.w - 80}px;top:${it.y + 6}px" title="The spreadsheet's data changed">Update</button>`);
    drawRulers();
    checkLinkedCharts();
  }
  function drawSelection(stage) {
    const list = selected(); if (!list.length) return;
    const single = list.length === 1 ? list[0] : null;
    if (single?.t === 'line') { stage.insertAdjacentHTML('beforeend', `<div class="gs-lineends">${[[1, single.x1, single.y1, single.from], [2, single.x2, single.y2, single.to]].map(([n, x, y, att]) => `<span class="gs-end ${att ? 'att' : ''}" data-end="${n}" style="left:${x}px;top:${y}px"></span>`).join('')}</div>`); return; }
    if (single?.t === 'table' && cellSel?.id === single.id) for (let r = cellSel.r1; r <= cellSel.r2; r++) for (let c = cellSel.c1; c <= cellSel.c2; c++) stage.querySelector(`.sl-item[data-id="${single.id}"] td[data-cell="${r},${c}"]`)?.classList.add('cell-on');
    if (single?.t === 'image' && cropId === single.id) { drawCrop(stage, single); return; }
    for (const it of list) if (!single) stage.insertAdjacentHTML('beforeend', `<div class="gs-outline" style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;${it.rot ? `transform:rotate(${it.rot}deg)` : ''}"></div>`);
    const b = single ? single : boundsOf(list);
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((c) => `<span class="gs-h h-${c}" data-h="${c}"></span>`).join('');
    const rot = single ? `<span class="gs-rot" data-rot title="Rotate (Shift: 15° steps)"></span>` : '';
    stage.insertAdjacentHTML('beforeend', `<div class="gs-sel ${editingId ? 'is-editing' : ''}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;${single?.rot ? `transform:rotate(${single.rot}deg)` : ''}">${single?.lock ? '' : handles + rot}</div>`);
  }
  function drawRulers() {
    rulerH.hidden = rulerV.hidden = !showRuler || !editable;
    if (!showRuler || !editable) return;
    const k = scale(); const W = S.W * k, Hh = H() * k;
    const b = selected().length ? boundsOf(selected()) : null;
    const ticks = (len, n) => { let h = ''; for (let i = 0; i <= n * 4; i++) { const p = (i * PX_IN / 4) * k; if (p > len) break; h += `<i class="${i % 4 === 0 ? 'big' : i % 2 === 0 ? 'mid' : ''}" style="--p:${p}px">${i % 4 === 0 && i ? i / 4 : ''}</i>`; } return h; };
    rulerH.style.width = `${W}px`; rulerV.style.height = `${Hh}px`;
    rulerH.innerHTML = `${b ? `<b style="left:${b.x * k}px;width:${b.w * k}px"></b>` : ''}${ticks(W, 10)}`;
    rulerV.innerHTML = `${b ? `<b style="top:${b.y * k}px;height:${b.h * k}px"></b>` : ''}${ticks(Hh, 8)}`;
  }
  function draw() {
    if (gridView) { drawGrid(); }
    drawFilm(); drawCanvas(); drawToolbar(); drawPanel();
    if (notes && document.activeElement !== notes) notes.value = slide()?.notes || '';
    root.querySelector('.gs-notes-wrap')?.toggleAttribute('hidden', !showNotes);
  }
  new ResizeObserver(() => { if (!editingId) drawCanvas(); }).observe(scroller);

  /* =================== Changes, undo and co-editing =================== */
  function commit(next, { redraw = true } = {}) {
    if (!editable) return;
    next = S.normalizeDeck(next);
    const d = S.diffDecks(deck, next); if (!d) return;
    undo.push(d); if (undo.length > 100) undo.shift(); redo.length = 0;
    deck = next; cur = Math.min(cur, deck.slides.length - 1);
    selSlides = new Set([...selSlides].filter((i) => i < deck.slides.length)); if (!selSlides.size) selSlides = new Set([cur]);
    change?.((latest) => S.applyDeckSide(latest || deck, d.after), { side: d.after }); // the change list lets co-editing touch only what changed
    if (redraw) draw();
  }
  function step(from, to, sideName) {
    const d = from.pop(); if (!d) return;
    to.push(d); deck = S.applyDeckSide(deck, d[sideName]); cur = Math.min(cur, deck.slides.length - 1);
    if (sel && !item()) setSel(null); multi = new Set([...multi].filter((id) => item(id)));
    change?.((latest) => S.applyDeckSide(latest || deck, d[sideName]), { side: d[sideName] }); draw();
  }
  const edit = (fn) => { const next = structuredClone(deck); const t = targetOf(next); fn(next, t); if (t?.items) t.items = S.routeLines(t.items); commit(next); }; // connectors follow their shapes
  const editSel = (fn) => { const ids = new Set(multi); edit((d, s) => s.items.forEach((x) => { if (ids.has(x.id)) fn(x); })); };
  const topZ = () => Math.max(0, ...slide().items.map((it) => it.z)) + 1;
  const addItem = (it) => { const withZ = { ...it, id: S.newId(), z: topZ() }; edit((d, s) => s.items.push(withZ)); setSel(withZ.id); draw(); return withZ; };
  const boundsOf = (list) => { const x = Math.min(...list.map((i) => i.x)), y = Math.min(...list.map((i) => i.y)); return { x, y, w: Math.max(...list.map((i) => i.x + i.w)) - x, h: Math.max(...list.map((i) => i.y + i.h)) - y }; };

  /* =================== Text editing =================== */
  const isTextual = (it) => it && (it.t === 'text' || (it.t === 'shape' && it.shape !== 'line'));
  function startText(id, place = true) {
    const it = item(id); if (!editable || !isTextual(it) || it.lock) return;
    if (it.t === 'shape' && !it.html) { const next = structuredClone(deck); const x = targetOf(next).items.find((y) => y.id === id); x.html = ''; x.fs = x.fs || 20; deck = S.normalizeDeck(next); drawCanvas(); }
    editingId = id;
    let rich = canvas.querySelector(`[data-rich="${id}"]`);
    if (!rich) { canvas.querySelector(`.sl-item[data-id="${id}"]`)?.insertAdjacentHTML('beforeend', `<div class="sl-text-inner" style="justify-content:center;text-align:center;font-size:${it.fs || 20}px;padding:${it.pad ?? 8}px"><div class="sl-rich" data-rich="${id}"></div></div>`); rich = canvas.querySelector(`[data-rich="${id}"]`); }
    if (!rich) return;
    if (rich.querySelector('.sl-ph')) rich.innerHTML = it.role === 'body' ? '<ul><li><br></li></ul>' : '';
    rich.removeAttribute('data-fit'); rich.style.fontSize = '';
    rich.contentEditable = 'true'; rich.classList.add('editing');
    canvas.querySelector('.gs-sel')?.classList.add('is-editing');
    document.execCommand('styleWithCSS', false, false); // bold, strikethrough... as tags the safe-text filter keeps
    if (place) { rich.focus(); const r = document.createRange(); r.selectNodeContents(rich); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    let t = null;
    const save = () => {
      const html = S.sanitizeHtml(rich.innerHTML); const c = item(id); if (!c) return;
      let h = c.h; if (c.af === 'resize') { const inner = rich.parentElement; h = Math.max(24, Math.ceil(rich.scrollHeight + (c.pad ?? 8) * 2 + 2)); inner.style.minHeight = ''; }
      if (html !== (c.html || '') || h !== c.h) { const next = structuredClone(deck); const x = targetOf(next).items.find((y) => y.id === id); x.html = html; x.h = h; commit(next, { redraw: false }); drawFilm(); }
    };
    const close = () => { clearTimeout(t); rich.onblur = null; rich.oninput = null; save(); if (editingId === id) editingId = null; stopText = null; };
    stopText = close;
    rich.oninput = () => { clearTimeout(t); t = setTimeout(save, 600); if (item(id)?.af === 'resize') { const box = canvas.querySelector(`.sl-item[data-id="${id}"]`); const need = rich.scrollHeight + (item(id).pad ?? 8) * 2 + 2; if (box && need > box.offsetHeight) { box.style.height = `${need}px`; const sb = canvas.querySelector('.gs-sel'); if (sb) sb.style.height = `${need}px`; } } };
    rich.onblur = () => setTimeout(() => {
      if (document.activeElement?.closest('.modal, .menu') || document.querySelector('.modal')) return; // e.g. the link dialog: keep editing
      close(); if (!editingId) { drawCanvas(); drawToolbar(); }
    }, 0);
    rich.onkeydown = (e) => {
      const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
      if (e.key === 'Escape') { e.preventDefault(); rich.blur(); canvas.focus(); }
      else if (mod && k === 'a') { e.preventDefault(); const r = document.createRange(); r.selectNodeContents(rich); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); } // all of this box's text
      else if (e.key === 'Tab') { e.preventDefault(); if (getSelection().anchorNode?.parentElement?.closest('li')) document.execCommand(e.shiftKey ? 'outdent' : 'indent'); else document.execCommand('insertText', false, '\u2003'); }
      else if (e.altKey && e.shiftKey && e.code === 'Digit5') { e.preventDefault(); fmt('strikeThrough'); }
      else if (mod && k === '.') { e.preventDefault(); fmt('superscript'); }
      else if (mod && k === ',') { e.preventDefault(); fmt('subscript'); }
      else if (mod && k === 'k') { e.preventDefault(); linkDialog(); }
      else if (mod && e.shiftKey && (e.code === 'Digit7' || e.code === 'Digit8')) { e.preventDefault(); fmt(e.code === 'Digit7' ? 'insertOrderedList' : 'insertUnorderedList'); }
      else if (mod && e.shiftKey && ['l', 'e', 'r', 'j'].includes(k)) { e.preventDefault(); setAlign({ l: 'left', e: 'center', r: 'right', j: 'justify' }[k]); }
      else if (mod && e.shiftKey && (e.key === '>' || e.key === '<' || e.code === 'Period' || e.code === 'Comma')) { e.preventDefault(); bumpSize(e.key === '>' || e.code === 'Period' ? 1 : -1); }
      else if (mod && e.key === '\\') { e.preventDefault(); fmt('removeFormat'); }
      e.stopPropagation();
    };
  }
  const richEl = () => canvas.querySelector('.sl-rich.editing');
  const CSS_CMDS = ['foreColor', 'hiliteColor', 'fontName', 'fontSize'];
  const fmt = (cmd, value) => { if (!editingId) return false; document.execCommand('styleWithCSS', false, CSS_CMDS.includes(cmd)); document.execCommand(cmd, false, value); document.execCommand('styleWithCSS', false, false); richEl()?.dispatchEvent(new Event('input')); return true; };
  /** Formatting applied to whole boxes when they're selected but not being edited. */
  const WRAP = { bold: ['<b>', '</b>'], italic: ['<i>', '</i>'], underline: ['<u>', '</u>'], strikeThrough: ['<s>', '</s>'], superscript: ['<sup>', '</sup>'], subscript: ['<sub>', '</sub>'] };
  function formatCmd(cmd, value) {
    if (fmt(cmd, value)) return;
    const [a, b] = WRAP[cmd] || [];
    if (a) { editSel((x) => { if (!x.html) return; x.html = x.html.startsWith(a) && x.html.endsWith(b) ? x.html.slice(a.length, -b.length) : `${a}${x.html}${b}`; }); return; }
    if (cmd === 'foreColor') editSel((x) => { x.color = value; });
    if (cmd === 'hiliteColor') editSel((x) => { if (x.html) x.html = `<span style="background-color:${value}">${x.html}</span>`; });
    if (cmd === 'fontName') editSel((x) => { x.ff = value; });
    if (cmd === 'removeFormat') editSel((x) => { if (x.html) x.html = S.sanitizeHtml(x.html.replace(/<\/?(b|strong|i|em|u|s|strike|sup|sub|span)[^>]*>/gi, '')); delete x.color; delete x.ff; });
  }
  function setAlign(al) {
    if (editingId) { const id = editingId; const inner = richEl()?.parentElement; if (inner) inner.style.textAlign = al; const next = structuredClone(deck); const x = targetOf(next).items.find((y) => y.id === id); x.al = al; commit(next, { redraw: false }); return; }
    editSel((x) => { x.al = al; });
  }
  function bumpSize(dir) {
    const SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];
    const next = (n) => (dir > 0 ? SIZES.find((x) => x > n) ?? n + 12 : [...SIZES].reverse().find((x) => x < n) ?? Math.max(6, n - 2));
    if (editingId && !getSelection().isCollapsed) { const base = item(editingId)?.fs || 24; setSpanSize(next(currentSize() || base)); return; }
    editSel((x) => { x.fs = next(x.fs || 24); });
  }
  const currentSize = () => { const n = getSelection().anchorNode; const el = n?.nodeType === 3 ? n.parentElement : n; return el ? Math.round(parseFloat(getComputedStyle(el).fontSize) / (scale() || 1)) : null; };
  function setSpanSize(px) { // a font size for the selected text only
    if (!editingId) return;
    document.execCommand('styleWithCSS', false, true); document.execCommand('fontSize', false, '7');
    richEl()?.querySelectorAll('[style*="xxx-large"], font[size="7"]').forEach((n) => { const span = document.createElement('span'); span.style.fontSize = `${px}px`; span.innerHTML = n.innerHTML; n.replaceWith(span); });
    richEl()?.dispatchEvent(new Event('input'));
  }
  function setFontSize(px) { if (editingId && !getSelection().isCollapsed) setSpanSize(px); else if (editingId) { const id = editingId; stopText?.(); edit((d, s) => { const x = s.items.find((y) => y.id === id); if (x) x.fs = px; }); } else editSel((x) => { x.fs = px; }); }
  function listStyle(type, ordered) {
    if (!editingId) { const it = item(); if (it) { setSel(it.id); startText(it.id); } }
    setTimeout(() => {
      const rich = richEl(); if (!rich) return;
      let li = getSelection().anchorNode; li = li?.nodeType === 3 ? li.parentElement : li; let list = li?.closest('ul, ol');
      if (!list || list.tagName.toLowerCase() !== (ordered ? 'ol' : 'ul')) { document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList'); li = getSelection().anchorNode; li = li?.nodeType === 3 ? li.parentElement : li; list = li?.closest('ul, ol'); }
      if (list && type) list.style.listStyleType = type;
      rich.dispatchEvent(new Event('input'));
    }, 0);
  }
  async function linkDialog() {
    const range = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null; const editing = editingId;
    let out = null;
    openModal({ title: 'Insert link', body: `<form class="form" id="gs-link"><label class="field"><span>Link</span><input name="url" placeholder="https://… or mailto:…" autocomplete="off"></label><label class="field"><span>Or a slide in this presentation</span><select name="slide"><option value="">—</option>${deck.slides.map((s, i) => `<option value="${i + 1}">Slide ${i + 1}</option>`).join('')}</select></label></form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="gs-link">Apply</button>',
      onMount: (el, close) => { const f = el.querySelector('#gs-link'); setTimeout(() => f.elements.url.focus(), 40); f.addEventListener('submit', (e) => { e.preventDefault(); let u = f.elements.url.value.trim(); if (f.elements.slide.value) u = `#slide=${f.elements.slide.value}`; else if (u && !/^(https?:|mailto:|#)/i.test(u)) u = /@/.test(u) && !/\//.test(u) ? `mailto:${u}` : `https://${u}`; out = u; close(); }); },
      onClose: () => setTimeout(() => {
        if (!out) return;
        if (editing) { const rich = canvas.querySelector(`[data-rich="${editing}"]`); if (!rich) { toast('Couldn’t add the link: the text box was closed', { tone: 'error' }); return; } rich.focus(); if (range) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); } if (getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(out)}">${esc(out.replace(/^#slide=/, 'Slide ').replace(/^mailto:/, ''))}</a>`); else document.execCommand('createLink', false, out); rich.dispatchEvent(new Event('input')); }
        else editSel((x) => { if (x.html) x.html = `<a href="${esc(out)}">${x.html}</a>`; });
      }, 40) });
  }

  /* =================== Phase B: tables, video, Word Art, backgrounds, layouts, theme =================== */
  function editCell(id, r, c) {
    const td = canvas.querySelector(`.sl-item[data-id="${id}"] [data-rich-cell="${r},${c}"]`); if (!td) return;
    cellSel = { id, r1: r, c1: c, r2: r, c2: c }; editingId = id;
    td.contentEditable = 'true'; td.classList.add('editing'); td.focus();
    const rg = document.createRange(); rg.selectNodeContents(td); rg.collapse(false); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(rg);
    canvas.querySelector('.gs-sel')?.classList.add('is-editing');
    const save = () => { const html = S.sanitizeHtml(td.innerHTML); const t = item(id); if (t && html !== t.rows[r][c].html) { const next = structuredClone(deck); targetOf(next).items.find((x) => x.id === id).rows[r][c].html = html; commit(next, { redraw: false }); drawFilm(); } };
    const close = () => { td.onblur = null; save(); editingId = null; stopText = null; };
    stopText = close;
    td.oninput = () => { clearTimeout(td._t); td._t = setTimeout(save, 600); };
    td.onblur = () => setTimeout(() => { if (document.querySelector('.modal') || document.activeElement?.closest('.menu')) return; if (editingId === id) { close(); drawCanvas(); drawToolbar(); } }, 0);
    td.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); td.blur(); canvas.focus(); }
      if (e.key === 'Tab') { // next/previous cell; Tab in the last cell adds a row (Google Slides)
        e.preventDefault(); const t = item(id); const cells = []; t.rows.forEach((row, ri) => row.forEach((cc, ci) => { if (!cc.hide) cells.push([ri, ci]); }));
        let i = cells.findIndex(([ri, ci]) => ri === r && ci === c) + (e.shiftKey ? -1 : 1);
        close();
        if (i >= cells.length) { tableOp('row-below', { r1: r, c1: c, r2: r, c2: c }); i = cells.length; requestAnimationFrame(() => editCell(id, r + 1, 0)); return; }
        i = Math.max(0, i); drawCanvas(); editCell(id, cells[i][0], cells[i][1]);
      }
      e.stopPropagation();
    };
    drawToolbar();
  }
  function tableOp(op, selRange = cellSel) {
    const it = item(); if (it?.t !== 'table' || !selRange) { toast('Select table cells first'); return; }
    const g = selRange;
    edit((d, sl) => {
      const t = sl.items.find((x) => x.id === it.id); const nc = t.colW.length;
      const blankRow = () => Array.from({ length: nc }, () => ({ html: '' }));
      if (op === 'row-above' || op === 'row-below') { const at2 = op === 'row-above' ? g.r1 : g.r2 + 1; t.rows.splice(at2, 0, blankRow()); t.rowH.splice(at2, 0, t.rowH[Math.min(g.r1, t.rowH.length - 1)]); }
      if (op === 'col-left' || op === 'col-right') { const at2 = op === 'col-left' ? g.c1 : g.c2 + 1; t.rows.forEach((row) => row.splice(at2, 0, { html: '' })); const w2 = Math.round(t.colW[Math.min(g.c1, nc - 1)]); t.colW.splice(at2, 0, w2); }
      if (op === 'del-row') { if (t.rows.length - (g.r2 - g.r1 + 1) < 1) return; t.rows.splice(g.r1, g.r2 - g.r1 + 1); t.rowH.splice(g.r1, g.r2 - g.r1 + 1); }
      if (op === 'del-col') { if (nc - (g.c2 - g.c1 + 1) < 1) return; t.rows.forEach((row) => row.splice(g.c1, g.c2 - g.c1 + 1)); t.colW.splice(g.c1, g.c2 - g.c1 + 1); }
      if (op === 'merge') { const html = []; for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const cell = t.rows[r][c]; if (cell.html && S.plainText(cell.html).trim()) html.push(cell.html); if (r !== g.r1 || c !== g.c1) t.rows[r][c] = { html: '', hide: 1 }; } t.rows[g.r1][g.c1] = { ...t.rows[g.r1][g.c1], html: html.join('<br>'), cs: g.c2 - g.c1 + 1, rs: g.r2 - g.r1 + 1 }; }
      if (op === 'unmerge') { for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const cell = t.rows[r][c]; if (cell.cs || cell.rs) { for (let rr = r; rr < r + (cell.rs || 1); rr++) for (let cc = c; cc < c + (cell.cs || 1); cc++) if (rr !== r || cc !== c) t.rows[rr][cc] = { html: '' }; delete cell.cs; delete cell.rs; } } }
      if (op === 'even-cols') { const w2 = t.colW.reduce((a, b) => a + b, 0) / t.colW.length; t.colW = t.colW.map(() => Math.round(w2)); }
      if (op === 'even-rows') { const h2 = t.rowH.reduce((a, b) => a + b, 0) / t.rowH.length; t.rowH = t.rowH.map(() => Math.round(h2)); }
      if (op === 'header') { if (t.hdr) delete t.hdr; else t.hdr = 1; }
      // merged cells can't hang over removed rows/columns: unmerge anything that no longer fits
      t.rows.forEach((row, r) => row.forEach((cell, c) => { if (cell.hide) { let covered = false; for (let rr = 0; rr <= r; rr++) for (let cc = 0; cc <= c; cc++) { const a2 = t.rows[rr][cc]; if (!a2.hide && rr + (a2.rs || 1) > r && cc + (a2.cs || 1) > c && (rr !== r || cc !== c)) covered = true; } if (!covered) delete cell.hide; } }));
    });
    if (op === 'merge') cellSel = { ...g, r2: g.r1, c2: g.c1 }; else if (op.startsWith('del')) cellSel = null;
    draw();
  }
  const cellsDo = (fn) => { const it = item(); if (it?.t !== 'table' || !cellSel) return false; edit((d, sl) => { const t = sl.items.find((x) => x.id === it.id); for (let r = cellSel.r1; r <= cellSel.r2; r++) for (let c = cellSel.c1; c <= cellSel.c2; c++) fn(t.rows[r][c], t); }); return true; };
  function insertTable() {
    let out = null;
    openModal({ title: 'Insert table', body: `<form class="form" id="gs-tbl"><div class="gs-tblpick" role="grid" aria-label="Table size">${Array.from({ length: 8 }, (_, r) => Array.from({ length: 10 }, (__, c) => `<i data-rc="${r + 1},${c + 1}"></i>`).join('')).join('')}</div><p class="muted gs-tblsize">3 × 3</p><div class="gs-fields"><label>Columns<input name="c" value="3"></label><label>Rows<input name="r" value="3"></label></div></form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="gs-tbl">Insert</button>',
      onMount: (el, close) => { const f = el.querySelector('#gs-tbl'); const pick = f.querySelector('.gs-tblpick');
        const show = (r, c) => { pick.querySelectorAll('i').forEach((x) => { const [rr, cc] = x.dataset.rc.split(',').map(Number); x.classList.toggle('on', rr <= r && cc <= c); }); f.querySelector('.gs-tblsize').textContent = `${c} × ${r}`; f.elements.c.value = c; f.elements.r.value = r; };
        pick.addEventListener('mouseover', (e) => { const i = e.target.closest('[data-rc]'); if (i) show(...i.dataset.rc.split(',').map(Number)); });
        pick.addEventListener('click', (e) => { const i = e.target.closest('[data-rc]'); if (i) { const [r, c] = i.dataset.rc.split(',').map(Number); out = { r, c }; close(); } });
        f.addEventListener('submit', (e) => { e.preventDefault(); out = { r: Math.max(1, Math.min(30, Number(f.elements.r.value) || 3)), c: Math.max(1, Math.min(20, Number(f.elements.c.value) || 3)) }; close(); }); show(3, 3); },
      onClose: () => setTimeout(() => { if (!out) return; const w = Math.min(840, out.c * 140), h = out.r * 40;
        addItem({ t: 'table', x: Math.round((S.W - w) / 2), y: Math.round((H() - h) / 2), w, h, rows: Array.from({ length: out.r }, () => Array.from({ length: out.c }, () => ({ html: '' }))), colW: Array(out.c).fill(Math.round(w / out.c)), rowH: Array(out.r).fill(40), bc: '#9aa0a6', bw: 1, fs: 16 }); }, 30) });
  }
  const ytId = (u) => { const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(u) || /^([\w-]{11})$/.exec(u.trim()); return m ? m[1] : null; };
  function insertVideo() {
    let out = null;
    openModal({ title: 'Insert video', body: `<form class="form" id="gs-vid"><label class="field"><span>YouTube link</span><input name="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off"></label><label class="field"><span>Start at (seconds, optional)</span><input name="start" inputmode="numeric"></label><p class="muted">The video plays during the slideshow. It needs an internet connection.</p></form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="gs-vid">Insert</button>',
      onMount: (el, close) => { const f = el.querySelector('#gs-vid'); setTimeout(() => f.elements.url.focus(), 40); f.addEventListener('submit', (e) => { e.preventDefault(); const id = ytId(f.elements.url.value); if (!id) { toast('That isn’t a YouTube link', { tone: 'error' }); return; } const t = /[?&]t=(\d+)/.exec(f.elements.url.value); out = { id, start: Number(f.elements.start.value) || (t ? Number(t[1]) : 0) }; close(); }); },
      onClose: () => setTimeout(() => { if (out) addItem({ t: 'video', yt: out.id, ...(out.start ? { start: out.start } : {}), x: 240, y: Math.round(H() / 2 - 135), w: 480, h: 270 }); }, 30) });
  }
  function wordArtText(it = null) {
    let out = null;
    openModal({ title: it ? 'Edit Word Art' : 'Word Art', body: `<form class="form" id="gs-wa"><label class="field"><span>Text</span><input name="t" value="${esc(it?.text || '')}" maxlength="200" autocomplete="off"></label></form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="gs-wa">OK</button>',
      onMount: (el, close) => { const f = el.querySelector('#gs-wa'); setTimeout(() => f.elements.t.select(), 40); f.addEventListener('submit', (e) => { e.preventDefault(); out = f.elements.t.value.trim(); close(); }); },
      onClose: () => setTimeout(() => { if (!out) return; if (it) edit((d, sl) => { sl.items.find((x) => x.id === it.id).text = out; }); else addItem({ t: 'wordart', text: out, x: 240, y: Math.round(H() / 2 - 55), w: 480, h: 110, fill: S.themeOf(deck).accent, stroke: '', sw: 0, b: 1 }); }, 30) });
  }
  function backgroundDialog() {
    const sl = slide(); let mode = sl.bgImg ? 'image' : sl.bgGrad ? 'gradient' : 'color'; let img = sl.bgImg || null; let done = null;
    openModal({ title: 'Background', body: `<form class="form" id="gs-bg"><div class="xl-cols">${[['color', 'Colour'], ['gradient', 'Gradient'], ['image', 'Image']].map(([v, l]) => `<label class="xl-radio"><input type="radio" name="m" value="${v}" ${mode === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="gs-fields gs-bg-color"><label>Colour<input type="color" name="c" value="${sl.bg || S.themeOf(deck).bg}"></label></div>
      <div class="gs-fields gs-bg-grad"><label>From<input type="color" name="a" value="${sl.bgGrad?.a || '#4285f4'}"></label><label>To<input type="color" name="b" value="${sl.bgGrad?.b || '#a142f4'}"></label><label>Angle (°)<input name="ang" value="${sl.bgGrad?.ang ?? 135}"></label></div>
      <div class="gs-bg-img"><button type="button" class="btn btn-plain btn-sm" data-bgimg>Choose image…</button> <span class="muted gs-bgimg-name">${img ? 'Image chosen' : 'No image'}</span></div>
      <div class="gs-btnrow"><button type="button" class="btn btn-plain btn-sm" data-reset>Reset to theme</button></div></form>`,
      footer: '<button class="btn btn-plain" data-all>Apply to all slides</button><button class="btn btn-primary" data-done>Done</button>',
      onMount: (el, close) => {
        const f = el.querySelector('#gs-bg'); const sync = () => { mode = f.elements.m.value; f.querySelector('.gs-bg-color').hidden = mode !== 'color'; f.querySelector('.gs-bg-grad').hidden = mode !== 'gradient'; f.querySelector('.gs-bg-img').hidden = mode !== 'image'; }; f.addEventListener('change', sync); sync();
        f.querySelector('[data-bgimg]').addEventListener('click', () => { const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' }); inp.onchange = async () => { const file = inp.files[0]; if (!file) return; try { const up = await store.uploadFile(file, { noteId, name: file.name }); img = up.url; f.querySelector('.gs-bgimg-name').textContent = file.name; } catch (err) { toast(err.message, { tone: 'error' }); } }; inp.click(); });
        const value = () => (mode === 'color' ? { bg: f.elements.c.value, bgGrad: null, bgImg: null } : mode === 'gradient' ? { bg: null, bgGrad: { a: f.elements.a.value, b: f.elements.b.value, ang: Number(f.elements.ang.value) || 0 }, bgImg: null } : { bg: null, bgGrad: null, bgImg: img });
        f.querySelector('[data-reset]').addEventListener('click', () => { done = { v: { bg: null, bgGrad: null, bgImg: null }, all: false }; close(); });
        el.querySelector('[data-done]').addEventListener('click', () => { done = { v: value(), all: false }; close(); });
        el.querySelector('[data-all]').addEventListener('click', () => { done = { v: value(), all: true }; close(); });
      },
      onClose: () => setTimeout(() => { if (!done) return; const apply = (x) => { for (const k2 of ['bg', 'bgGrad', 'bgImg']) { if (done.v[k2]) x[k2] = done.v[k2]; else delete x[k2]; } };
        if (target) { toast('Backgrounds are set per slide (outside the theme builder)'); return; }
        edit((d, s2) => { if (done.all) d.slides.forEach(apply); else apply(s2); }); }, 30) });
  }
  function slideNumbers() {
    let out = null;
    openModal({ title: 'Slide numbers', body: `<form class="form" id="gs-num"><label class="xl-radio"><input type="radio" name="on" value="1" ${deck.num?.on ? 'checked' : ''}> On</label><label class="xl-radio"><input type="radio" name="on" value="" ${deck.num?.on ? '' : 'checked'}> Off</label><label class="xl-check"><input type="checkbox" name="skip" ${deck.num?.skipTitle ? 'checked' : ''}> Skip title slides</label></form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="gs-num">Apply</button>',
      onMount: (el, close) => el.querySelector('#gs-num').addEventListener('submit', (e) => { e.preventDefault(); out = { on: !!e.target.elements.on.value, skip: e.target.elements.skip.checked }; close(); }),
      onClose: () => setTimeout(() => { if (out) edit((d) => { if (out.on) d.num = { on: true, ...(out.skip ? { skipTitle: true } : {}) }; else delete d.num; }); }, 30) });
  }
  function applyLayoutTo(layout) { const idx = slidesPicked(); edit((d) => { for (const i of idx) d.slides[i] = S.applyLayout(d.slides[i], layout, d.ratio, d); }); }
  function themeBuilder(open) {
    if (editingId) stopText?.();
    target = open ? (target || 'master') : null; setSel(null); cellSel = null; cropId = null;
    if (open) toast('Theme builder: edit the master (on every slide) and the layouts. New slides use the edited layouts.');
    draw();
  }
  /* a Google-style colour picker: theme colours, a standard palette, custom, transparent */
  const STD = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff', '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff', '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc', '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd', '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'];
  function colorMenu(anchor, current, pick, { transparent = false } = {}) {
    document.querySelector('.gs-colors')?.remove();
    const th = S.themeOf(deck); const theme = [...new Set([th.ink, th.bg, th.accent, th.muted])];
    const pop = document.createElement('div'); pop.className = 'gs-colors'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Colour');
    pop.innerHTML = `${transparent ? '<button type="button" class="gs-transparent" data-col="">Transparent</button>' : ''}<div class="menu-label">Theme</div><div class="gs-swatch-row">${theme.map((c) => `<button type="button" data-col="${c}" style="background:${c}" aria-label="${c}" class="${c === current ? 'on' : ''}"></button>`).join('')}</div><div class="menu-label">Standard</div><div class="gs-swatch-grid">${STD.map((c) => `<button type="button" data-col="${c}" style="background:${c}" aria-label="${c}" class="${c === current ? 'on' : ''}"></button>`).join('')}</div><label class="gs-custom">Custom <input type="color" value="${current || '#000000'}"></label>`;
    document.body.appendChild(pop); const r = anchor.getBoundingClientRect(); pop.style.left = `${Math.min(r.left, innerWidth - 260)}px`; pop.style.top = `${r.bottom + 4}px`;
    const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = (e) => { if (!pop.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    pop.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // keeps a text selection
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-col]'); if (b) { pick(b.dataset.col); close(); } });
    pop.querySelector('input[type="color"]').addEventListener('change', (e) => { pick(e.target.value); close(); });
    keyboardPopover(pop, anchor, close);
  }
  /** Keyboard for the colour and shape pickers: focus goes in, arrows move between swatches, Escape closes and returns focus. */
  function keyboardPopover(pop, anchor, close) {
    const items = () => [...pop.querySelectorAll('button, input')];
    (pop.querySelector('button.on') || items()[0])?.focus();
    pop.addEventListener('keydown', (e) => {
      const list = items(); const i = list.indexOf(document.activeElement);
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 10, ArrowUp: -10 }[e.key];
      if (step) { e.preventDefault(); list[Math.max(0, Math.min(list.length - 1, i + step))]?.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus?.(); }
      if (e.key === 'Tab' && !e.shiftKey && i === list.length - 1) { close(); anchor.focus?.(); }
    });
  }

  /* =================== Phase C: motion, skip, import, downloads, linked charts =================== */
  const itemLabel = (it) => (it ? (it.t === 'text' || it.html ? `${S.plainText(it.html || '').trim().slice(0, 28) || (it.role ? S.PLACEHOLDER[it.role] : 'Text box')}` : it.t === 'shape' ? S.SHAPE_LIB[it.shape]?.label || 'Shape' : it.t === 'wordart' ? `Word art: ${it.text.slice(0, 20)}` : { image: 'Image', chart: 'Chart', line: 'Line', table: 'Table', video: 'Video' }[it.t] || it.t) : 'Deleted object');
  function addAnimation() {
    const it = item(); if (!it) { toast('Select an object to animate'); return; }
    const a = { id: S.newId(), item: it.id, fx: 'fadeIn', start: 'click', dur: 0.5 };
    edit((d, sl) => { sl.anims = [...(sl.anims || []), a]; }); animSel = a.id; togglePanel('motion', true);
  }
  const editAnim = (id, fn) => edit((d, sl) => { const a = (sl.anims || []).find((x) => x.id === id); if (a) fn(a, sl); });
  function moveAnim(id, dir) { edit((d, sl) => { const L = sl.anims || []; const i2 = L.findIndex((x) => x.id === id); const j = i2 + dir; if (i2 < 0 || j < 0 || j >= L.length) return; [L[i2], L[j]] = [L[j], L[i2]]; }); }
  function playPreview() { // plays this slide's transition and every animation step in the editor, then restores it
    if (target) return; const sl = slide(); const steps = S.animationSteps(sl); drawCanvas();
    const stage = canvas.querySelector('.sl-stage'); stage.querySelectorAll('.gs-sel, .gs-outline, .gs-lineends, .gs-chart-update').forEach((n) => n.remove());
    const first = new Map(); for (const a of sl.anims || []) if (!first.has(a.item)) first.set(a.item, a.fx);
    for (const [id, fx] of first) if (S.EFFECTS[fx]?.kind === 'in') { const el = stage.querySelector(`.sl-item[data-id="${id}"]`); if (el) el.style.visibility = 'hidden'; }
    if (sl.tr) stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: sl.tr.dur * 1000 });
    let delay = sl.tr ? sl.tr.dur * 1000 : 0;
    steps.forEach((st) => { setTimeout(() => { if (canvas.contains(stage)) playStep(stage, st); }, delay); delay += Math.max(600, st.reduce((t2, a) => t2 + a.dur * 1000, 0) + 400); });
    setTimeout(() => { if (canvas.contains(stage)) drawCanvas(); }, delay + 300);
  }
  function setTransition(type, dur, all = false) {
    edit((d) => { const apply = (x) => { if (type === 'none') delete x.tr; else x.tr = { type, dur }; }; if (all) d.slides.forEach(apply); else slidesPicked().forEach((i2) => apply(d.slides[i2])); });
  }
  function toggleSkip() { const idx = slidesPicked(); const on = !deck.slides[idx[0]]?.skip; edit((d) => idx.forEach((i2) => { if (on) d.slides[i2].skip = true; else delete d.slides[i2].skip; })); toast(on ? `Skipped in the slideshow${idx.length > 1 ? ` (${idx.length} slides)` : ''}` : 'Shown in the slideshow'); }
  /** Copy slides from another presentation in after the current one (new ids; connectors re-linked; theme optional). */
  function insertSlideCopies(src, picks, keep, th) {
    const copies = picks.map((i2) => { const sl = structuredClone(src.slides[i2]); sl.id = S.newId(); const idMap = {}; sl.items = sl.items.map((x) => { const nid = S.newId(); idMap[x.id] = nid; return { ...x, id: nid }; }); sl.items.forEach((x) => { for (const k2 of ['from', 'to']) if (x[k2]) x[k2] = { ...x[k2], id: idMap[x[k2].id] || x[k2].id }; }); if (sl.anims) sl.anims = sl.anims.map((a) => ({ ...a, id: S.newId(), item: idMap[a.item] || a.item }));
          if (keep) { if (!sl.bg && !sl.bgGrad && !sl.bgImg) sl.bg = th.bg; sl.items.forEach((x) => { if ((x.t === 'text' || x.t === 'table') && !x.color) x.color = th.ink; }); }
          return sl; });
    edit((d) => d.slides.splice(cur + 1, 0, ...copies)); cur += 1; selSlides = new Set(copies.map((_, j) => cur + j)); draw(); toast(`Imported ${copies.length} slide${copies.length === 1 ? '' : 's'}`);
  }
  /** Insert → Existing file: a live link (a card on the slide), or a copy: text, a table, or slides. */
  /* Comments on slide objects (presentation files): the comments panel draws threads; this marks objects and shows them. */
  function commentHere() {
    const it = selected()[0];
    document.dispatchEvent(new CustomEvent('doc:comment-anchor', { detail: { type: 'item', slide: slide().id, item: it?.id || '', label: it ? `Slide ${cur + 1} · ${itemLabel(it)}` : `Slide ${cur + 1}` } }));
  }
  const onCommentAnchors = (e) => { if (!fileMode) return; commentedItems = new Map((e.detail?.anchors || []).filter((a) => a.type === 'item').map((a) => [`${a.slide}/${a.item}`, a.id])); draw(); };
  const onCommentGoto = (e) => {
    if (!fileMode || !e.detail) return; document.__pendingGoto = null; const i = deck.slides.findIndex((x) => x.id === e.detail.slide);
    if (i < 0) { toast('That slide no longer exists'); return; }
    cur = i; selSlides = new Set([i]); setSel(e.detail.item && item(e.detail.item) ? e.detail.item : null); draw();
  };
  document.addEventListener('comments:anchors', onCommentAnchors);
  document.addEventListener('slides:goto', onCommentGoto);
  if (document.__commentAnchors) queueMicrotask(() => onCommentAnchors({ detail: { anchors: document.__commentAnchors } })); // the comments may have loaded first
  if (fileMode && document.__pendingGoto?.type === 'item') { const g = document.__pendingGoto; setTimeout(() => onCommentGoto({ detail: g }), 0); } // opened from a search result
  /** A table copy of a spreadsheet (a range, or its first 20 × 8 cells) in the given box. */
  async function tableFrom(f, ref, box) {
    const d = blockOf(f.content, 'sheet'); if (!d) return null; await loadSheetEngine(); const E = sheetEngine();
    const wb = E.normalizeWorkbook(ref.part ? sheetRange(E, d, ref.part) : d); const sh = wb.sheets.find((x) => !x.hidden) || wb.sheets[0]; if (!sh) return null;
    const shown = E.displayWorkbook(wb)[sh.name] || {};
    let rows = 0, cols = 0; for (const k of Object.keys(sh.cells)) { const p2 = E.parseKey(k); if (p2) { rows = Math.max(rows, p2.row + 1); cols = Math.max(cols, p2.col + 1); } }
    rows = Math.min(Math.max(rows, 1), 20); cols = Math.min(Math.max(cols, 1), 8); // a table on a slide stays readable
    const w = Math.min(box.w, cols * 120), h = Math.min(box.h, rows * 34);
    return { t: 'table', x: box.x, y: box.y, w, h, rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ html: esc(shown[E.cellKey(r, c)]?.text ?? '') }))), colW: Array(cols).fill(Math.round(w / cols)), rowH: Array(rows).fill(Math.round(h / rows)), bc: '#9aa0a6', bw: 1, fs: 14 };
  }
  /** A text copy of a document in the given box. */
  function textFrom(f, box) {
    const text = plainOf(f.content).slice(0, 3000);
    return { t: 'text', ...box, h: Math.min(box.h, 60 + Math.ceil(text.length / 90) * 22), html: text.split('\n').map((l) => `<div>${esc(l) || '<br>'}</div>`).join(''), fs: 16 };
  }
  /** "Make a copy here" on a linked file: the same box becomes an editable table or text (or the slides are copied in). */
  async function copyLinkedItem(it) {
    const ref = it.ref; const f = await fetchEmbed(ref.id, { fresh: true });
    if (!f) { toast('That file isn’t available to you.', { tone: 'error' }); return; }
    const box = { x: it.x, y: it.y, w: it.w, h: it.h };
    if (f.kind === 'slides') {
      const src = S.normalizeDeck(blockOf(f.content, 'slides') || {}); if (!src.slides.length) return;
      const byId = ref.part ? src.slides.findIndex((x) => ref.part.slide && x.id === ref.part.slide) : -1;
      const picks = ref.part ? [byId >= 0 ? byId : Math.min(src.slides.length - 1, Math.max(0, ref.part.n ?? 0))] : src.slides.map((_, i) => i);
      edit((d) => { d.slides[cur].items = d.slides[cur].items.filter((x) => x.id !== it.id); }); insertSlideCopies(src, picks, true, S.themeOf(src)); return;
    }
    const made = f.kind === 'sheet' ? await tableFrom(f, ref, box) : textFrom(f, box); if (!made) return;
    edit((d) => { const sl = d.slides[cur]; const i = sl.items.findIndex((x) => x.id === it.id); if (i >= 0) sl.items[i] = { ...made, id: it.id, z: it.z }; });
    draw(); toast('Made a copy. It won’t change when the original does.');
  }
  async function insertFileFromApp() {
    const pick = await pickFile({ exclude: noteId }); if (!pick) return;
    const { mode, ref } = pick; const Hh = H();
    if (mode === 'link') { addItem({ t: 'file', ref, x: Math.round(S.W / 2 - 280), y: Math.round(Hh / 2 - 170), w: 560, h: 340 }); return; }
    const f = await fetchEmbed(ref.id, { fresh: true }); // the latest version (and the access check)
    if (!f) { toast('That file isn’t available to you.', { tone: 'error' }); return; }
    if (f.kind === 'slides') {
      const src = S.normalizeDeck(blockOf(f.content, 'slides') || {}); if (!src.slides.length) return;
      const byId = ref.part ? src.slides.findIndex((x) => ref.part.slide && x.id === ref.part.slide) : -1;
      const picks = ref.part ? [byId >= 0 ? byId : Math.min(src.slides.length - 1, Math.max(0, ref.part.n ?? 0))] : src.slides.map((_, i) => i);
      insertSlideCopies(src, picks, true, S.themeOf(src)); return;
    }
    if (f.kind === 'sheet') { const t = await tableFrom(f, ref, { x: 60, y: 80, w: S.W - 120, h: Hh - 120 }); if (t) addItem(t); return; }
    addItem(textFrom(f, { x: 60, y: 60, w: S.W - 120, h: Hh - 120 }));
  }
  async function importSlides() {
    if (target) return;
    const decks = appState.notes.filter((n) => n.kind === 'slides' && n.id !== noteId && !n.deletedAt);
    if (!decks.length) { toast('You have no other presentations to import from'); return; }
    let chosen = null; let src = null;
    openModal({ title: 'Import slides', body: `<form class="form" id="gs-imp"><label class="field"><span>Presentation</span><select name="p">${decks.map((n) => `<option value="${esc(n.id)}">${esc(n.title || 'Untitled presentation')}</option>`).join('')}</select></label><div class="gs-import-slides" aria-live="polite"><p class="muted">Loading…</p></div><div class="gs-btnrow"><label class="xl-check"><input type="checkbox" name="all"> All slides</label><label class="xl-check"><input type="checkbox" name="keep" checked> Keep original theme</label></div></form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="gs-imp">Import slides</button>',
      onMount: (el, close) => {
        const f = el.querySelector('#gs-imp'); const grid = f.querySelector('.gs-import-slides');
        const load = async () => { grid.innerHTML = '<p class="muted">Loading…</p>'; try { const n = await (await fetch(`/api/notes/${encodeURIComponent(f.elements.p.value)}`, { headers: { 'X-Requested-With': 'workspace' } })).json(); const m = /\[\[slides:([A-Za-z0-9_-]+)/.exec(n.content || ''); src = m ? S.normalizeDeck(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))))) : null; } catch { src = null; }
          if (!src) { grid.innerHTML = '<p class="muted">Couldn’t open that presentation.</p>'; return; }
          grid.innerHTML = src.slides.map((sl, i2) => `<label><input type="checkbox" name="s" value="${i2}"> ${slideFrame(src, sl)}<span>Slide ${i2 + 1}</span></label>`).join(''); };
        f.elements.p.addEventListener('change', load); load();
        f.elements.all.addEventListener('change', () => f.querySelectorAll('[name=s]').forEach((x) => { x.checked = f.elements.all.checked; }));
        f.addEventListener('submit', (e) => { e.preventDefault(); const pick = [...f.querySelectorAll('[name=s]:checked')].map((x) => Number(x.value)); if (!src || !pick.length) { toast('Choose at least one slide', { tone: 'error' }); return; } chosen = { pick, keep: f.elements.keep.checked }; close(); });
      },
      onClose: () => setTimeout(() => {
        if (!chosen) return; const th = S.themeOf(src);
        insertSlideCopies(src, chosen.pick, chosen.keep, th);
      }, 30) });
  }
  /* pictures of a slide: the slide is drawn as SVG (HTML inside), images are embedded; PNG/JPEG go through a canvas */
  async function slideSvg(sl) {
    const Hh = H(); const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-99999px;top:0'; host.innerHTML = slideFrame(deck, sl, { live: false }); document.body.appendChild(host);
    const frame = host.querySelector('.sl-frame'); frame.style.cssText += `;width:${S.W}px;--k:1`;
    for (const im of host.querySelectorAll('img')) { // embed pictures; YouTube thumbnails (another site) become a dark box
      try { if (!im.src.startsWith(location.origin)) throw new Error('external'); const b = await (await fetch(im.src)).blob(); im.src = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); } catch { im.removeAttribute('src'); im.style.background = '#111'; }
    }
    const bg = frame.querySelector('.sl-stage').style.background; const m = /url\('([^']+)'\)/.exec(bg || '');
    if (m) { try { const b = await (await fetch(m[1])).blob(); const du = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); frame.querySelector('.sl-stage').style.background = bg.replace(m[1], du); } catch { /* keep the colour */ } }
    let css = ''; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if (/\.sl-|\.deck-thumb/.test(r.cssText) && !/@media/.test(r.cssText.slice(0, 7))) css += r.cssText; } catch { /* another site's stylesheet */ } }
    const xhtml = new XMLSerializer().serializeToString(frame);
    host.remove();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S.W}" height="${Hh}" viewBox="0 0 ${S.W} ${Hh}"><foreignObject x="0" y="0" width="${S.W}" height="${Hh}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${S.W}px;height:${Hh}px;font-family:system-ui,sans-serif"><style>${css.replace(/</g, '\\3c ')}</style>${xhtml}</div></foreignObject></svg>`;
  }
  const saveBlob = (blob, name) => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  async function downloadSlide(fmt) {
    const n = `${title} - slide ${cur + 1}`;
    if (fmt === 'txt') { const text = deck.slides.map((sl, i2) => `Slide ${i2 + 1}\n${sl.items.flatMap((x) => (x.html ? [S.plainText(x.html).trim()] : x.t === 'wordart' ? [x.text] : x.t === 'table' ? x.rows.map((r) => r.filter((c) => !c.hide).map((c) => S.plainText(c.html)).join('\t')) : [])).filter(Boolean).join('\n')}${sl.notes ? `\n\nSpeaker notes: ${sl.notes}` : ''}`).join('\n\n'); saveBlob(new Blob([text], { type: 'text/plain' }), `${title}.txt`); return; }
    const svg = await slideSvg(slide());
    if (fmt === 'svg') { saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${n}.svg`); return; }
    const img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await new Promise((r, j) => { img.onload = r; img.onerror = j; }).catch(() => null);
    const c = document.createElement('canvas'); c.width = S.W * 2; c.height = H() * 2; const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    try { c.toBlob((b) => (b ? saveBlob(b, `${n}.${fmt === 'jpeg' ? 'jpg' : 'png'}`) : toast('Couldn’t make the picture', { tone: 'error' })), fmt === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92); }
    catch { toast('This browser can’t save slides as pictures. Download as SVG or PDF instead.', { tone: 'error' }); }
  }
  /* charts linked to a spreadsheet in the app (Insert → Chart → From a spreadsheet) */
  const sheetDataCache = new Map();
  async function sheetData(id, fresh = false) {
    const maxAge = fresh ? 0 : 3000; // a few seconds old at most, so redraws don't refetch constantly
    if (sheetDataCache.has(id) && Date.now() - sheetDataCache.get(id).at <= maxAge) return sheetDataCache.get(id).data;
    const n = await (await fetch(`/api/notes/${encodeURIComponent(id)}`, { headers: { 'X-Requested-With': 'workspace' } })).json();
    const m = /\[\[sheet:([A-Za-z0-9_-]+)/.exec(n.content || ''); if (!m) throw new Error('That spreadsheet has no data');
    const json = new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)));
    const E2 = await loadSheetEngine(); bindSheet(E2); const wb = E2.normalizeWorkbook(JSON.parse(json));
    const data = { wb, E: E2, title: n.title }; sheetDataCache.set(id, { at: Date.now(), data }); return data;
  }
  async function specFromSheet(link, t, title2) {
    const { wb } = await sheetData(link.noteId); const sh = wb.sheets.find((x) => x.name === link.sheet) || wb.sheets[0];
    const spec = sheetChartSpec(wb, sh, { range: link.range, t, title: title2, legend: true, byRow: !!link.byRow });
    if (!spec) throw new Error('That range has no chart data'); return spec;
  }
  let checking = false, again = false;
  async function checkLinkedCharts() {
    if (!editable) return; if (checking) { again = true; return; } const charts = slide()?.items.filter((x) => x.t === 'chart' && x.link) || []; if (!charts.length) return;
    checking = true; again = false; let changed = false;
    try { for (const ch of charts) { try { const spec = await specFromSheet(ch.link, ch.spec?.t || 'column', ch.spec?.title || ''); const now = { ...spec, series: spec.series.map((x2, i2) => ({ ...x2, c: ch.spec?.series?.[i2]?.c || x2.c })) }; const differs = JSON.stringify([now.labels, now.series.map((x2) => [x2.n, x2.v])]) !== JSON.stringify([ch.spec?.labels, (ch.spec?.series || []).map((x2) => [x2.n, x2.v])]); if (differs !== linkedFresh.has(ch.id)) changed = true; if (differs) linkedFresh.set(ch.id, now); else linkedFresh.delete(ch.id); } catch { /* the spreadsheet is gone or unreadable */ } } }
    finally { checking = false; }
    if (changed && !editingId) drawCanvas(); else if (again) setTimeout(checkLinkedCharts, 3100);
  }
  function insertLinkedChart() {
    const sheets = appState.notes.filter((n) => n.kind === 'sheet' && !n.deletedAt);
    if (!sheets.length) { toast('You have no spreadsheets yet. Make one from the Documents page.'); return; }
    let out = null;
    openModal({ title: 'Chart from a spreadsheet', body: `<form class="form" id="gs-lc"><label class="field"><span>Spreadsheet</span><select name="n">${sheets.map((n) => `<option value="${esc(n.id)}">${esc(n.title || 'Untitled spreadsheet')}</option>`).join('')}</select></label><div class="gs-fields"><label>Sheet<select name="sh"></select></label><label>Range<input name="r" placeholder="A1:C6"></label><label>Chart type<select name="t"><option value="column">Column</option><option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option></select></label><label>Title<input name="title"></label></div><p class="muted">The chart stays linked: when the spreadsheet changes, an Update button appears on it.</p></form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="gs-lc">Insert</button>',
      onMount: (el, close) => {
        const f = el.querySelector('#gs-lc');
        const load = async () => { try { const { wb, E: E2 } = await sheetData(f.elements.n.value, true); f.elements.sh.innerHTML = wb.sheets.map((x) => `<option>${esc(x.name)}</option>`).join(''); const u = E2.usedRange(wb.sheets[0]); f.elements.r.value = u.rows && u.cols ? `A1:${E2.cellKey(u.rows - 1, u.cols - 1)}` : 'A1:B5'; } catch (err) { toast(err.message, { tone: 'error' }); } };
        f.elements.n.addEventListener('change', load); f.elements.sh.addEventListener('change', async () => { const { wb, E: E2 } = await sheetData(f.elements.n.value); const u = E2.usedRange(wb.sheets.find((x) => x.name === f.elements.sh.value)); f.elements.r.value = u.rows && u.cols ? `A1:${E2.cellKey(u.rows - 1, u.cols - 1)}` : 'A1:B5'; }); load();
        f.addEventListener('submit', async (e) => { e.preventDefault(); const link = { noteId: f.elements.n.value, sheet: f.elements.sh.value, range: f.elements.r.value.trim().toUpperCase().replace(/\$/g, '') }; try { const spec = await specFromSheet(link, f.elements.t.value, f.elements.title.value.trim()); out = { link, spec }; close(); } catch (err) { toast(err.message, { tone: 'error' }); } });
      },
      onClose: () => setTimeout(() => { if (out) addItem({ t: 'chart', x: 220, y: Math.round(H() / 2 - 160), w: 520, h: 320, spec: out.spec, link: out.link }); }, 30) });
  }
  // a comment badge: show its thread (before the canvas treats the click as selecting or dragging)
  canvas.addEventListener('pointerdown', (e) => { const b = e.target.closest('.gs-cmt[data-cmt]'); if (!b) return; e.preventDefault(); e.stopPropagation(); document.dispatchEvent(new CustomEvent('doc:comment-focus', { detail: { id: b.dataset.cmt } })); }, true);
  canvas.addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-chart-update]'); if (!b) return; e.preventDefault(); e.stopImmediatePropagation(); const id = b.dataset.chartUpdate; const fresh = linkedFresh.get(id); if (!fresh) return; linkedFresh.delete(id); edit((d, sl) => { const x = sl.items.find((y) => y.id === id); if (x) x.spec = fresh; }); toast('Chart updated from the spreadsheet'); }, true);

  /* =================== Smart guides and snapping =================== */
  function snap(box, others, thr, { edgesX = ['l', 'c', 'r'], edgesY = ['t', 'm', 'b'] } = {}) {
    const tx = [0, S.W / 2, S.W], ty = [0, H() / 2, H()];
    for (const o of others) { tx.push(o.x, o.x + o.w / 2, o.x + o.w); ty.push(o.y, o.y + o.h / 2, o.y + o.h); }
    const posX = { l: box.x, c: box.x + box.w / 2, r: box.x + box.w }, posY = { t: box.y, m: box.y + box.h / 2, b: box.y + box.h };
    let bx = null, by = null;
    for (const e of edgesX) for (const t of tx) { const d = t - posX[e]; if (Math.abs(d) <= thr && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: t }; }
    for (const e of edgesY) for (const t of ty) { const d = t - posY[e]; if (Math.abs(d) <= thr && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: t }; }
    const spacing = [];
    const equal = (axis) => {
      const [p, sz, q, qs] = axis === 'x' ? ['x', 'w', 'y', 'h'] : ['y', 'h', 'x', 'w'];
      const row = others.filter((o) => o[q] < box[q] + box[qs] && o[q] + o[qs] > box[q]).sort((m, n) => m[p] - n[p]);
      let best = null;
      for (let i = 0; i + 1 < row.length; i++) { const A = row[i], B = row[i + 1]; const gap = B[p] - (A[p] + A[sz]); if (gap <= 0) continue; for (const c of [B[p] + B[sz] + gap, A[p] - gap - box[sz]]) { const d = c - box[p]; if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, pairs: [[A, B]] }; } }
      for (let i = 0; i + 1 < row.length; i++) { const A = row[i], B = row[i + 1]; const room = B[p] - (A[p] + A[sz]) - box[sz]; if (room <= 0) continue; const d = A[p] + A[sz] + room / 2 - box[p]; if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, between: [A, B] }; }
      return best;
    };
    const ex = edgesX.length === 3 ? equal('x') : null, ey = edgesY.length === 3 ? equal('y') : null;
    if (ex && (!bx || Math.abs(ex.d) < Math.abs(bx.d))) { bx = { d: ex.d, eq: 1 }; spacing.push({ axis: 'x', ...ex }); }
    if (ey && (!by || Math.abs(ey.d) < Math.abs(by.d))) { by = { d: ey.d, eq: 1 }; spacing.push({ axis: 'y', ...ey }); }
    return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, gx: bx && !bx.eq ? bx.at : null, gy: by && !by.eq ? by.at : null, spacing };
  }
  function drawGuides(stage, g, box) {
    stage.querySelectorAll('.deck-guide, .deck-gap').forEach((n) => n.remove()); if (!g) return;
    const add = (cls, css) => stage.insertAdjacentHTML('beforeend', `<div class="${cls}" style="${css}"></div>`);
    if (g.gx !== null) add('deck-guide v', `left:${g.gx}px;top:0;height:${H()}px`);
    if (g.gy !== null) add('deck-guide h', `top:${g.gy}px;left:0;width:${S.W}px`);
    for (const sp of g.spacing) {
      const gaps = []; const [p, sz] = sp.axis === 'x' ? ['x', 'w'] : ['y', 'h'];
      if (sp.between) { const [A, B] = sp.between; gaps.push([A[p] + A[sz], box[p]], [box[p] + box[sz], B[p]]); } else { const [A, B] = sp.pairs[0]; gaps.push([A[p] + A[sz], B[p]]); gaps.push(box[p] >= B[p] + B[sz] ? [B[p] + B[sz], box[p]] : [box[p] + box[sz], A[p]]); }
      gaps.forEach(([a, b]) => (sp.axis === 'x' ? add('deck-gap h', `left:${Math.min(a, b)}px;top:${box.y + box.h / 2}px;width:${Math.abs(b - a)}px`) : add('deck-gap v', `top:${Math.min(a, b)}px;left:${box.x + box.w / 2}px;height:${Math.abs(b - a)}px`)));
    }
  }
  const gridSnap = (v) => (snapGrid ? Math.round(v / GRID) * GRID : v);

  /* =================== Mouse: select, draw, move, resize, rotate =================== */
  canvas.addEventListener('pointerdown', (e) => {
    if (!editable || e.button === 2) return;
    if (e.target.closest('.sl-rich.editing')) return;
    const stage = canvas.querySelector('.sl-stage'); if (!stage) return;
    const k = scale(); const sr = stage.getBoundingClientRect();
    const at = (ev) => ({ x: (ev.clientX - sr.left) / k, y: (ev.clientY - sr.top) / k });
    canvas.focus({ preventScroll: true });
    const handle = e.target.closest('[data-h]'), rotH = e.target.closest('[data-rot]');
    const el = e.target.closest('.sl-item');
    // Drawing a new text box, shape or line by dragging (Google: pick the tool, then drag)
    if (tool.startsWith('line') && !handle && !rotH) { // lines: drag from one end to the other; ends near a shape attach to it
      e.preventDefault(); const kind = tool.split(':')[1] || 'straight', arrow = tool.split(':')[2] === 'arrow';
      const p0 = at(e); const a0 = nearSite(p0, k); const start = a0 ? a0.pt : [p0.x, p0.y];
      const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ghost.setAttribute('class', 'gs-ghostline'); ghost.innerHTML = '<path fill="none" stroke="currentColor" stroke-width="2"/>'; // the accent (see .gs-ghostline) stage.appendChild(ghost);
      let end = start, a1 = null;
      const mv = (ev) => { const p = at(ev); a1 = nearSite(p, k); end = a1 ? a1.pt : [p.x, p.y]; if (ev.shiftKey && !a1) { const dx = end[0] - start[0], dy = end[1] - start[1]; const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); const len = Math.hypot(dx, dy); end = [start[0] + Math.cos(ang) * len, start[1] + Math.sin(ang) * len]; } ghost.querySelector('path').setAttribute('d', `M${start[0]} ${start[1]} L${end[0]} ${end[1]}`); showSites(stage, p); };
      const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); ghost.remove(); showSites(stage, null);
        if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 6) end = [start[0] + 160, start[1]];
        tool = 'select'; root.classList.remove('gs-drawing');
        addItem({ t: 'line', kind, x1: Math.round(start[0]), y1: Math.round(start[1]), x2: Math.round(end[0]), y2: Math.round(end[1]), stroke: '#1f1f1f', sw: 2, ...(arrow || kind !== 'straight' ? { a2: 'arrow' } : {}), ...(a0 ? { from: a0.att } : {}), ...(a1 ? { to: a1.att } : {}) }); drawToolbar(); };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); return;
    }
    const endH = e.target.closest('[data-end]');
    if (endH) { // drag one end of a line (attaches to a shape's connection point when close)
      e.preventDefault(); const ln = item(); const n = endH.dataset.end; const stageEl = stage;
      const mv = (ev) => { const p = at(ev); const a = nearSite(p, k, ln.id); const pt = a ? a.pt : [p.x, p.y]; endH.style.left = `${pt[0]}px`; endH.style.top = `${pt[1]}px`; endH._a = a; endH._pt = pt; const el2 = stageEl.querySelector(`.sl-item[data-id="${ln.id}"] path:last-child`); if (el2) { const t2 = { ...ln, [`x${n}`]: pt[0], [`y${n}`]: pt[1] }; const box = el2.closest('.sl-item'); el2.setAttribute('d', `M${t2.x1 - parseFloat(box.style.left)} ${t2.y1 - parseFloat(box.style.top)} L${t2.x2 - parseFloat(box.style.left)} ${t2.y2 - parseFloat(box.style.top)}`); } showSites(stageEl, p); };
      const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); showSites(stageEl, null); if (!endH._pt) return;
        const pt = endH._pt, a = endH._a; edit((d, sl) => { const x = sl.items.find((y) => y.id === ln.id); x[`x${n}`] = Math.round(pt[0]); x[`y${n}`] = Math.round(pt[1]); if (a) x[n === '1' ? 'from' : 'to'] = a.att; else delete x[n === '1' ? 'from' : 'to']; }); };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); return;
    }
    const cropH = e.target.closest('[data-crop]');
    if (cropH) { cropDrag(e, cropH.dataset.crop, k); return; }
    if (cropId && !e.target.closest(`.sl-item[data-id="${cropId}"]`)) { cropId = null; drawCanvas(); }
    const cell = e.target.closest('td[data-cell]');
    if (cell && el && multi.has(el.dataset.id) && item(el.dataset.id)?.t === 'table' && !e.target.closest('.sl-cell.editing')) { // select table cells (Shift extends)
      const [r, c] = cell.dataset.cell.split(',').map(Number); const id = el.dataset.id;
      cellSel = e.shiftKey && cellSel?.id === id ? { id, r1: Math.min(cellSel.r1, r), c1: Math.min(cellSel.c1, c), r2: Math.max(cellSel.r1, r), c2: Math.max(cellSel.c1, c) } : { id, r1: r, c1: c, r2: r, c2: c };
      const tap2 = Date.now() - (lastCellTap.t || 0) < 450 && lastCellTap.key === `${id}:${r}:${c}`; lastCellTap = { t: Date.now(), key: `${id}:${r}:${c}` };
      if ((e.detail >= 2 || tap2) && !e.shiftKey) { e.preventDefault(); drawCanvas(); editCell(id, r, c); return; } // double-click a cell: type in it (the redraw replaces the cell, so don't wait for dblclick)
      drawCanvas(); drawToolbar(); return;
    }
    if (tool !== 'select' && !handle && !rotH) {
      e.preventDefault(); const p0 = at(e); const band = document.createElement('div'); band.className = 'deck-band'; stage.appendChild(band);
      let r = null;
      const mv = (ev) => { const p = at(ev); r = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) }; if (ev.shiftKey && tool !== 'line') r.w = r.h = Math.max(r.w, r.h); Object.assign(band.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); };
      const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); band.remove(); createWithTool(r && r.w + r.h > 8 ? r : { x: p0.x, y: p0.y, w: 0, h: 0 }); };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); return;
    }
    if (!handle && !rotH && !el) { // a selection band on empty space
      e.preventDefault(); if (editingId) stopText?.(); enteredGroup = null;
      const p0 = at(e); const band = document.createElement('div'); band.className = 'deck-band'; stage.appendChild(band);
      const keep = e.shiftKey ? new Set(multi) : new Set(); let r = null;
      const mv = (ev) => { const p = at(ev); r = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) }; Object.assign(band.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); };
      const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); band.remove();
        const hits = r && r.w + r.h > 4 ? slide().items.filter((it) => it.x < r.x + r.w && it.x + it.w > r.x && it.y < r.y + r.h && it.y + it.h > r.y).flatMap((it) => groupOf(it).map((x) => x.id)) : [];
        multi = new Set([...keep, ...hits]); sel = [...multi][0] || null; editingId = null; drawCanvas(); drawToolbar(); drawPanel(); };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); return;
    }
    if (el && !handle && !rotH) {
      const id = el.dataset.id; const it = item(id);
      if (painter && it) { applyPainter(it); return; }
      if (e.shiftKey || e.metaKey || e.ctrlKey) { e.preventDefault(); const ids = groupOf(it).map((x) => x.id); const on = multi.has(id); ids.forEach((x) => (on ? multi.delete(x) : multi.add(x))); sel = multi.has(id) ? id : [...multi][0] || null; drawCanvas(); drawToolbar(); drawPanel(); return; }
      if (!multi.has(id)) { if (enteredGroup && it.g !== enteredGroup) enteredGroup = null; setSel(id); editingId = null; if (cellSel?.id !== id) cellSel = null; if (cropId !== id) cropId = null; drawCanvas(); drawToolbar(); drawPanel(); }
      else sel = id;
    }
    const list = selected(); if (!list.length || list.some((x) => x.lock)) return;
    if (cellSel && list[0]?.t === 'table' && e.target.closest('td[data-cell]')) return; // inside a table: cells, not moving
    e.preventDefault();
    const p0 = { x: e.clientX, y: e.clientY };
    const orig = new Map(list.map((it) => [it.id, { ...it }])); const b0 = boundsOf(list);
    const others = slide().items.filter((it) => !multi.has(it.id));
    let moved = false, last = null, dup = e.altKey && !handle && !rotH; // Alt-drag duplicates (Google Slides)
    const tip = document.createElement('div'); tip.className = 'gs-tip'; tip.hidden = true; root.appendChild(tip);
    const show = (ev, text) => { tip.hidden = false; tip.textContent = text; tip.style.left = `${ev.clientX + 14}px`; tip.style.top = `${ev.clientY + 14}px`; };
    const paint = (map) => { for (const [id, r] of Object.entries(map)) for (const n of stage.querySelectorAll(`.sl-item[data-id="${id}"]`)) { Object.assign(n.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); if (r.rot !== undefined) n.style.transform = `rotate(${r.rot}deg)${r.fh || r.fv ? ` scale(${r.fh ? -1 : 1},${r.fv ? -1 : 1})` : ''}`; }
      const sb = stage.querySelector('.gs-sel'); if (sb) { const bb = list.length === 1 ? map[list[0].id] : boundsOf(Object.values(map)); Object.assign(sb.style, { left: `${bb.x}px`, top: `${bb.y}px`, width: `${bb.w}px`, height: `${bb.h}px` }); if (list.length === 1 && bb.rot !== undefined) sb.style.transform = `rotate(${bb.rot}deg)`; }
      stage.querySelectorAll('.gs-outline').forEach((n) => n.remove()); };
    const mv = (ev) => {
      let dx = (ev.clientX - p0.x) / k, dy = (ev.clientY - p0.y) / k;
      if (Math.abs(dx) + Math.abs(dy) > 1) moved = true; if (!moved) return;
      const free = ev.metaKey || ev.ctrlKey; let guides = null;
      if (rotH) { // rotation around the centre; Shift snaps to 15°
        const o = list[0]; const cx = o.x + o.w / 2, cy = o.y + o.h / 2; const p = at(ev);
        let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90; if (ev.shiftKey) deg = Math.round(deg / 15) * 15; deg = ((Math.round(deg) % 360) + 360) % 360;
        last = { [o.id]: { x: o.x, y: o.y, w: o.w, h: o.h, rot: deg, fh: o.fh, fv: o.fv } }; paint(last); show(ev, `${deg}°`); return;
      }
      if (handle) {
        const c = handle.dataset.h; last = {};
        if (list.length === 1) {
          const o = list[0]; const th = ((o.rot || 0) * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
          const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos; // the mouse movement in the object's own (rotated) frame
          const ex = c.includes('e') ? 1 : c.includes('w') ? -1 : 0, ey = c.includes('s') ? 1 : c.includes('n') ? -1 : 0;
          let w = o.w + ex * lx * (ev.altKey ? 2 : 1), h = o.h + ey * ly * (ev.altKey ? 2 : 1);
          if (ev.shiftKey && ex && ey) { const s2 = Math.max(w / o.w, h / o.h); w = o.w * s2; h = o.h * s2; }
          else if (ev.shiftKey && (ex || ey)) { const s2 = ex ? w / o.w : h / o.h; w = o.w * s2; h = o.h * s2; }
          w = Math.max(10, w); h = Math.max(10, h);
          let x, y;
          if (ev.altKey) { x = o.x + (o.w - w) / 2; y = o.y + (o.h - h) / 2; }
          else { const dcx = (ex * (w - o.w)) / 2, dcy = (ey * (h - o.h)) / 2; const cx = o.x + o.w / 2 + dcx * cos - dcy * sin, cy = o.y + o.h / 2 + dcx * sin + dcy * cos; x = cx - w / 2; y = cy - h / 2; }
          if (!o.rot && !free && !ev.altKey && snapGuides) { guides = snap({ x, y, w, h }, others, SNAP / k, { edgesX: ex > 0 ? ['r'] : ex < 0 ? ['l'] : [], edgesY: ey > 0 ? ['b'] : ey < 0 ? ['t'] : [] }); if (ex > 0) w += guides.dx; if (ex < 0) { x += guides.dx; w -= guides.dx; } if (ey > 0) h += guides.dy; if (ey < 0) { y += guides.dy; h -= guides.dy; } drawGuides(stage, guides, { x, y, w, h }); }
          last[o.id] = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), rot: o.rot || 0, fh: o.fh, fv: o.fv };
          show(ev, `${(w / PX_IN).toFixed(2)} × ${(h / PX_IN).toFixed(2)} in`);
        } else { // several objects: scale them all within their bounds
          const ex = c.includes('e') ? 1 : c.includes('w') ? -1 : 0, ey = c.includes('s') ? 1 : c.includes('n') ? -1 : 0;
          let w = Math.max(20, b0.w + ex * dx), h = Math.max(20, b0.h + ey * dy); if (ev.shiftKey && ex && ey) { const s2 = Math.max(w / b0.w, h / b0.h); w = b0.w * s2; h = b0.h * s2; }
          const nx = ex < 0 ? b0.x + b0.w - w : b0.x, ny = ey < 0 ? b0.y + b0.h - h : b0.y; const sx = w / b0.w, sy = h / b0.h;
          for (const [id, o] of orig) last[id] = { x: Math.round(nx + (o.x - b0.x) * sx), y: Math.round(ny + (o.y - b0.y) * sy), w: Math.round(o.w * sx), h: Math.round(o.h * sy) };
        }
        paint(last); return;
      }
      let box = { ...b0, x: b0.x + dx, y: b0.y + dy };
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; box = { ...b0, x: b0.x + dx, y: b0.y + dy }; } // Shift: straight lines
      if (!free && snapGuides) { guides = snap(box, others, SNAP / k); dx += guides.dx; dy += guides.dy; }
      if (!free && snapGrid && !(guides && (guides.dx || guides.dy))) { dx = gridSnap(b0.x + dx) - b0.x; dy = gridSnap(b0.y + dy) - b0.y; }
      box = { ...b0, x: b0.x + dx, y: b0.y + dy };
      last = {}; for (const [id, o] of orig) last[id] = { x: Math.round(o.x + dx), y: Math.round(o.y + dy), w: o.w, h: o.h };
      drawGuides(stage, guides, box); paint(last);
    };
    const up = () => {
      document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); tip.remove(); drawGuides(stage, null);
      if (!moved || !last) return;
      if (dup) { // Alt-drag: the originals stay; copies land where you dropped
        const gmap = {}; const copies = list.map((o) => ({ ...structuredClone(o), ...last[o.id], id: S.newId(), z: topZ() + o.z, ...(o.g ? { g: (gmap[o.g] ||= S.newId()) } : {}) }));
        edit((d, s) => s.items.push(...copies)); multi = new Set(copies.map((x) => x.id)); sel = copies[0].id; draw(); return;
      }
      edit((d, s) => { for (const it of s.items) if (last[it.id]) {
        const o = orig.get(it.id); const nb = last[it.id];
        if (it.t === 'line') { const dx = nb.x - o.x, dy = nb.y - o.y; const sx = o.w ? nb.w / o.w : 1, sy = o.h ? nb.h / o.h : 1; for (const n of [1, 2]) { it[`x${n}`] = Math.round(nb.x + (o[`x${n}`] - o.x) * sx); it[`y${n}`] = Math.round(nb.y + (o[`y${n}`] - o.y) * sy); } if (dx || dy || sx !== 1 || sy !== 1) { delete it.from; delete it.to; } continue; }
        if (it.t === 'table' && (nb.w !== o.w || nb.h !== o.h)) { it.colW = it.colW.map((v) => Math.max(10, Math.round((v * nb.w) / o.w))); it.rowH = it.rowH.map((v) => Math.max(10, Math.round((v * nb.h) / o.h))); }
        Object.assign(it, nb);
      } });
    };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  });
  /* connection points: the middle of each side of shapes, images and text boxes */
  function nearSite(p, k, skipId = null) {
    let best = null;
    for (const it of slide().items) { if (it.id === skipId || it.t === 'line') continue; for (const site of ['n', 'e', 's', 'w']) { const pt = S.sitePoint(it, site); const d = Math.hypot(pt[0] - p.x, pt[1] - p.y); if (d < 14 / k && (!best || d < best.d)) best = { d, pt, att: { id: it.id, site } }; } }
    return best;
  }
  function showSites(stage, p) {
    stage.querySelectorAll('.gs-site').forEach((n) => n.remove()); if (!p) return;
    for (const it of slide().items) { if (it.t === 'line') continue; if (p.x < it.x - 30 || p.x > it.x + it.w + 30 || p.y < it.y - 30 || p.y > it.y + it.h + 30) continue; for (const site of ['n', 'e', 's', 'w']) { const pt = S.sitePoint(it, site); stage.insertAdjacentHTML('beforeend', `<span class="gs-site" style="left:${pt[0]}px;top:${pt[1]}px"></span>`); } }
  }
  /* cropping (double-click an image): the whole picture shows faintly; drag the black handles */
  function drawCrop(stage, it) {
    const c = it.crop || { l: 0, t: 0, r: 0, b: 0 }; const fw = it.w / (1 - c.l - c.r), fh = it.h / (1 - c.t - c.b); const fx = it.x - c.l * fw, fy = it.y - c.t * fh;
    stage.insertAdjacentHTML('beforeend', `<div class="gs-crop-full" style="left:${fx}px;top:${fy}px;width:${fw}px;height:${fh}px"><img src="${esc(it.src)}" alt=""></div><div class="gs-crop" style="left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px">${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h2) => `<span class="gs-crop-h c-${h2}" data-crop="${h2}"></span>`).join('')}</div>`);
  }
  function cropDrag(e, h2, k) {
    e.preventDefault(); const it = item(cropId); const c0 = { l: 0, t: 0, r: 0, b: 0, ...(it.crop || {}) }; const fw = it.w / (1 - c0.l - c0.r), fh = it.h / (1 - c0.t - c0.b); const p0 = { x: e.clientX, y: e.clientY };
    let c = { ...c0 };
    const mv = (ev) => {
      const dx = (ev.clientX - p0.x) / k / fw, dy = (ev.clientY - p0.y) / k / fh; c = { ...c0 };
      if (h2.includes('w')) c.l = Math.max(0, Math.min(0.9 - c.r, c0.l + dx)); if (h2.includes('e')) c.r = Math.max(0, Math.min(0.9 - c.l, c0.r - dx));
      if (h2.includes('n')) c.t = Math.max(0, Math.min(0.9 - c.b, c0.t + dy)); if (h2.includes('s')) c.b = Math.max(0, Math.min(0.9 - c.t, c0.b - dy));
      const box = canvas.querySelector('.gs-crop'); const fx = it.x - c0.l * fw, fy = it.y - c0.t * fh;
      Object.assign(box.style, { left: `${fx + c.l * fw}px`, top: `${fy + c.t * fh}px`, width: `${fw * (1 - c.l - c.r)}px`, height: `${fh * (1 - c.t - c.b)}px` });
    };
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); const fx = it.x - c0.l * fw, fy = it.y - c0.t * fh;
      edit((d, sl) => { const x = sl.items.find((y) => y.id === it.id); x.crop = c; x.x = Math.round(fx + c.l * fw); x.y = Math.round(fy + c.t * fh); x.w = Math.round(fw * (1 - c.l - c.r)); x.h = Math.round(fh * (1 - c.t - c.b)); }); };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }
  // clicking the grey area around the slide deselects (Google Slides)
  stageWrap.addEventListener('pointerdown', (e) => {
    if (!editable || !(e.target === stageWrap || e.target.closest?.('.gs-ruler-h, .gs-ruler-v'))) return; // only the grey area itself (a click on the slide may have redrawn its target)
    if (editingId) stopText?.();
    if (multi.size || enteredGroup) { enteredGroup = null; setSel(null); drawCanvas(); drawToolbar(); drawPanel(); }
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.sl-item'); if (!el || !editable) return;
    const it = item(el.dataset.id);
    if (it?.g && enteredGroup !== it.g && multi.size > 1) { enteredGroup = it.g; setSel(it.id); drawCanvas(); drawToolbar(); return; } // double-click enters a group
    if (it?.role === 'imageSlot') { setSel(it.id); pickImage(it.id); return; }
    if (it?.t === 'image') { setSel(it.id); cropId = it.id; drawCanvas(); drawToolbar(); return; } // Google: double-click crops
    if (it?.t === 'table') { const td = e.target.closest('td[data-cell]'); if (td) { setSel(it.id); const [r, c] = td.dataset.cell.split(',').map(Number); editCell(it.id, r, c); } return; }
    if (it?.t === 'wordart') { setSel(it.id); wordArtText(it); return; }
    if (it?.t === 'line' || it?.t === 'video') { setSel(it.id); drawCanvas(); return; }
    setSel(el.dataset.id); startText(el.dataset.id); drawToolbar();
  });
  canvas.addEventListener('contextmenu', (e) => {
    if (!editable) return; const el = e.target.closest('.sl-item');
    e.preventDefault();
    if (el && !multi.has(el.dataset.id)) { setSel(el.dataset.id); drawCanvas(); drawToolbar(); }
    const pseudo = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) };
    const linked = editable && selected().length === 1 && selected()[0].t === 'file' ? selected()[0] : null;
    openMenu(pseudo, (fileMode ? (l) => [...(linked ? [{ label: 'Make a copy here', icon: 'copy', run: () => copyLinkedItem(linked) }, 'divider'] : []), ...l, 'divider', { label: 'Comment', icon: 'commentPlus', run: () => commentHere() }] : (l) => l)(multi.size ? [
      { label: 'Cut', run: () => cmd('cut') }, { label: 'Copy', run: () => cmd('copy') }, { label: 'Paste', run: () => cmd('paste') }, { label: 'Delete', run: () => cmd('delete') }, 'divider',
      { label: 'Order', run: () => {} , disabled: true }, { label: '   Bring to front', run: () => cmd('front') }, { label: '   Bring forward', run: () => cmd('forward') }, { label: '   Send backward', run: () => cmd('backward') }, { label: '   Send to back', run: () => cmd('back') }, 'divider',
      ...(multi.size > 1 && !isGrouped() ? [{ label: 'Group', run: () => cmd('group') }] : []), ...(isGrouped() ? [{ label: 'Ungroup', run: () => cmd('ungroup') }] : []),
      { label: 'Rotate clockwise 90°', run: () => cmd('rot-cw') }, { label: 'Flip horizontally', run: () => cmd('flip-h') }, { label: 'Flip vertically', run: () => cmd('flip-v') }, 'divider',
      { label: 'Format options', run: () => togglePanel('format', true) },
    ] : [{ label: 'Paste', run: () => cmd('paste') }, { label: 'New slide', run: () => cmd('new-slide') }, { label: 'Change theme', run: () => togglePanel('themes', true) }]), { align: 'start' });
  });
  function createWithTool(r) {
    const t = tool; tool = 'select'; root.classList.remove('gs-drawing');
    const def = { w: t === 'text' ? 300 : t === 'line' ? 200 : 160, h: t === 'text' ? 60 : t === 'line' ? 20 : 120 };
    const box = r.w + r.h > 8 ? r : { x: r.x - def.w / 2, y: r.y - def.h / 2, ...def };
    const rr = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(Math.max(20, box.w)), h: Math.round(Math.max(t === 'line' ? 10 : 20, box.h)) };
    if (t === 'text') { addItem({ t: 'text', ...rr, fs: 18, al: 'left', va: 'top', html: '', af: r.w + r.h > 8 ? undefined : 'resize' }); startText(sel); }
    else if (t === 'line') addItem({ t: 'shape', shape: 'line', ...rr, fill: '', stroke: '#1f1f1f', sw: 2 });
    else if (t.startsWith('shape:')) addItem({ t: 'shape', shape: t.slice(6), ...rr, fill: '#cfe2ff', stroke: '#0b57d0', sw: 2 });
    drawToolbar();
  }
  const setTool = (t) => { tool = t; root.classList.toggle('gs-drawing', t !== 'select'); drawToolbar(); };
  const isGrouped = () => { const l = selected(); return l.length > 1 && l.every((x) => x.g && x.g === l[0].g); };
  const PAINT_KEYS = ['fill', 'stroke', 'sw', 'fs', 'color', 'al', 'va', 'ff', 'lh', 'ps', 'pad', 'af'];
  function applyPainter(target) { const src = painter; if (!painter.sticky) painter = null; edit((d, s) => { const x = s.items.find((y) => y.id === target.id); if (!x) return; for (const k2 of PAINT_KEYS) { if (src.style[k2] !== undefined) x[k2] = src.style[k2]; else delete x[k2]; } }); root.classList.toggle('gs-painting', !!painter); drawToolbar(); }

  /* =================== Commands (menus, toolbar, keyboard) =================== */
  const slidesPicked = () => [...selSlides].sort((a, b) => a - b);
  async function cmd(c, arg) {
    const it = item();
    switch (c) {
      case 'undo': step(undo, redo, 'before'); break;
      case 'redo': step(redo, undo, 'after'); break;
      case 'new-slide': { if (target) { toast('Close the theme builder to add slides'); break; } const s = S.newSlide(arg || 'titleBody', deck.ratio, deck); edit((d) => d.slides.splice(cur + 1, 0, s)); cur += 1; selSlides = new Set([cur]); setSel(null); draw(); break; }
      case 'dup-slide': { const idx = slidesPicked(); const copies = idx.map((i) => { const s = structuredClone(deck.slides[i]); s.id = S.newId(); s.items = s.items.map((x) => ({ ...x, id: S.newId() })); return s; }); const at = idx[idx.length - 1] + 1; edit((d) => d.slides.splice(at, 0, ...copies)); cur = at; selSlides = new Set(copies.map((_, j) => at + j)); draw(); break; }
      case 'del-slide': { const idx = slidesPicked(); if (idx.length >= deck.slides.length) { toast('A presentation needs at least one slide'); break; } const ids = new Set(idx.map((i) => deck.slides[i].id)); edit((d) => { d.slides = d.slides.filter((s) => !ids.has(s.id)); }); cur = Math.min(idx[0], deck.slides.length - 1); selSlides = new Set([cur]); setSel(null); draw(); break; }
      case 'move-slide': { const idx = slidesPicked(); const n = deck.slides.length; const to = { start: 0, up: Math.max(0, idx[0] - 1), down: Math.min(n - idx.length, idx[0] + 1), end: n - idx.length }[arg]; moveSlides(idx, to); break; }
      case 'cut': case 'copy': if (multi.size) { clipboard = { kind: 'items', items: structuredClone(selected()) }; if (c === 'cut') cmd('delete'); else toast('Copied'); } break;
      case 'paste': if (clipboard?.kind === 'items') { const gmap = {}; const copies = clipboard.items.map((x) => ({ ...structuredClone(x), id: S.newId(), x: x.x + 20, y: x.y + 20, z: topZ() + x.z, ...(x.g ? { g: (gmap[x.g] ||= S.newId()) } : {}) })); clipboard.items = copies.map((x) => structuredClone(x)); edit((d, s) => s.items.push(...copies)); multi = new Set(copies.map((x) => x.id)); sel = copies[0]?.id; draw(); } else if (clipboard?.kind === 'slides') { const copies = clipboard.slides.map((s) => ({ ...structuredClone(s), id: S.newId(), items: s.items.map((x) => ({ ...x, id: S.newId() })) })); edit((d) => d.slides.splice(cur + 1, 0, ...copies)); cur += 1; selSlides = new Set(copies.map((_, j) => cur + j)); draw(); } break;
      case 'duplicate': if (multi.size) { clipboard = { kind: 'items', items: structuredClone(selected()) }; const keep = clipboard; cmd('paste'); clipboard = keep; } break;
      case 'delete': if (multi.size) { const ids = new Set(multi); setSel(null); edit((d, s) => { s.items = s.items.filter((x) => !ids.has(x.id)); if (s.anims) { s.anims = s.anims.filter((a) => !ids.has(a.item)); if (!s.anims.length) delete s.anims; } }); } break; // their animations go too
      case 'select-all': multi = new Set(slide().items.map((x) => x.id)); sel = [...multi][0] || null; drawCanvas(); drawToolbar(); break;
      case 'front': case 'back': case 'forward': case 'backward': order(c); break;
      case 'group': if (multi.size > 1) { const g = S.newId(); editSel((x) => { x.g = g; }); } break;
      case 'ungroup': editSel((x) => { delete x.g; }); enteredGroup = null; break;
      case 'rot-cw': case 'rot-ccw': editSel((x) => { x.rot = (((x.rot || 0) + (c === 'rot-cw' ? 90 : -90)) % 360 + 360) % 360; }); break;
      case 'flip-h': editSel((x) => { x.fh = x.fh ? 0 : 1; }); break;
      case 'flip-v': editSel((x) => { x.fv = x.fv ? 0 : 1; }); break;
      case 'align': arrange(arg); break;
      case 'text-box': setTool('text'); break;
      case 'line': setTool('line'); break;
      case 'shape': setTool(`shape:${arg}`); break;
      case 'image': pickImage(null); break;
      case 'chart': { const spec = await openChartDialog(); if (spec) addItem({ t: 'chart', x: 240, y: Math.round(H() / 2 - 150), w: 480, h: 300, spec }); break; }
      case 'link': if (it || editingId) linkDialog(); else toast('Select some text first'); break;
      case 'painter': if (!it) { toast('Select an object to copy its formatting'); break; } painter = { style: Object.fromEntries(PAINT_KEYS.map((k2) => [k2, it[k2]])), sticky: arg === 'sticky' }; root.classList.add('gs-painting'); toast('Click an object to paste the formatting'); break;
      case 'zoom': zoom = arg; drawCanvas(); drawToolbar(); break;
      case 'zoom-in': zoom = Math.min(4, (zoom === 'fit' ? scale() : zoom) + 0.25); drawCanvas(); drawToolbar(); break;
      case 'zoom-out': zoom = Math.max(0.25, (zoom === 'fit' ? scale() : zoom) - 0.25); drawCanvas(); drawToolbar(); break;
      case 'ruler': showRuler = !showRuler; drawCanvas(); break;
      case 'notes': showNotes = !showNotes; draw(); break;
      case 'snap-grid': snapGrid = !snapGrid; break;
      case 'snap-guides': snapGuides = !snapGuides; break;
      case 'show-grid': showGrid = !showGrid; drawCanvas(); break;
      case 'grid-view': gridView = !gridView; root.classList.toggle('gs-gridmode', gridView); gridEl.hidden = !gridView; draw(); (gridView ? gridEl : canvas).focus({ preventScroll: true }); break;
      case 'find': findReplace(); break;
      case 'themes': togglePanel('themes', true); break;
      case 'format-options': togglePanel('format', true); break;
      case 'page-setup': pageSetup(); break;
      case 'present': present(deck, arg === 'start' ? 0 : cur); break;
      case 'presenter': present(deck, cur, { presenter: true }); break;
      case 'pptx': exportPptx(); break;
      case 'pdf': printDeck(deck, { notes: arg === 'notes' }); break;
      case 'import': root.querySelector('.deck-file').click(); break;
      case 'shortcuts': shortcutsDialog(); break;
      case 'remove': if (await confirmDialog({ title: 'Delete this presentation?', message: 'It’s removed from the document. Undo (in the editor) brings it back.', confirmLabel: 'Delete' })) remove?.(); break;
      case 'fit': editSel((x) => { if (arg === 'none') delete x.af; else x.af = arg; }); break;
      case 'line-tool': setTool(`line:${arg || 'straight'}`); break;
      case 'arrow-tool': setTool('line:straight:arrow'); break;
      case 'table': insertTable(); break;
      case 'video': insertVideo(); break;
      case 'wordart': wordArtText(null); break;
      case 'background': backgroundDialog(); break;
      case 'slide-numbers': slideNumbers(); break;
      case 'apply-layout': applyLayoutTo(arg); break;
      case 'theme-builder': themeBuilder(!target); break;
      case 'crop': { const it2 = item(); if (it2?.t === 'image') { cropId = it2.id; drawCanvas(); } break; }
      case 'reset-image': editSel((x) => { for (const k2 of ['crop', 'mask', 'op', 'br', 'ct', 'rc', 'shadow']) delete x[k2]; }); cropId = null; break;
      case 'mask': editSel((x) => { if (x.t !== 'image') return; if (arg === 'rect') delete x.mask; else x.mask = arg; }); break;
      case 'table-op': tableOp(arg); break;
      case 'motion': togglePanel('motion', true); break;
      case 'animate': addAnimation(); break;
      case 'skip': toggleSkip(); break;
      case 'import-slides': importSlides(); break;
      case 'download': downloadSlide(arg); break;
      case 'linked-chart': insertLinkedChart(); break;
      case 'file-from-app': insertFileFromApp(); break;
      case 'chart-update': { const it2 = item(); if (it2?.link) { try { const spec = await specFromSheet(it2.link, it2.spec?.t || 'column', it2.spec?.title || ''); linkedFresh.delete(it2.id); edit((d, sl) => { const x = sl.items.find((y) => y.id === it2.id); x.spec = { ...spec, series: spec.series.map((x2, i2) => ({ ...x2, c: it2.spec?.series?.[i2]?.c || x2.c })) }; }); toast('Chart updated from the spreadsheet'); } catch (err) { toast(err.message, { tone: 'error' }); } } break; }
      case 'chart-unlink': editSel((x) => { delete x.link; }); linkedFresh.delete(item()?.id); toast('Chart unlinked: it no longer follows the spreadsheet'); break;
      case 'chart-source': { const it2 = item(); if (it2?.link) location.hash = `#/files/${it2.link.noteId}`; break; }
      case 'lh': editSel((x) => { x.lh = arg; }); break;
      case 'ps': editSel((x) => { x.ps = arg; }); break;
      case 'va': editSel((x) => { x.va = arg; }); break;
      default: break;
    }
  }
  function order(how) {
    const ids = new Set(multi); if (!ids.size) return;
    edit((d, s) => {
      const sorted = [...s.items].sort((a, b) => a.z - b.z);
      const mine = sorted.filter((x) => ids.has(x.id)), rest = sorted.filter((x) => !ids.has(x.id));
      let out;
      if (how === 'front') out = [...rest, ...mine];
      else if (how === 'back') out = [...mine, ...rest];
      else { out = [...sorted]; const list = how === 'forward' ? [...mine].reverse() : mine; for (const m of list) { const i = out.indexOf(m); const j = how === 'forward' ? i + 1 : i - 1; if (j < 0 || j >= out.length || ids.has(out[j].id)) continue; [out[i], out[j]] = [out[j], out[i]]; } }
      out.forEach((x, i) => { x.z = i + 1; });
    });
  }
  function arrange(how) {
    const list = selected(); if (!list.length) return;
    const ref = list.length > 1 && !how.startsWith('slide') ? boundsOf(list) : { x: 0, y: 0, w: S.W, h: H() };
    edit((d, sl) => {
      const items = sl.items.filter((x) => multi.has(x.id));
      if (how === 'dist-h' || how === 'dist-v') {
        const [p, sz] = how === 'dist-h' ? ['x', 'w'] : ['y', 'h']; const sorted = [...items].sort((m, n) => m[p] - n[p]); if (sorted.length < 3) return;
        const total = sorted.reduce((t, x) => t + x[sz], 0); const span = sorted[sorted.length - 1][p] + sorted[sorted.length - 1][sz] - sorted[0][p]; const gap = (span - total) / (sorted.length - 1);
        let at = sorted[0][p]; sorted.forEach((x) => { x[p] = Math.round(at); at += x[sz] + gap; }); return;
      }
      for (const x of items) {
        if (how === 'left') x.x = ref.x; if (how === 'center' || how === 'slide-h') x.x = Math.round(ref.x + (ref.w - x.w) / 2); if (how === 'right') x.x = ref.x + ref.w - x.w;
        if (how === 'top') x.y = ref.y; if (how === 'middle' || how === 'slide-v') x.y = Math.round(ref.y + (ref.h - x.h) / 2); if (how === 'bottom') x.y = ref.y + ref.h - x.h;
      }
    });
  }
  function moveSlides(idx, to) {
    const ids = idx.map((i) => deck.slides[i].id);
    edit((d) => { const moving = ids.map((id) => d.slides.find((s) => s.id === id)); d.slides = d.slides.filter((s) => !ids.includes(s.id)); d.slides.splice(Math.max(0, Math.min(to, d.slides.length)), 0, ...moving); });
    const first = deck.slides.findIndex((s) => s.id === ids[0]); cur = first; selSlides = new Set(ids.map((id) => deck.slides.findIndex((s) => s.id === id))); draw();
  }
  function pickImage(replaceId) { const inp = root.querySelector('.deck-img'); inp.dataset.replace = replaceId || ''; inp.click(); }

  /* =================== Menus =================== */
  const ck = (on, label) => `${on ? '✓ ' : '    '}${label}`;
  const MENU_ITEMS = {
    File: () => [{ label: 'Import slides from another presentation…', run: () => cmd('import-slides') }, { label: 'Import slides from PowerPoint (.pptx)…', run: () => cmd('import') }, 'divider', { label: 'Download as PowerPoint (.pptx)', run: () => cmd('pptx') }, { label: 'Download as PDF / print', run: () => cmd('pdf') }, { label: 'Print with speaker notes', run: () => cmd('pdf', 'notes') }, { label: 'Download this slide as PNG', run: () => cmd('download', 'png') }, { label: 'Download this slide as JPEG', run: () => cmd('download', 'jpeg') }, { label: 'Download this slide as SVG', run: () => cmd('download', 'svg') }, { label: 'Download text (.txt)', run: () => cmd('download', 'txt') }, 'divider', { label: 'Page setup…', run: () => cmd('page-setup') }, ...(remove ? ['divider', { label: 'Delete presentation', run: () => cmd('remove') }] : [])],
    Edit: () => [{ label: `Undo  ${kbd('Cmd+Z')}`, run: () => cmd('undo') }, { label: `Redo  ${kbd('Cmd+Y')}`, run: () => cmd('redo') }, 'divider', { label: `Cut  ${kbd('Cmd+X')}`, run: () => cmd('cut') }, { label: `Copy  ${kbd('Cmd+C')}`, run: () => cmd('copy') }, { label: `Paste  ${kbd('Cmd+V')}`, run: () => cmd('paste') }, { label: `Duplicate  ${kbd('Cmd+D')}`, run: () => cmd('duplicate') }, { label: 'Delete', run: () => cmd('delete') }, 'divider', { label: `Select all  ${kbd('Cmd+A')}`, run: () => cmd('select-all') }, 'divider', { label: `Find and replace  ${kbd('Cmd+Shift+H')}`, run: () => cmd('find') }],
    View: () => [{ label: `Slideshow  ${kbd('Cmd+F5')}`, run: () => cmd('present') }, { label: 'Presenter view', run: () => cmd('presenter') }, { label: 'Motion', run: () => cmd('motion') }, 'divider', { label: ck(gridView, `Grid view  ${kbd('Cmd+Alt+1')}`), run: () => cmd('grid-view') }, 'divider', { label: 'Zoom: Fit', run: () => cmd('zoom', 'fit') }, { label: 'Zoom: 50%', run: () => cmd('zoom', 0.5) }, { label: 'Zoom: 100%', run: () => cmd('zoom', 1) }, { label: 'Zoom: 200%', run: () => cmd('zoom', 2) }, { label: `Zoom in  ${kbd('Cmd+Alt+=')}`, run: () => cmd('zoom-in') }, { label: `Zoom out  ${kbd('Cmd+Alt+-')}`, run: () => cmd('zoom-out') }, 'divider', { label: ck(snapGrid, 'Snap to grid'), run: () => cmd('snap-grid') }, { label: ck(snapGuides, 'Snap to guides'), run: () => cmd('snap-guides') }, { label: ck(showGrid, 'Show grid'), run: () => cmd('show-grid') }, { label: ck(showRuler, 'Show ruler'), run: () => cmd('ruler') }, { label: ck(showNotes, 'Show speaker notes'), run: () => cmd('notes') }],
    Insert: () => [{ label: 'Image…', run: () => cmd('image') }, { label: 'Text box', run: () => cmd('text-box') }, { label: 'Shape…', run: () => shapePicker(root.querySelector('[data-menu="Insert"]')) }, 'divider', { label: 'Line', run: () => cmd('line-tool', 'straight') }, { label: 'Arrow', run: () => cmd('arrow-tool') }, { label: 'Elbow connector', run: () => cmd('line-tool', 'elbow') }, { label: 'Curved connector', run: () => cmd('line-tool', 'curved') }, 'divider', { label: 'Table…', run: () => cmd('table') }, { label: 'Chart…', run: () => cmd('chart') }, { label: 'Chart from a spreadsheet…', run: () => cmd('linked-chart') }, { label: 'Existing file…', run: () => cmd('file-from-app') }, ...(fileMode ? [{ label: 'Comment  Ctrl+Alt+M', icon: 'commentPlus', run: () => commentHere() }] : []), { label: 'Animation', run: () => cmd('animate') }, { label: 'Video…', run: () => cmd('video') }, { label: 'Word art', run: () => cmd('wordart') }, 'divider', { label: `Link  ${kbd('Cmd+K')}`, run: () => cmd('link') }, { label: 'Slide numbers…', run: () => cmd('slide-numbers') }, 'divider', { label: `New slide  ${kbd('Cmd+M')}`, run: () => cmd('new-slide') }],
    Format: () => [{ label: `Bold  ${kbd('Cmd+B')}`, run: () => formatCmd('bold') }, { label: `Italic  ${kbd('Cmd+I')}`, run: () => formatCmd('italic') }, { label: `Underline  ${kbd('Cmd+U')}`, run: () => formatCmd('underline') }, { label: `Strikethrough  ${kbd('Alt+Shift+5')}`, run: () => formatCmd('strikeThrough') }, { label: `Superscript  ${kbd('Cmd+.')}`, run: () => formatCmd('superscript') }, { label: `Subscript  ${kbd('Cmd+,')}`, run: () => formatCmd('subscript') }, { label: `Increase font size  ${kbd('Cmd+Shift+>')}`, run: () => bumpSize(1) }, { label: `Decrease font size  ${kbd('Cmd+Shift+<')}`, run: () => bumpSize(-1) }, 'divider',
      { label: 'Align left', run: () => setAlign('left') }, { label: 'Align centre', run: () => setAlign('center') }, { label: 'Align right', run: () => setAlign('right') }, { label: 'Justify', run: () => setAlign('justify') }, { label: 'Top', run: () => cmd('va', 'top') }, { label: 'Middle', run: () => cmd('va', 'middle') }, { label: 'Bottom', run: () => cmd('va', 'bottom') }, 'divider',
      { label: 'Line spacing: Single', run: () => cmd('lh', 1) }, { label: 'Line spacing: 1.15', run: () => cmd('lh', 1.15) }, { label: 'Line spacing: 1.5', run: () => cmd('lh', 1.5) }, { label: 'Line spacing: Double', run: () => cmd('lh', 2) }, { label: 'Add space after paragraphs', run: () => cmd('ps', 12) }, { label: 'Remove space after paragraphs', run: () => cmd('ps', 0) }, 'divider',
      { label: `Bulleted list  ${kbd('Cmd+Shift+8')}`, run: () => listStyle(null, false) }, { label: `Numbered list  ${kbd('Cmd+Shift+7')}`, run: () => listStyle(null, true) }, 'divider', { label: `Clear formatting  ${kbd('Cmd+\\')}`, run: () => formatCmd('removeFormat') }, { label: 'Format options', run: () => cmd('format-options') }],
    Slide: () => [{ label: `New slide  ${kbd('Cmd+M')}`, run: () => cmd('new-slide') }, { label: 'Duplicate slide', run: () => cmd('dup-slide') }, { label: 'Delete slide', run: () => cmd('del-slide') }, { label: deck.slides[cur]?.skip ? 'Unskip slide' : 'Skip slide', run: () => cmd('skip') }, { label: 'Transition…', run: () => cmd('motion') }, 'divider', { label: 'Move slide to beginning', run: () => cmd('move-slide', 'start') }, { label: 'Move slide up', run: () => cmd('move-slide', 'up') }, { label: 'Move slide down', run: () => cmd('move-slide', 'down') }, { label: 'Move slide to end', run: () => cmd('move-slide', 'end') }, 'divider', { label: 'Change background…', run: () => cmd('background') }, ...Object.entries(S.LAYOUTS).map(([k2, l]) => ({ label: `   Apply layout: ${l}`, run: () => cmd('apply-layout', k2) })), 'divider', { label: 'Change theme', run: () => cmd('themes') }, { label: target ? 'Close theme builder' : 'Edit theme (theme builder)', run: () => cmd('theme-builder') }],
    Arrange: () => [{ label: `Bring to front  ${kbd('Cmd+Shift+↑')}`, run: () => cmd('front') }, { label: `Bring forward  ${kbd('Cmd+↑')}`, run: () => cmd('forward') }, { label: `Send backward  ${kbd('Cmd+↓')}`, run: () => cmd('backward') }, { label: `Send to back  ${kbd('Cmd+Shift+↓')}`, run: () => cmd('back') }, 'divider',
      ...['left', 'center', 'right', 'top', 'middle', 'bottom'].map((a) => ({ label: `Align ${a === 'center' ? 'centre' : a}${multi.size > 1 ? '' : ' (to slide)'}`, run: () => cmd('align', a) })), 'divider', { label: 'Distribute horizontally', run: () => cmd('align', 'dist-h') }, { label: 'Distribute vertically', run: () => cmd('align', 'dist-v') }, { label: 'Centre on page horizontally', run: () => cmd('align', 'slide-h') }, { label: 'Centre on page vertically', run: () => cmd('align', 'slide-v') }, 'divider',
      { label: 'Rotate clockwise 90°', run: () => cmd('rot-cw') }, { label: 'Rotate counter-clockwise 90°', run: () => cmd('rot-ccw') }, { label: 'Flip horizontally', run: () => cmd('flip-h') }, { label: 'Flip vertically', run: () => cmd('flip-v') }, 'divider', { label: `Group  ${kbd('Cmd+G')}`, run: () => cmd('group') }, { label: `Ungroup  ${kbd('Cmd+Shift+G')}`, run: () => cmd('ungroup') }],
    Tools: () => [{ label: `Find and replace  ${kbd('Cmd+Shift+H')}`, run: () => cmd('find') }, { label: `Keyboard shortcuts  ${kbd('Cmd+/')}`, run: () => cmd('shortcuts') }],
  };
  root.querySelector('.gs-menubar')?.addEventListener('mousedown', (e) => { if (editingId && e.target.closest('button')) e.preventDefault(); });
  root.querySelector('.gs-menubar')?.addEventListener('click', (e) => {
    const m = e.target.closest('[data-menu]'); if (m) { openMenu(m, withIcons(MENU_ITEMS[m.dataset.menu]()), { align: 'start' }); return; }
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'present-menu') openMenu(b, [{ label: 'Present from beginning', run: () => cmd('present', 'start') }, { label: 'Present from current slide', run: () => cmd('present') }, { label: 'Presenter view', run: () => cmd('presenter') }], { align: 'end' });
    else cmd(b.dataset.c);
  });

  function shapePicker(anchor) {
    document.querySelector('.gs-shapes')?.remove();
    const pop = document.createElement('div'); pop.className = 'gs-shapes gs-colors'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Shapes');
    pop.innerHTML = S.SHAPE_GROUPS.map((g) => `<div class="menu-label">${g}</div><div class="gs-shape-grid">${Object.entries(S.SHAPE_LIB).filter(([, v]) => v.group === g && !(g === 'Flowchart' && ['flowChartProcess'].includes(v.prst) && false)).map(([k2, v]) => `<button type="button" data-shape="${k2}" title="${esc(v.label)}" aria-label="${esc(v.label)}"><svg viewBox="0 0 24 18"><path d="${S.shapePath(k2, 24, 18)}" fill="none" stroke="currentColor" stroke-width="1.3"${v.evenodd ? ' fill-rule="evenodd"' : ''}/></svg></button>`).join('')}</div>`).join('');
    document.body.appendChild(pop); const r = anchor.getBoundingClientRect(); pop.style.left = `${Math.min(r.left, innerWidth - 300)}px`; pop.style.top = `${r.bottom + 4}px`;
    const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); }; const outside = (e) => { if (!pop.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-shape]'); if (b) { cmd('shape', b.dataset.shape); close(); } });
    keyboardPopover(pop, anchor, close);
  }

  /* =================== Toolbar (changes with what's selected) =================== */
  const tb = (c, ic, label, extra = '') => `<button type="button" class="tb-btn" data-c="${c}" ${extra} title="${esc(label)}" aria-label="${esc(label)}">${ic}</button>`;
  const I = (n) => icon(n, { size: 16 });
  function drawToolbar() {
    if (!toolbar) return;
    const it = item(); const list = selected();
    const text = editingId || (list.length && list.every((x) => isTextual(x)));
    const shape = list.length && list.every((x) => x.t === 'shape');
    const ff = it?.ff || ''; const fs = it?.fs || 24;
    let html = `<button type="button" class="btn btn-plain btn-sm" data-c="new-slide" title="${kbd('New slide (Cmd+M)')}">${icon('plus', { size: 14 })}</button><button type="button" class="tb-btn gs-caret" data-c="layout-menu" aria-label="New slide with layout" aria-haspopup="menu">▾</button>
      ${tb('undo', I('undo'), kbd('Undo (Cmd+Z)'))}${tb('redo', I('redo'), kbd('Redo (Cmd+Y)'))}${tb('painter', I('paintbrush'), 'Paint format (double-click to keep it on)', painter ? 'aria-pressed="true"' : '')}
      <select class="deck-select gs-zoom" data-c="zoom-select" aria-label="Zoom">${[['fit', 'Fit'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%'], ['2', '200%']].map(([v, l]) => `<option value="${v}" ${String(zoom) === v ? 'selected' : ''}>${l}</option>`).join('')}${zoom !== 'fit' && ![0.5, 0.75, 1, 1.5, 2].includes(zoom) ? `<option selected>${Math.round(zoom * 100)}%</option>` : ''}</select>
      <span class="tb-sep"></span>
      ${tb('tool-select', I('mousePointer'), 'Select', tool === 'select' ? 'aria-pressed="true"' : '')}${tb('text-box', I('textSize'), 'Text box: click or drag on the slide', tool === 'text' ? 'aria-pressed="true"' : '')}${tb('image', I('image'), 'Insert image')}${tb('shape-menu', I('shapes'), 'Shape', `aria-haspopup="menu" ${tool.startsWith('shape:') ? 'aria-pressed="true"' : ''}`)}${tb('line', I('minus'), 'Line: drag on the slide', tool === 'line' ? 'aria-pressed="true"' : '')}
      <span class="tb-sep"></span>`;
    if (text) html += `<select class="deck-select" data-c="font" aria-label="Font">${['', ...S.FONTS].map((f) => `<option value="${esc(f)}" ${f === ff ? 'selected' : ''} style="font-family:'${esc(f || 'Figtree')}'">${f || 'Theme font'}</option>`).join('')}</select>
      ${tb('size-down', '−', kbd('Decrease font size (Cmd+Shift+<)'))}<input class="gs-size" data-c="size" value="${fs}" inputmode="numeric" aria-label="Font size">${tb('size-up', '+', kbd('Increase font size (Cmd+Shift+>)'))}
      <span class="tb-sep"></span>${tb('bold', I('bold'), kbd('Bold (Cmd+B)'))}${tb('italic', I('italic'), kbd('Italic (Cmd+I)'))}${tb('underline', I('underline'), kbd('Underline (Cmd+U)'))}
      <button type="button" class="tb-btn gs-cbtn" data-c="color-pick" title="Text colour" aria-label="Text colour" aria-haspopup="dialog">${I('textColor')}<i style="background:${it?.color || S.themeOf(deck).ink}"></i></button>
      <button type="button" class="tb-btn gs-cbtn" data-c="highlight-pick" title="Highlight colour" aria-label="Highlight colour" aria-haspopup="dialog">${I('highlighter')}<i style="background:#fff475"></i></button>
      ${tb('link', I('link'), kbd('Insert link (Cmd+K)'))}<span class="tb-sep"></span>
      ${tb('align-menu', I(it?.al === 'center' ? 'alignCenter' : it?.al === 'right' ? 'alignRight' : 'alignLeft'), 'Align', 'aria-haspopup="menu"')}${tb('spacing-menu', I('list'), 'Line & paragraph spacing', 'aria-haspopup="menu"')}
      ${tb('bullets-menu', I('list'), kbd('Bulleted list (Cmd+Shift+8)'), 'aria-haspopup="menu"')}${tb('numbers-menu', I('listOrdered'), kbd('Numbered list (Cmd+Shift+7)'), 'aria-haspopup="menu"')}
      ${tb('outdent', I('outdent'), 'Decrease indent (Shift+Tab)')}${tb('indent', I('indent'), 'Increase indent (Tab)')}${tb('clear', I('x'), kbd('Clear formatting (Cmd+\\)'))}<span class="tb-sep"></span>`;
    const cbtn = (c, ic, label, col) => `<button type="button" class="tb-btn gs-cbtn" data-c="${c}" title="${label}" aria-label="${label}" aria-haspopup="dialog">${ic}<i style="background:${col || 'transparent'}"></i></button>`;
    if (shape) html += `${cbtn('fill-pick', I('highlighter'), 'Fill colour', it?.fill)}${cbtn('stroke-pick', I('shapes'), 'Border colour', it?.stroke)}${tb('weight-menu', '≡', 'Border weight', 'aria-haspopup="menu"')}${tb('dash-menu', '┄', 'Border dash', 'aria-haspopup="menu"')}<span class="tb-sep"></span>`;
    if (list.length && list.every((x) => x.t === 'line')) html += `${cbtn('line-color', I('minus'), 'Line colour', it?.stroke)}${tb('weight-menu', '≡', 'Line weight', 'aria-haspopup="menu"')}${tb('dash-menu', '┄', 'Line dash', 'aria-haspopup="menu"')}${tb('start-menu', '⟵', 'Line start', 'aria-haspopup="menu"')}${tb('end-menu', '⟶', 'Line end', 'aria-haspopup="menu"')}${tb('kind-menu', '⌐', 'Line type', 'aria-haspopup="menu"')}<span class="tb-sep"></span>`;
    if (list.length && list.every((x) => x.t === 'image')) html += `<button type="button" class="btn btn-plain btn-sm" data-c="crop">Crop</button>${tb('mask-menu', '◔', 'Mask image', 'aria-haspopup="menu"')}<button type="button" class="btn btn-plain btn-sm" data-c="reset-image">Reset image</button><button type="button" class="btn btn-plain btn-sm" data-c="replace-image">Replace image</button><span class="tb-sep"></span>`;
    if (it?.t === 'table') html += `${cbtn('cell-fill', I('highlighter'), 'Cell fill colour', null)}${cbtn('table-border', I('shapes'), 'Border colour', it.bc)}${tb('tblweight-menu', '≡', 'Border weight', 'aria-haspopup="menu"')}<button type="button" class="btn btn-plain btn-sm" data-c="table-menu" aria-haspopup="menu">Table ▾</button><span class="tb-sep"></span>`;
    if (it?.t === 'wordart') html += `${cbtn('wa-fill', I('textColor'), 'Fill colour', it.fill)}${cbtn('wa-stroke', I('shapes'), 'Outline colour', it.stroke)}${tb('waweight-menu', '≡', 'Outline weight', 'aria-haspopup="menu"')}<select class="deck-select" data-c="wa-font" aria-label="Font">${['', ...S.FONTS].map((f2) => `<option value="${esc(f2)}" ${f2 === (it.ff || '') ? 'selected' : ''}>${f2 || 'Theme font'}</option>`).join('')}</select>${tb('wa-bold', I('bold'), 'Bold', it.b ? 'aria-pressed="true"' : '')}${tb('wa-italic', I('italic'), 'Italic', it.i ? 'aria-pressed="true"' : '')}<button type="button" class="btn btn-plain btn-sm" data-c="wa-edit">Edit text</button><span class="tb-sep"></span>`;
    if (it?.t === 'chart' && it.link) html += `<button type="button" class="btn btn-plain btn-sm" data-c="chart-update">Update</button><button type="button" class="btn btn-plain btn-sm" data-c="chart-unlink">Unlink</button><button type="button" class="btn btn-plain btn-sm" data-c="chart-source">Open source</button><span class="tb-sep"></span>`;
    if (list.length && !target) html += `<button type="button" class="btn btn-plain btn-sm" data-c="animate">Animate</button>`;
    if (list.length) html += `${list.length > 1 ? tb('arrange-menu', I('alignCenter'), 'Align and distribute', 'aria-haspopup="menu"') : ''}<button type="button" class="btn btn-plain btn-sm" data-c="format-options">Format options</button>`;
    else if (!target) html += `<button type="button" class="btn btn-plain btn-sm" data-c="background">Background</button><button type="button" class="btn btn-plain btn-sm" data-c="apply-layout-menu">Layout</button><button type="button" class="btn btn-plain btn-sm" data-c="themes">Theme</button><button type="button" class="btn btn-plain btn-sm" data-c="motion">Transition</button>`;
    if (target) html += `<span class="tb-sep"></span><span class="gs-building-label">Theme builder</span><button type="button" class="btn btn-primary btn-sm" data-c="theme-builder">Close theme builder</button>`; // always visible while building
    toolbar.innerHTML = html;
    announceState();
  }
  let lastSaid = '';
  function announceState() { // for screen readers: the slide, the selected object(s) and an armed tool
    const list = selected(); const inch = (v) => (v / PX_IN).toFixed(2);
    const what = list.length > 1 ? `${list.length} objects selected` : list.length ? `${itemLabel(list[0])}, selected, ${inch(list[0].w)} by ${inch(list[0].h)} inches${list[0].rot ? `, rotated ${list[0].rot} degrees` : ''}` : 'Nothing selected';
    const tl = tool !== 'select' ? `. ${tool.startsWith('line') ? 'Line' : tool === 'text' ? 'Text box' : 'Shape'} tool: press Enter to place it in the middle of the slide, or drag on the slide` : '';
    const msg = `${target ? `Theme builder, ${target === 'master' ? 'master' : S.LAYOUTS[target]}` : `Slide ${cur + 1} of ${deck.slides.length}`}. ${what}${tl}`;
    if (msg !== lastSaid) { lastSaid = msg; announce(msg); }
  }
  toolbar?.addEventListener('mousedown', (e) => { if (editingId && e.target.closest('button, label')) e.preventDefault(); }); // keep the text selection
  toolbar?.addEventListener('dblclick', (e) => { if (e.target.closest('[data-c="painter"]')) { const it = item(); if (it) { painter = { style: Object.fromEntries(PAINT_KEYS.map((k2) => [k2, it[k2]])), sticky: true }; root.classList.add('gs-painting'); drawToolbar(); } } });
  toolbar?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const c = b.dataset.c;
    const menus = {
      'layout-menu': () => Object.entries(S.LAYOUTS).map(([k2, l]) => ({ label: l, run: () => cmd('new-slide', k2) })),
      'align-menu': () => [['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['justify', 'Justified']].map(([v, l]) => ({ label: l, run: () => setAlign(v) })).concat(['divider', ...[['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']].map(([v, l]) => ({ label: l, run: () => cmd('va', v) }))]),
      'spacing-menu': () => [[1, 'Single'], [1.15, '1.15'], [1.5, '1.5'], [2, 'Double']].map(([v, l]) => ({ label: `${(item()?.lh || 1.25) === v ? '✓ ' : '    '}${l}`, run: () => cmd('lh', v) })).concat(['divider', { label: 'Add space after paragraph', run: () => cmd('ps', 12) }, { label: 'Remove space after paragraph', run: () => cmd('ps', 0) }]),
      'bullets-menu': () => [['disc', '● Filled circle'], ['circle', '○ Hollow circle'], ['square', '■ Square']].map(([v, l]) => ({ label: l, run: () => listStyle(v, false) })),
      'numbers-menu': () => [['decimal', '1. 2. 3.'], ['upper-alpha', 'A. B. C.'], ['lower-alpha', 'a. b. c.'], ['upper-roman', 'I. II. III.'], ['lower-roman', 'i. ii. iii.']].map(([v, l]) => ({ label: l, run: () => listStyle(v, true) })),
      'weight-menu': () => [1, 2, 3, 4, 8, 12].map((w) => ({ label: `${w} px`, run: () => editSel((x) => { x.sw = w; }) })).concat([{ label: 'No border', run: () => editSel((x) => { x.sw = 0; }) }]),
      'arrange-menu': () => MENU_ITEMS.Arrange().slice(5, 16),
      'dash-menu': () => [['solid', 'Solid ────'], ['dash', 'Dash ─ ─ ─'], ['dot', 'Dot · · · ·'], ['dashDot', 'Dash-dot ─ · ─'], ['longDash', 'Long dash ── ──']].map(([v, l]) => ({ label: l, run: () => editSel((x) => { if (v === 'solid') delete x.dash; else x.dash = v; }) })),
      'start-menu': () => [['none', 'None'], ['arrow', 'Arrow'], ['triangle', 'Triangle'], ['oval', 'Oval'], ['diamond', 'Diamond']].map(([v, l]) => ({ label: l, run: () => editSel((x) => { if (v === 'none') delete x.a1; else x.a1 = v; }) })),
      'end-menu': () => [['none', 'None'], ['arrow', 'Arrow'], ['triangle', 'Triangle'], ['oval', 'Oval'], ['diamond', 'Diamond']].map(([v, l]) => ({ label: l, run: () => editSel((x) => { if (v === 'none') delete x.a2; else x.a2 = v; }) })),
      'kind-menu': () => [['straight', 'Straight'], ['elbow', 'Elbow'], ['curved', 'Curved']].map(([v, l]) => ({ label: l, run: () => editSel((x) => { x.kind = v; }) })),
      'mask-menu': () => ['rect', 'round', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star5', 'heart', 'arrow', 'wedgeRoundRectCallout', 'cloud'].map((v) => ({ label: S.SHAPE_LIB[v].label, run: () => cmd('mask', v) })),
      'tblweight-menu': () => [0, 1, 2, 3, 4].map((w2) => ({ label: w2 ? `${w2} px` : 'No borders', run: () => editSel((x) => { x.bw = w2; }) })),
      'waweight-menu': () => [0, 1, 2, 4, 6].map((w2) => ({ label: w2 ? `${w2} px` : 'No outline', run: () => editSel((x) => { x.sw = w2; if (w2 && !x.stroke) x.stroke = '#000000'; }) })),
      'table-menu': () => [['row-above', 'Insert row above'], ['row-below', 'Insert row below'], ['col-left', 'Insert column left'], ['col-right', 'Insert column right'], ['del-row', 'Delete row'], ['del-col', 'Delete column'], 'divider', ['merge', 'Merge cells'], ['unmerge', 'Unmerge cells'], 'divider', ['even-rows', 'Distribute rows'], ['even-cols', 'Distribute columns'], ['header', 'Header row on/off']].map((x) => (x === 'divider' ? x : { label: x[1], run: () => tableOp(x[0]) })),
      'apply-layout-menu': () => Object.entries(S.LAYOUTS).map(([k2, l]) => ({ label: l, run: () => cmd('apply-layout', k2) })),
    };
    if (menus[c]) { openMenu(b, menus[c](), { align: 'start' }); return; }
    switch (c) {
      case 'tool-select': setTool('select'); break;
      case 'size-up': bumpSize(1); break;
      case 'size-down': bumpSize(-1); break;
      case 'bold': formatCmd('bold'); break;
      case 'italic': formatCmd('italic'); break;
      case 'underline': formatCmd('underline'); break;
      case 'indent': case 'outdent': if (!fmt(c)) toast('Click into the text first'); break;
      case 'clear': formatCmd('removeFormat'); break;
      case 'replace-image': pickImage(item()?.id); break;
      case 'shape-menu': shapePicker(b); break;
      case 'line': setTool('line:straight'); break;
      case 'fill-pick': colorMenu(b, item()?.fill, (c2) => editSel((x) => { x.fill = c2; }), { transparent: true }); break;
      case 'stroke-pick': colorMenu(b, item()?.stroke, (c2) => editSel((x) => { x.stroke = c2; x.sw = c2 ? x.sw || 2 : 0; }), { transparent: true }); break;
      case 'line-color': colorMenu(b, item()?.stroke, (c2) => editSel((x) => { x.stroke = c2 || '#1f1f1f'; })); break;
      case 'color-pick': colorMenu(b, item()?.color, (c2) => formatCmd('foreColor', c2 || S.themeOf(deck).ink)); break;
      case 'highlight-pick': colorMenu(b, null, (c2) => (c2 ? formatCmd('hiliteColor', c2) : formatCmd('hiliteColor', 'transparent')), { transparent: true }); break;
      case 'cell-fill': colorMenu(b, null, (c2) => { if (!cellsDo((cell) => { if (c2) cell.bg = c2; else delete cell.bg; })) toast('Select table cells first'); }, { transparent: true }); break;
      case 'table-border': colorMenu(b, item()?.bc, (c2) => editSel((x) => { x.bc = c2 || '#9aa0a6'; })); break;
      case 'wa-fill': colorMenu(b, item()?.fill, (c2) => editSel((x) => { x.fill = c2 || '#000000'; })); break;
      case 'wa-stroke': colorMenu(b, item()?.stroke, (c2) => editSel((x) => { x.stroke = c2; x.sw = c2 ? x.sw || 2 : 0; }), { transparent: true }); break;
      case 'wa-bold': editSel((x) => { x.b = x.b ? 0 : 1; }); break;
      case 'wa-italic': editSel((x) => { x.i = x.i ? 0 : 1; }); break;
      case 'wa-edit': wordArtText(item()); break;
      default: cmd(c);
    }
  });
  toolbar?.addEventListener('change', (e) => {
    const t = e.target; const c = t.dataset.c;
    if (c === 'zoom-select') cmd('zoom', t.value === 'fit' ? 'fit' : Number(t.value));
    if (c === 'font') formatCmd('fontName', t.value);
    if (c === 'size') { const n = Math.max(6, Math.min(400, Number(t.value) || 24)); setFontSize(n); }
    if (c === 'color') formatCmd('foreColor', t.value);
    if (c === 'highlight') formatCmd('hiliteColor', t.value);
    if (c === 'fill') editSel((x) => { x.fill = t.value; });
    if (c === 'wa-font') editSel((x) => { x.ff = t.value; });
    if (c === 'stroke') editSel((x) => { x.stroke = t.value; x.sw = x.sw || 2; });
  });
  toolbar?.addEventListener('keydown', (e) => { if (e.target.dataset.c === 'size' && e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); } });

  /* =================== Side panel: Format options and Themes =================== */
  function togglePanel(which, open = null) { panel = open === null ? (panel === which ? null : which) : open ? which : null; drawPanel(); requestAnimationFrame(() => drawCanvas()); }
  function drawPanel() {
    panelEl.hidden = !panel || !editable; root.classList.toggle('gs-with-panel', !!panel && editable);
    if (!panel) return;
    if (panel === 'themes') {
      const th = S.themeOf(deck); const cu = deck.custom || {};
      panelEl.innerHTML = `<header><b>Themes</b><button type="button" class="tb-btn" data-pc="close" aria-label="Close">${I('x')}</button></header>
      <details open><summary>Customise</summary><div class="gs-fields">${[['bg', 'Background'], ['ink', 'Text'], ['accent', 'Accent'], ['muted', 'Secondary text']].map(([k2, l]) => `<label>${l}<input type="color" data-tc="${k2}" value="${th[k2]}"></label>`).join('')}
        ${[['title', 'Title font'], ['body', 'Body font']].map(([k2, l]) => `<label>${l}<select data-tf="${k2}"><option value="">Theme font</option>${S.FONTS.map((f2) => `<option ${cu[k2] === f2 ? 'selected' : ''}>${f2}</option>`).join('')}</select></label>`).join('')}
        <div class="gs-btnrow"><button type="button" class="btn btn-plain btn-sm" data-pc="theme-reset">Reset colours and fonts</button><button type="button" class="btn btn-plain btn-sm" data-pc="theme-builder">${target ? 'Close theme builder' : 'Edit theme'}</button></div></div></details>
      <p class="muted gs-p">Themes</p><div class="gs-themes">${Object.entries(S.THEMES).map(([k2, t]) => `<button type="button" class="gs-theme ${deck.theme === k2 ? 'on' : ''}" data-theme="${k2}" aria-label="${esc(t.label)}">${slideFrame({ ...deck, theme: k2 }, deck.slides[0])}<span>${esc(t.label)}</span></button>`).join('')}</div>`;
      return;
    }
    if (panel === 'motion') {
      const sl = deck.slides[cur]; const tr = sl?.tr || { type: 'none', dur: 0.5 }; const anims = sl?.anims || [];
      panelEl.innerHTML = `<header><b>Motion</b><button type="button" class="tb-btn" data-pc="close" aria-label="Close">${I('x')}</button></header>
        <details open><summary>Slide transition</summary><div class="gs-fields gs-radios"><label>Transition<select data-mt="type">${Object.entries(S.TRANSITIONS).map(([k2, l]) => `<option value="${k2}" ${tr.type === k2 ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>Speed: <span data-mt-speed>${tr.dur.toFixed(1)} s</span><input type="range" data-mt="dur" min="0.2" max="3" step="0.1" value="${tr.dur}"></label><div class="gs-btnrow"><button type="button" class="btn btn-plain btn-sm" data-pc="tr-all">Apply to all slides</button></div></div></details>
        <details open><summary>Object animations</summary>
          ${anims.map((a, ai) => { const target2 = sl.items.find((x) => x.id === a.item); return `<div class="gs-anim-row ${animSel === a.id ? 'on' : ''}" data-anim="${a.id}"><span class="gs-anim-title">${ai + 1}. ${esc(S.EFFECTS[a.fx].label)} · ${esc(itemLabel(target2))}</span><span class="gs-anim-btns"><button type="button" class="tb-btn" data-am="up" aria-label="Move up">↑</button><button type="button" class="tb-btn" data-am="down" aria-label="Move down">↓</button><button type="button" class="tb-btn" data-am="del" aria-label="Delete animation">${I('trash')}</button></span>
            ${animSel === a.id ? `<div class="gs-fields"><label>Effect<select data-af="fx">${Object.entries(S.EFFECTS).map(([k2, v]) => `<option value="${k2}" ${a.fx === k2 ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label><label>Start<select data-af="start"><option value="click" ${a.start === 'click' ? 'selected' : ''}>On click</option><option value="with" ${a.start === 'with' ? 'selected' : ''}>With previous</option><option value="after" ${a.start === 'after' ? 'selected' : ''}>After previous</option></select></label><label>Duration (s)<input data-af="dur" value="${a.dur}"></label></div>` : ''}</div>`; }).join('') || '<p class="muted gs-p">No animations on this slide. Select an object, then Add animation.</p>'}
          <div class="gs-btnrow gs-p"><button type="button" class="btn btn-plain btn-sm" data-pc="animate" ${item() ? '' : 'disabled'}>+ Add animation</button><button type="button" class="btn btn-primary btn-sm" data-pc="play">▶ Play</button></div></details>`;
      return;
    }
    const it = item(); const list = selected();
    if (!list.length) { panelEl.innerHTML = `<header><b>Format options</b><button type="button" class="tb-btn" data-pc="close" aria-label="Close">${I('x')}</button></header><p class="muted gs-p">Select an object to see its options.</p>`; return; }
    const b = list.length === 1 ? it : boundsOf(list); const inch = (v) => (v / PX_IN).toFixed(2);
    panelEl.innerHTML = `<header><b>Format options</b><button type="button" class="tb-btn" data-pc="close" aria-label="Close">${I('x')}</button></header>
      <details open><summary>Size &amp; Rotation</summary><div class="gs-fields"><label>Width (in)<input data-f="w" value="${inch(b.w)}"></label><label>Height (in)<input data-f="h" value="${inch(b.h)}"></label>
        <label class="xl-check"><input type="checkbox" data-f="lockratio" checked> Lock aspect ratio</label>
        ${list.length === 1 ? `<label>Rotate (°)<input data-f="rot" value="${it.rot || 0}"></label><div class="gs-btnrow"><button type="button" class="btn btn-plain btn-sm" data-pc="rot-ccw">↺ 90°</button><button type="button" class="btn btn-plain btn-sm" data-pc="rot-cw">↻ 90°</button><button type="button" class="btn btn-plain btn-sm" data-pc="flip-h">⇋ Flip</button><button type="button" class="btn btn-plain btn-sm" data-pc="flip-v">⇵ Flip</button></div>` : ''}</div></details>
      <details open><summary>Position</summary><div class="gs-fields"><label>X (in)<input data-f="x" value="${inch(b.x)}"></label><label>Y (in)<input data-f="y" value="${inch(b.y)}"></label></div></details>
      ${list.every((x) => isTextual(x)) ? `<details open><summary>Text fitting</summary><div class="gs-fields gs-radios">${[['none', 'Do not autofit'], ['shrink', 'Shrink text on overflow'], ['resize', 'Resize shape to fit text']].map(([v, l]) => `<label class="xl-radio"><input type="radio" name="gs-af" data-f="af" value="${v}" ${(it.af || 'none') === v ? 'checked' : ''}> ${l}</label>`).join('')}
        <label>Padding (in)<input data-f="pad" value="${inch(it.pad ?? 8)}"></label><label>Line spacing<input data-f="lh" value="${it.lh || 1.25}"></label><label>Space after paragraphs (pt)<input data-f="ps" value="${Math.round((it.ps || 0) * 0.75)}"></label></div></details>` : ''}
      ${list.every((x) => x.t === 'image') ? `<details open><summary>Adjustments</summary><div class="gs-fields gs-radios"><label>Transparency (%)<input type="range" data-io="op" min="0" max="95" value="${Math.round((1 - (it.op || 1)) * 100)}"></label><label>Brightness<input type="range" data-io="br" min="-100" max="100" value="${it.br || 0}"></label><label>Contrast<input type="range" data-io="ct" min="-100" max="100" value="${it.ct || 0}"></label><label>Recolour<select data-io="rc"><option value="">No recolour</option>${[['gray', 'Greyscale'], ['sepia', 'Sepia'], ['light', 'Light'], ['dark', 'Dark'], ['invert', 'Negative']].map(([v, l]) => `<option value="${v}" ${it.rc === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>Alt text<input type="text" data-io="alt" value="${esc(it.alt || '')}" placeholder="Describe the image"></label></div></details>` : ''}
      ${list.every((x) => ['image', 'shape', 'wordart', 'text'].includes(x.t)) ? `<details><summary>Drop shadow</summary><div class="gs-fields"><label class="xl-check"><input type="checkbox" data-io="shadow" ${it?.shadow ? 'checked' : ''}> Drop shadow</label></div></details>` : ''}
      <details><summary>Lock</summary><div class="gs-fields"><label class="xl-check"><input type="checkbox" data-f="lock" ${it?.lock ? 'checked' : ''}> Lock position (can’t be moved or resized)</label></div></details>`;
  }
  panelEl.addEventListener('click', (e) => {
    const am = e.target.closest('[data-am]'); const row = e.target.closest('[data-anim]');
    if (am && row) { const id = row.dataset.anim; if (am.dataset.am === 'del') edit((d, sl) => { sl.anims = (sl.anims || []).filter((x) => x.id !== id); if (!sl.anims.length) delete sl.anims; }); else moveAnim(id, am.dataset.am === 'up' ? -1 : 1); return; }
    if (row && !e.target.closest('select, input')) { animSel = animSel === row.dataset.anim ? null : row.dataset.anim; const a = deck.slides[cur].anims.find((x) => x.id === row.dataset.anim); if (a && animSel) { setSel(a.item); drawCanvas(); drawToolbar(); } drawPanel(); return; }
    const b = e.target.closest('[data-pc], [data-theme]'); if (!b) return;
    if (b.dataset.theme) { const t = b.dataset.theme; edit((d) => { d.theme = t; }); return; }
    if (b.dataset.pc === 'play') { playPreview(); return; }
    if (b.dataset.pc === 'tr-all') { const tr = deck.slides[cur]?.tr; setTransition(tr?.type || 'none', tr?.dur || 0.5, true); toast('Transition applied to all slides'); return; }
    if (b.dataset.pc === 'close') togglePanel(panel, false); else if (b.dataset.pc === 'theme-reset') edit((d) => { delete d.custom; }); else cmd(b.dataset.pc);
  });
  panelEl.addEventListener('input', (e) => { if (e.target.dataset.mt === 'dur') panelEl.querySelector('[data-mt-speed]').textContent = `${Number(e.target.value).toFixed(1)} s`; });
  panelEl.addEventListener('change', (e) => {
    if (e.target.dataset.mt) { const tr = deck.slides[cur]?.tr || { type: 'none', dur: 0.5 }; const type = e.target.dataset.mt === 'type' ? e.target.value : tr.type; const dur = e.target.dataset.mt === 'dur' ? Number(e.target.value) : tr.dur; if (type === 'none' && e.target.dataset.mt === 'dur') return; setTransition(type === 'none' && e.target.dataset.mt === 'type' ? 'none' : type === 'none' ? 'fade' : type, dur); return; }
    if (e.target.dataset.af) { const row = e.target.closest('[data-anim]'); const k2 = e.target.dataset.af; const v = e.target.value; editAnim(row.dataset.anim, (a) => { a[k2] = k2 === 'dur' ? Math.max(0.1, Math.min(10, Number(v) || 0.5)) : v; }); return; }
    if (e.target.dataset.tc) { const k2 = e.target.dataset.tc, v = e.target.value; edit((d) => { d.custom = { ...(d.custom || {}), [k2]: v }; }); return; }
    if (e.target.dataset.tf) { const k2 = e.target.dataset.tf, v = e.target.value; edit((d) => { d.custom = { ...(d.custom || {}) }; if (v) d.custom[k2] = v; else delete d.custom[k2]; }); return; }
    if (e.target.dataset.io) { const k2 = e.target.dataset.io; const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; editSel((x) => { if (k2 === 'op') { const n = 1 - Number(v) / 100; if (n >= 1) delete x.op; else x.op = n; } else if (k2 === 'shadow') { if (v) x.shadow = 1; else delete x.shadow; } else if (k2 === 'rc') { if (v) x.rc = v; else delete x.rc; } else if (k2 === 'alt') x.alt = v; else { const n = Number(v); if (n) x[k2] = n; else delete x[k2]; } }); return; }
    const f = e.target.dataset.f; if (!f) return; const v = e.target.value; const list = selected(); if (!list.length) return;
    const px = (s) => Math.round(Number(s) * PX_IN);
    if (['w', 'h'].includes(f)) {
      const lock = panelEl.querySelector('[data-f="lockratio"]')?.checked; const b = list.length === 1 ? list[0] : boundsOf(list);
      const nw = f === 'w' ? px(v) : lock ? Math.round(b.w * (px(v) / b.h)) : b.w, nh = f === 'h' ? px(v) : lock ? Math.round(b.h * (px(v) / b.w)) : b.h;
      if (!(nw > 0 && nh > 0)) return drawPanel();
      const sx = nw / b.w, sy = nh / b.h; editSel((x) => { x.x = Math.round(b.x + (x.x - b.x) * sx); x.y = Math.round(b.y + (x.y - b.y) * sy); x.w = Math.max(10, Math.round(x.w * sx)); x.h = Math.max(10, Math.round(x.h * sy)); });
    }
    if (f === 'x' || f === 'y') { const b = list.length === 1 ? list[0] : boundsOf(list); const d2 = px(v) - b[f]; if (Number.isFinite(d2)) editSel((x) => { x[f] += d2; }); }
    if (f === 'rot') { const n = Number(v); if (Number.isFinite(n)) editSel((x) => { x.rot = ((n % 360) + 360) % 360; }); }
    if (f === 'af') cmd('fit', v);
    if (f === 'pad') { const n = px(v); if (n >= 0) editSel((x) => { x.pad = n; }); }
    if (f === 'lh') { const n = Number(v); if (n > 0) cmd('lh', n); }
    if (f === 'ps') { const n = Number(v); if (n >= 0) cmd('ps', Math.round(n / 0.75)); }
    if (f === 'lock') editSel((x) => { if (e.target.checked) x.lock = 1; else delete x.lock; });
  });

  /* =================== Keyboard =================== */
  canvas.addEventListener('keydown', (e) => {
    if (fileMode && (e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyM') { e.preventDefault(); commentHere(); return; } // Comment (as in Google Slides)
    if (!editable || editingId) return;
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
    if (globalKeys(e)) return;
    const it = item();
    if (e.key === 'Tab') { e.preventDefault(); const items = [...slide().items].sort((a, b) => a.z - b.z); if (!items.length) return; const i = items.findIndex((x) => x.id === sel); const n = items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]; enteredGroup = null; setSel(n.id); drawCanvas(); drawToolbar(); drawPanel(); return; }
    if (mod && e.shiftKey && (e.key === '>' || e.key === '<' || e.code === 'Period' || e.code === 'Comma')) { e.preventDefault(); bumpSize(e.key === '>' || e.code === 'Period' ? 1 : -1); return; }
    if (mod && k === 'b') { e.preventDefault(); formatCmd('bold'); return; }
    if (mod && k === 'i') { e.preventDefault(); formatCmd('italic'); return; }
    if (mod && k === 'u') { e.preventDefault(); formatCmd('underline'); return; }
    if (mod && k === 'k') { e.preventDefault(); cmd('link'); return; }
    if (mod && k === 'g') { e.preventDefault(); cmd(e.shiftKey ? 'ungroup' : 'group'); return; }
    if (mod && (k === 'arrowup' || k === 'arrowdown')) { e.preventDefault(); cmd(e.shiftKey ? (k === 'arrowup' ? 'front' : 'back') : (k === 'arrowup' ? 'forward' : 'backward')); return; }
    if (mod && k === 'a') { e.preventDefault(); cmd('select-all'); return; }
    if (mod && ['c', 'x'].includes(k) && it) { e.preventDefault(); cmd(k === 'c' ? 'copy' : 'cut'); return; }
    if (mod && k === 'v') { e.preventDefault(); cmd('paste'); return; }
    if (mod && k === 'd' && it) { e.preventDefault(); cmd('duplicate'); return; }
    if ((e.key === 'Enter' || e.key === ' ') && tool !== 'select') { // place the chosen object in the middle of the slide
      e.preventDefault();
      if (tool.startsWith('line')) { const kind = tool.split(':')[1] || 'straight', arrow = tool.split(':')[2] === 'arrow'; tool = 'select'; root.classList.remove('gs-drawing'); addItem({ t: 'line', kind, x1: S.W / 2 - 100, y1: Math.round(H() / 2), x2: S.W / 2 + 100, y2: Math.round(H() / 2), stroke: '#1f1f1f', sw: 2, ...(arrow || kind !== 'straight' ? { a2: 'arrow' } : {}) }); drawToolbar(); }
      else createWithTool({ x: S.W / 2, y: H() / 2, w: 0, h: 0 });
      return;
    }
    if (e.key === 'Escape' && cropId) { cropId = null; drawCanvas(); return; }
    if (e.key === 'Escape' && cellSel) { cellSel = null; drawCanvas(); drawToolbar(); return; }
    if (e.key === 'Enter' && cropId) { cropId = null; drawCanvas(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && cellSel && item()?.t === 'table') { e.preventDefault(); cellsDo((cell) => { cell.html = ''; }); return; }
    if (e.key === 'Escape') { if (painter) { painter = null; root.classList.remove('gs-painting'); drawToolbar(); return; } if (tool !== 'select') { setTool('select'); return; } if (enteredGroup) { const g = enteredGroup; enteredGroup = null; setSel(slide().items.find((x) => x.g === g)?.id || null); } else setSel(null); drawCanvas(); drawToolbar(); drawPanel(); return; }
    if (!it) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); cmd('delete'); return; }
    if (e.key === 'Enter') { e.preventDefault(); startText(it.id); drawToolbar(); return; }
    const nudge = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (nudge && !mod) { e.preventDefault(); const n = e.shiftKey ? 1 : 8; if (selected().some((x) => x.lock)) return; editSel((x) => { x.x += nudge[0] * n; x.y += nudge[1] * n; }); } // Google: arrows move; Shift+arrow moves one pixel
  });
  /** Shortcuts that work anywhere in the editor (except while typing). */
  function globalKeys(e) {
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); cmd(e.shiftKey ? 'redo' : 'undo'); return true; }
    if (mod && k === 'y') { e.preventDefault(); cmd('redo'); return true; }
    if (mod && k === 'm') { e.preventDefault(); cmd('new-slide'); return true; }
    if (mod && e.shiftKey && k === 'h') { e.preventDefault(); cmd('find'); return true; }
    if (mod && !e.shiftKey && k === 'f') { e.preventDefault(); cmd('find'); return true; }
    if (mod && e.altKey && (e.key === '=' || e.key === '+' || e.code === 'Equal')) { e.preventDefault(); cmd('zoom-in'); return true; }
    if (mod && e.altKey && (e.key === '-' || e.code === 'Minus')) { e.preventDefault(); cmd('zoom-out'); return true; }
    if (mod && e.altKey && e.code === 'Digit1') { e.preventDefault(); cmd('grid-view'); return true; }
    if (mod && e.key === 'F5') { e.preventDefault(); cmd('present', e.shiftKey ? 'start' : undefined); return true; }
    if (mod && e.key === '/') { e.preventDefault(); cmd('shortcuts'); return true; }
    return false;
  }

  /* =================== Filmstrip and grid view: select several slides, drag to reorder =================== */
  function pickSlide(i, e) {
    if (e.shiftKey) { const a = Math.min(cur, i), b = Math.max(cur, i); selSlides = new Set(Array.from({ length: b - a + 1 }, (_, j) => a + j)); }
    else if (e.metaKey || e.ctrlKey) { if (selSlides.has(i) && selSlides.size > 1) selSlides.delete(i); else selSlides.add(i); cur = i; }
    else { cur = i; selSlides = new Set([i]); }
    if (!e.shiftKey) cur = i; setSel(null); editingId = null; enteredGroup = null; animSel = null; draw();
  }
  for (const host of [film, gridEl]) {
    host.addEventListener('click', (e) => { const tl = e.target.closest('[data-target]'); if (tl) { target = tl.dataset.target; setSel(null); draw(); return; } const li = e.target.closest('.deck-thumb'); if (!li) return; pickSlide(Number(li.dataset.i), e); if (host === film) film.focus({ preventScroll: true }); if (e.target.closest('[data-c="grid-view"]')) cmd('grid-view'); });
    let from = null;
    host.addEventListener('dragstart', (e) => { const li = e.target.closest('.deck-thumb'); if (!li) return; const i = Number(li.dataset.i); if (!selSlides.has(i)) { selSlides = new Set([i]); cur = i; } from = slidesPicked(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
    host.addEventListener('dragover', (e) => { if (!from) return; e.preventDefault(); host.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before')); e.target.closest('.deck-thumb')?.classList.add('drop-before'); });
    host.addEventListener('drop', (e) => { e.preventDefault(); const li = e.target.closest('.deck-thumb'); if (!from || !li) return; let to = Number(li.dataset.i); const idx = from; from = null; to -= idx.filter((i) => i < to).length; moveSlides(idx, to); });
    host.addEventListener('dragend', () => { from = null; host.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before')); });
  }
  gridEl.addEventListener('dblclick', (e) => { const li = e.target.closest('.deck-thumb'); if (!li) return; cur = Number(li.dataset.i); selSlides = new Set([cur]); cmd('grid-view'); });
  gridEl.addEventListener('click', (e) => { if (e.target.closest('[data-c="grid-view"]')) cmd('grid-view'); });
  film.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
    if (globalKeys(e)) return;
    if (k === 'arrowdown' || k === 'arrowup') { e.preventDefault(); const n = Math.max(0, Math.min(deck.slides.length - 1, cur + (k === 'arrowdown' ? 1 : -1))); if (e.shiftKey) { selSlides.add(n); cur = n; draw(); } else pickSlide(n, {}); return; }
    if (!editable) return;
    if (mod && k === 'c') { e.preventDefault(); clipboard = { kind: 'slides', slides: structuredClone(slidesPicked().map((i) => deck.slides[i])) }; toast(selSlides.size > 1 ? `${selSlides.size} slides copied` : 'Slide copied'); return; }
    if (mod && k === 'x') { e.preventDefault(); clipboard = { kind: 'slides', slides: structuredClone(slidesPicked().map((i) => deck.slides[i])) }; cmd('del-slide'); return; }
    if (mod && k === 'v') { e.preventDefault(); cmd('paste'); return; }
    if (mod && k === 'd') { e.preventDefault(); cmd('dup-slide'); return; }
    if (mod && k === 'a') { e.preventDefault(); selSlides = new Set(deck.slides.map((_, i) => i)); drawFilm(); return; }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); cmd('del-slide'); return; }
    if (mod && (k === 'arrowup' || k === 'arrowdown')) { e.preventDefault(); cmd('move-slide', e.shiftKey ? (k === 'arrowup' ? 'start' : 'end') : (k === 'arrowup' ? 'up' : 'down')); }
  });
  root.addEventListener('keydown', (e) => { if (gridView && e.key === 'Escape') { e.preventDefault(); cmd('grid-view'); } });

  /* =================== Speaker notes =================== */
  let nt = null;
  notes?.addEventListener('input', () => { clearTimeout(nt); nt = setTimeout(() => { const v = notes.value; edit((d, s) => { s.notes = v; }); }, 600); });

  /* =================== Find and replace (all slides and speaker notes) =================== */
  function textNodesReplace(html, re, repl, nth = -1) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html'); const rootN = doc.body.firstChild;
    const walker = doc.createTreeWalker(rootN, NodeFilter.SHOW_TEXT); let count = 0; let n;
    while ((n = walker.nextNode())) n.nodeValue = n.nodeValue.replace(re, (m) => { const i = count++; return nth < 0 || i === nth ? repl : m; });
    return { html: S.sanitizeHtml(rootN.innerHTML), count };
  }
  function findReplace() {
    let matches = [], at = -1;
    const build = (f) => {
      const find = f.elements.find.value; matches = []; if (!find) return;
      const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f.elements.mc.checked ? 'g' : 'gi');
      deck.slides.forEach((s, si) => { for (const x of [...s.items].sort((a, b) => a.y - b.y || a.x - b.x)) { if (!x.html) continue; const n = (S.plainText(x.html).match(re) || []).length; for (let i = 0; i < n; i++) matches.push({ si, id: x.id, i }); } const nn = (String(s.notes || '').match(re) || []).length; for (let i = 0; i < nn; i++) matches.push({ si, notes: true, i }); });
      return re;
    };
    openModal({ title: 'Find and replace', body: `<form class="form" id="gs-find"><label class="field"><span>Find</span><input name="find" autocomplete="off"></label><label class="field"><span>Replace with</span><input name="repl" autocomplete="off"></label><label class="xl-check"><input type="checkbox" name="mc"> Match case</label><p class="muted gs-find-status" aria-live="polite"></p></form>`,
      footer: '<button class="btn btn-plain" data-f="prev">Previous</button><button class="btn btn-plain" data-f="next">Next</button><button class="btn btn-plain" data-f="one">Replace</button><button class="btn btn-primary" data-f="all">Replace all</button>',
      onMount: (el) => {
        const f = el.querySelector('#gs-find'); const status = el.querySelector('.gs-find-status'); setTimeout(() => f.elements.find.focus(), 40);
        const go = (dir) => { build(f); if (!matches.length) { status.textContent = 'No results'; return; } at = (at + dir + matches.length) % matches.length; const m = matches[at]; cur = m.si; selSlides = new Set([cur]); if (m.id) setSel(m.id); else setSel(null); draw(); status.textContent = `${at + 1} of ${matches.length}${m.notes ? ' (in speaker notes)' : ''}`; };
        f.addEventListener('submit', (e) => { e.preventDefault(); go(1); });
        f.addEventListener('input', () => { at = -1; build(f); status.textContent = f.elements.find.value ? `${matches.length} result${matches.length === 1 ? '' : 's'}` : ''; });
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-f]'); if (!b) return; e.preventDefault();
          if (b.dataset.f === 'next') go(1); if (b.dataset.f === 'prev') go(-1);
          if (b.dataset.f === 'one' || b.dataset.f === 'all') {
            const re = build(f); if (!re || !matches.length) { status.textContent = 'No results'; return; }
            const repl = f.elements.repl.value; const next = structuredClone(deck); let n = 0;
            if (b.dataset.f === 'all') { for (const s of next.slides) { for (const x of s.items) if (x.html) { const r = textNodesReplace(x.html, re, repl); n += r.count; x.html = r.html; } if (s.notes) { n += (s.notes.match(re) || []).length; s.notes = s.notes.replace(re, repl); } } }
            else { const m = matches[Math.max(0, at)]; const s = next.slides[m.si]; if (m.notes) { let i = 0; s.notes = s.notes.replace(re, (x) => (i++ === m.i ? repl : x)); } else { const x = s.items.find((y) => y.id === m.id); x.html = textNodesReplace(x.html, re, repl, m.i).html; } n = 1; at -= 1; }
            commit(next); build(f); status.textContent = `Replaced ${n} occurrence${n === 1 ? '' : 's'}${matches.length ? `; ${matches.length} left` : ''}`;
          }
        });
      } });
  }

  /* =================== Page setup, shortcuts, import/export, images =================== */
  function pageSetup() {
    let out = null;
    openModal({ title: 'Page setup', body: `<form class="form" id="gs-ps">${[['16:9', 'Widescreen 16:9'], ['4:3', 'Standard 4:3']].map(([v, l]) => `<label class="xl-radio"><input type="radio" name="r" value="${v}" ${deck.ratio === v ? 'checked' : ''}> ${l}</label>`).join('')}</form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="gs-ps">Apply</button>',
      onMount: (el, close) => el.querySelector('#gs-ps').addEventListener('submit', (e) => { e.preventDefault(); out = e.target.elements.r.value; close(); }),
      onClose: () => setTimeout(() => { if (out && out !== deck.ratio) edit((d) => { const old = S.heightFor(d.ratio); d.ratio = out; const k2 = S.heightFor(d.ratio) / old; d.slides.forEach((s) => s.items.forEach((x) => { x.y = Math.round(x.y * k2); x.h = Math.round(x.h * k2); })); }); }, 30) });
  }
  function shortcutsDialog() {
    const rows = [['New slide', 'Cmd+M'], ['Duplicate', 'Cmd+D'], ['Group / ungroup', 'Cmd+G / Cmd+Shift+G'], ['Bring forward / send backward', 'Cmd+↑ / Cmd+↓'], ['Bring to front / send to back', 'Cmd+Shift+↑ / ↓'], ['Next / previous object', 'Tab / Shift+Tab'], ['Move / move 1 px', 'Arrows / Shift+Arrows'], ['Duplicate while dragging', 'Alt+drag'], ['Keep proportions / straight lines', 'Shift+drag'], ['Resize from centre', 'Alt+drag a handle'], ['Rotate in 15° steps', 'Shift+drag the rotate handle'], ['Ignore guides while dragging', 'Cmd+drag'], ['Edit text', 'Enter or double-click'], ['Bold / italic / underline', 'Cmd+B / I / U'], ['Strikethrough', 'Alt+Shift+5'], ['Superscript / subscript', 'Cmd+. / Cmd+,'], ['Font size', 'Cmd+Shift+> / <'], ['Bulleted / numbered list', 'Cmd+Shift+8 / 7'], ['Indent list item', 'Tab / Shift+Tab'], ['Align left / centre / right / justify', 'Cmd+Shift+L / E / R / J'], ['Link', 'Cmd+K'], ['Clear formatting', 'Cmd+\\'], ['Find and replace', 'Cmd+F / Cmd+Shift+H'], ['Zoom in / out', 'Cmd+Alt+= / -'], ['Grid view', 'Cmd+Alt+1'], ['Slideshow / from beginning', 'Cmd+F5 / Cmd+Shift+F5']];
    openModal({ title: 'Keyboard shortcuts', body: `<table class="gs-keys">${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td><kbd>${esc(kbd(b))}</kbd></td></tr>`).join('')}</table>`, footer: '<button class="btn btn-primary" data-close>Close</button>' });
  }
  async function exportPptx() {
    try {
      const res = await fetch('/api/slides/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workspace' }, body: JSON.stringify({ data: deck, title }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Couldn’t export');
      const blob = await res.blob(); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${title}.pptx` });
      const note = res.headers.get('X-Export-Note'); if (note) toast(`Downloaded. Note: ${decodeURIComponent(note)}`);
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) { toast(err.message, { tone: 'error' }); }
  }
  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.classList.contains('deck-img') && t.files[0]) {
      const file = t.files[0]; const replace = t.dataset.replace; t.value = '';
      try {
        const f = await store.uploadFile(file, { noteId, name: file.name });
        const dims = await new Promise((r) => { const im = new Image(); im.onload = () => r({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => r({ w: 4, h: 3 }); im.src = f.url; });
        const target = replace ? item(replace) : null; const box = target || { x: 180, y: 60, w: 600, h: H() - 140 };
        const sc = Math.min(box.w / dims.w, box.h / dims.h); const w = Math.round(dims.w * sc), h = Math.round(dims.h * sc);
        const img = { t: 'image', src: f.url, x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h, ...(target?.rot ? { rot: target.rot } : {}) };
        if (target) { const id = target.id; edit((d, s) => { s.items = s.items.filter((x) => x.id !== id); }); }
        addItem(img);
      } catch (err) { toast(err.message, { tone: 'error' }); }
    }
    if (t.classList.contains('deck-file') && t.files[0]) {
      const file = t.files[0]; t.value = '';
      if (!(await confirmDialog({ title: 'Replace this presentation?', message: `“${file.name}” replaces this presentation (Undo brings it back).`, confirmLabel: 'Replace', tone: 'primary' }))) return;
      try {
        const res = await fetch(`/api/slides/import${noteId ? `?noteId=${encodeURIComponent(noteId)}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'workspace', 'X-Filename': encodeURIComponent(file.name) }, body: file });
        const out = await res.json(); if (!res.ok) throw new Error(out.error || 'Couldn’t import that file');
        cur = 0; selSlides = new Set([0]); setSel(null); commit(out.deck);
        toast(`Imported ${out.deck.slides.length} slide${out.deck.slides.length === 1 ? '' : 's'}${out.note ? ` (${out.note})` : ''}`);
      } catch (err) { toast(err.message, { tone: 'error' }); }
    }
  });

  draw();
  return {
    update(next) {
      const d = parse(next); if (JSON.stringify(d) === JSON.stringify(deck)) return;
      deck = d; cur = Math.min(cur, deck.slides.length - 1); selSlides = new Set([...selSlides].filter((i) => i < deck.slides.length)); if (!selSlides.size) selSlides = new Set([cur]);
      if (sel && !item()) setSel(null); multi = new Set([...multi].filter((id) => item(id)));
      if (editingId) { drawFilm(); return; } // don't redraw under someone typing
      draw();
    },
    destroy() { document.removeEventListener('comments:anchors', onCommentAnchors); document.removeEventListener('slides:goto', onCommentGoto); canvas.querySelector('.sl-rich.editing')?.blur(); },
  };
}
