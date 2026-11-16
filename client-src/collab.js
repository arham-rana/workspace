// Browser bundle: the collaborative editor engine and its browser-only behaviour.
// Built with esbuild into public/js/vendor/collab.js (see build.mjs).
import { Editor, Extension, InputRule, textblockTypeInputRule, nodeInputRule } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Suggestion from '@tiptap/suggestion';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import katex from 'katex';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { codeTokens, detectLang, LANG_NAMES } from '../public/js/codehl.js';
import { baseExtensions, MathBlock, MathInline, Toc, Dropdown, Chart, Signature, Embed, FileLink, Sheet, Slides } from '../shared/schema.mjs';
import { markdownToDoc, docToMarkdown } from '../shared/convert.mjs';
import { toEntries, fromEntries, entryChanges, withBlockData, sideToEntryOps } from '../shared/blocks.mjs';

export { Editor, HocuspocusProvider, Y, katex, markdownToDoc, docToMarkdown, Extension, Plugin, PluginKey, Decoration, DecorationSet };

/** KaTeX to HTML, never throwing (shows the source in red when it can't be typeset). */
export function renderMath(latex, displayMode) {
  try { return katex.renderToString(latex || '\\square', { displayMode, throwOnError: false, output: 'html', strict: 'ignore' }); }
  catch { return `<span class="math-error">${String(latex).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>`; }
}

/* ---------- Equations: typeset view, click to edit ---------- */
const mathView = (display) => ({ node, getPos, editor }) => {
  const dom = document.createElement(display ? 'div' : 'span');
  dom.className = display ? 'math-block' : 'math-inline';
  dom.contentEditable = 'false';
  const draw = (n) => { dom.innerHTML = renderMath(n.attrs.latex, display); dom.title = 'Click to edit the equation'; };
  draw(node);
  dom.addEventListener('click', () => {
    if (!editor.isEditable) return;
    dom.dispatchEvent(new CustomEvent('math-edit', { bubbles: true, detail: { pos: getPos(), latex: node.attrs.latex, display, dom } }));
  });
  return { dom, update(n) { if (n.type !== node.type) return false; node = n; draw(n); return true; }, ignoreMutation: () => true };
};
const MathBlockView = MathBlock.extend({
  addNodeView() { return mathView(true); },
  addInputRules() {
    return [new InputRule({ find: /^\$\$\s$/, handler: ({ state, range, chain }) => { chain().deleteRange(range).insertContent({ type: 'mathBlock', attrs: { latex: '' } }).run(); setTimeout(() => this.editor.view.dom.dispatchEvent(new CustomEvent('math-new', { bubbles: true, detail: { display: true } })), 0); } })];
  },
});
const MathInlineView = MathInline.extend({
  addNodeView() { return mathView(false); },
  addInputRules() {
    // Typing $x^2$ turns the whole thing (both dollar signs included) into an equation.
    return [new InputRule({
      find: /(^|\s)\$(?=\S)([^$\n]*?\S)\$$/,
      handler: ({ range, match, chain }) => {
        const start = range.from + match[1].length;
        chain().deleteRange({ from: start, to: range.to }).insertContentAt(start, { type: 'mathInline', attrs: { latex: match[2] } }).run();
      },
    })];
  },
});

/* ---------- Contents block that lists the headings live ---------- */
const tocViews = new Set();
const TocView = Toc.extend({
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div');
      dom.className = 'toc toc-block';
      dom.contentEditable = 'false';
      dom.dataset.toc = '1';
      const draw = () => {
        const heads = [];
        editor.state.doc.descendants((n) => { if (n.type.name === 'heading') heads.push(n); });
        dom.innerHTML = `<p class="toc-title">Contents</p>${heads.length ? `<ol>${heads.map((h, i) => `<li class="toc-h${h.attrs.level}"><a href="#" class="toc-link" data-h="${i}">${(h.textContent || 'Untitled').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</a></li>`).join('')}</ol>` : '<p class="toc-empty">Add headings and they’ll be listed here.</p>'}`;
      };
      const view = { draw };
      tocViews.add(view);
      draw();
      editor.on('update', draw);
      return { dom, ignoreMutation: () => true, destroy() { tocViews.delete(view); editor.off('update', draw); } };
    };
  },
});

/* ---------- Code blocks: colours, language label and Copy (display only, never saved) ---------- */
const CodeColors = Extension.create({
  name: 'codeColors',
  addProseMirrorPlugins() {
    const build = (doc) => {
      const decos = [];
      doc.descendants((node, pos) => {
        if (node.type.name !== 'codeBlock') return;
        const chosen = node.attrs.language || '';
        const lang = chosen || detectLang(node.textContent); // no language chosen: detect it
        for (const t of codeTokens(node.textContent, lang)) decos.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: t.cls }));
        // Language menu, Copy and Delete in the block's top corner (placed outside its text).
        decos.push(Decoration.widget(pos, (view, getPos) => {
          const anchor = document.createElement('div');
          anchor.className = 'code-tools-anchor';
          anchor.contentEditable = 'false';
          const editable = view.editable;
          anchor.innerHTML = `<span class="code-tools">
            ${editable ? `<select class="code-lang-select" aria-label="Code language">${Object.entries(LANG_NAMES).map(([k, l]) => `<option value="${k}" ${k === lang ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<span class="code-lang">${LANG_NAMES[lang] || lang}</span>`}
            <span class="code-actions"><button type="button" class="code-copy">Copy</button>${editable ? '<button type="button" class="code-del" title="Delete code block">Delete</button>' : ''}</span>
          </span>`;
          const nodeHere = () => { const p = getPos(); const n = p === undefined ? null : view.state.doc.nodeAt(p); return n?.type.name === 'codeBlock' ? { p, n } : null; };
          anchor.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
          anchor.querySelector('.code-copy').addEventListener('click', async (e) => {
            const x = nodeHere();
            try { await navigator.clipboard.writeText(x?.n.textContent || ''); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1500); } catch { e.target.textContent = `Press ${/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '') ? 'Cmd' : 'Ctrl'}+C`; }
          });
          anchor.querySelector('.code-del')?.addEventListener('click', () => { const x = nodeHere(); if (x) view.dispatch(view.state.tr.delete(x.p, x.p + x.n.nodeSize)); view.focus(); });
          anchor.querySelector('.code-lang-select')?.addEventListener('change', (e) => { const x = nodeHere(); if (x) view.dispatch(view.state.tr.setNodeMarkup(x.p, null, { ...x.n.attrs, language: e.target.value })); });
          return anchor;
        }, { side: -1, ignoreSelection: true, stopEvent: () => true, key: `code-tools-${lang}-${chosen ? 'set' : 'auto'}` }));
        return false;
      });
      return DecorationSet.create(doc, decos);
    };
    const key = new PluginKey('codeColors');
    return [new Plugin({
      key,
      state: { init: (_, st) => build(st.doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
      props: { decorations: (st) => key.getState(st) },
    })];
  },
});

/* ---------- Dropdown chips, charts and signature boxes (drawn by the app) ---------- */
const R = () => window.__docRenderers || {};
const atomView = (tag, cls, render, event) => ({ node, getPos }) => {
  const dom = document.createElement(tag);
  dom.className = cls;
  dom.contentEditable = 'false';
  const draw = (n) => render(dom, n);
  draw(node);
  dom.addEventListener('click', (e) => {
    if (e.target.closest('button[data-sign]')) return; // signing is handled separately
    dom.dispatchEvent(new CustomEvent(event, { bubbles: true, detail: { pos: getPos(), node, dom } }));
  });
  return {
    dom,
    update(n) { if (n.type !== node.type) return false; node = n; draw(n); return true; },
    ignoreMutation: () => true,
    stopEvent: (e) => !!e.target.closest?.('button'),
  };
};
const DropdownView = Dropdown.extend({ addNodeView() { return atomView('span', 'dd-host', (dom, n) => { dom.innerHTML = R().dropdown?.(n.attrs.data) || ''; }, 'dd-click'); } });
const ChartView = Chart.extend({ addNodeView() { return atomView('div', 'chart-host', (dom, n) => { dom.innerHTML = R().chart?.(n.attrs.spec) || ''; dom.title = 'Click to edit the chart'; }, 'chart-edit'); } });
const EmbedView = Embed.extend({ addNodeView() { return atomView('div', 'embed-host', (dom, n) => { if (dom.dataset.drawn !== n.attrs.data) { dom.dataset.drawn = n.attrs.data; dom.innerHTML = R().embed?.(n.attrs.data) || ''; } }, 'embed-click'); } });
// Spreadsheets and presentations: the app draws them. While co-editing, each block's data lives in the shared document
// as many small entries (one per cell / slide object, see shared/blocks.mjs), so people editing different parts at the
// same moment never overwrite each other. Without a shared document, the whole block is one attribute (older behaviour).
const LOCAL = Symbol('local block edit');
const mounted = new WeakMap(); // ydoc → Map(bid → node view dom): spots a copied block (two blocks with one id)
const newBid = () => (globalThis.crypto?.randomUUID?.() || `b${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const appBlockView = (name, render, opts = {}) => ({ node, getPos, editor }) => {
  const dom = document.createElement('div');
  dom.className = `${name}-host`;
  dom.contentEditable = 'false';
  const ydoc = opts.ydoc || null; const blocks = ydoc?.getMap('blocks') || null;
  const live = mounted.get(ydoc) || (ydoc && mounted.set(ydoc, new Map()).get(ydoc));
  let bid = node.attrs.bid || null;
  const entriesOf = (id) => { const m = id && blocks?.get(id); return m && m.size ? m.toJSON() : null; };
  const current = () => { const e = entriesOf(bid); if (e) return fromEntries(name, e); try { return JSON.parse(node.attrs.data); } catch { return null; } };
  const setBid = (id) => { const p = getPos(); if (p === undefined) return; const n = editor.state.doc.nodeAt(p); if (!n || n.type.name !== name) return; editor.view.dispatch(editor.state.tr.setNodeMarkup(p, null, { ...n.attrs, bid: id }).setMeta('addToHistory', false)); };
  const seed = (id, data) => { if (!data) return; ydoc.transact(() => { const m = new Y.Map(); blocks.set(id, m); for (const [k, v] of Object.entries(toEntries(name, data))) m.set(k, v); }, LOCAL); };
  /** Give this block its own entries if it has none yet (a new block) or shares them with another (a copy). */
  function claim() {
    if (!blocks || !editor.isEditable) return;
    const other = bid && live.get(bid); const isCopy = other && other !== dom && other.isConnected;
    if (bid && !isCopy && entriesOf(bid)) { live.set(bid, dom); return; }
    if (bid && !isCopy && !entriesOf(bid)) { seed(bid, current()); live.set(bid, dom); return; } // id without entries: start them from the saved data
    const data = isCopy ? fromEntries(name, entriesOf(bid) || {}) : current();
    const id = newBid(); seed(id, data); bid = id; live.set(id, dom); setTimeout(() => setBid(id), 0); // can't change the document while it's being drawn
  }
  let ymap = null;
  const onEntries = (e) => { if (e.transaction.origin === LOCAL) return; ctl?.update(JSON.stringify(current())); }; // our own edits are already on screen
  const onBlocks = (e) => { if (bid && e.keysChanged.has(bid)) { watch(); if (e.transaction.origin !== LOCAL) ctl?.update(JSON.stringify(current())); } };
  function watch() { ymap?.unobserve(onEntries); ymap = bid ? blocks?.get(bid) || null : null; ymap?.observe(onEntries); }
  // legacy (no shared document): write the whole block, re-applying our recent changes if a simultaneous write replaced them
  let pending = [];
  const writeAttr = (data) => { const p = getPos(); const n = p === undefined ? null : editor.state.doc.nodeAt(p); if (!n || n.type.name !== name || n.attrs.data === data) return; editor.view.dispatch(editor.state.tr.setNodeMarkup(p, null, { ...n.attrs, data })); };
  const change = (fn, hint = null) => {
    const m = blocks && bid ? blocks.get(bid) : null;
    if (m?.size && hint?.side) { // the app's own change list: write just those entries
      const { set, del } = sideToEntryOps(name, hint.side, (k) => m.get(k), () => m.keys());
      if (Object.keys(set).length || del.length) ydoc.transact(() => { for (const [k, v] of Object.entries(set)) m.set(k, v); for (const k of del) m.delete(k); }, LOCAL);
      return;
    }
    if (blocks && bid && entriesOf(bid)) {
      const cur = current(); const next = fn(cur); if (!next) return;
      const { set, del } = entryChanges(entriesOf(bid) || {}, toEntries(name, next));
      if (!Object.keys(set).length && !del.length) return;
      ydoc.transact(() => { const m = blocks.get(bid); for (const [k, v] of Object.entries(set)) m.set(k, v); for (const k of del) m.delete(k); }, LOCAL);
      return;
    }
    const p = getPos(); const n = p === undefined ? null : editor.state.doc.nodeAt(p);
    if (!n || n.type.name !== name) return;
    let cur = null; try { cur = JSON.parse(n.attrs.data); } catch { cur = null; }
    const next = fn(cur); if (!next) return;
    pending.push({ fn, at: Date.now() }); writeAttr(JSON.stringify(next));
  };
  let healing = null;
  const heal = (data) => {
    pending = pending.filter((x) => Date.now() - x.at < 5000);
    if (!pending.length || !editor.isEditable || (blocks && bid)) return;
    let merged = null; try { merged = JSON.parse(data); } catch { return; }
    for (const x of pending) merged = x.fn(merged) || merged;
    const out = JSON.stringify(merged);
    if (out !== data) { clearTimeout(healing); healing = setTimeout(() => writeAttr(out), 0); }
  };
  const remove = () => { const p = getPos(); if (p !== undefined) editor.view.dispatch(editor.state.tr.delete(p, p + editor.state.doc.nodeAt(p).nodeSize)); };
  claim(); watch(); blocks?.observe(onBlocks);
  const ctl = R()[render]?.(dom, JSON.stringify(current()), { editable: editor.isEditable, change, remove });
  return {
    dom,
    update(n) {
      if (n.type !== node.type) return false;
      const prevBid = bid; node = n;
      if (n.attrs.bid && n.attrs.bid !== bid) { if (live?.get(bid) === dom) live.delete(bid); bid = n.attrs.bid; claim(); watch(); }
      if (blocks && bid && entriesOf(bid)) { if (prevBid !== bid) ctl?.update(JSON.stringify(current())); return true; } // the entries are the truth; the attribute is only a saved snapshot
      heal(n.attrs.data); ctl?.update(n.attrs.data); return true;
    },
    stopEvent: () => true, ignoreMutation: () => true, selectNode() {}, deselectNode() {},
    destroy() { ymap?.unobserve(onEntries); blocks?.unobserve(onBlocks); if (live?.get(bid) === dom) live.delete(bid); ctl?.destroy?.(); },
  };
};
// A linked file: drawn (and kept up to date) by the app; replaced only when the link itself changes.
const FileLinkView = FileLink.extend({ addNodeView() { return ({ node }) => {
  const dom = document.createElement('div'); dom.className = 'file-host'; dom.contentEditable = 'false';
  let shown = node.attrs.data; let ctl = R().fileLink?.(dom, shown);
  return { dom, update(n) { if (n.type !== node.type) return false; if (n.attrs.data !== shown) { ctl?.destroy?.(); shown = n.attrs.data; ctl = R().fileLink?.(dom, shown); } node = n; return true; }, stopEvent: (e) => !!e.target.closest?.('[data-fe]'), ignoreMutation: () => true, destroy() { ctl?.destroy?.(); } };
}; } });
const SheetView = Sheet.extend({ addOptions() { return { ydoc: null }; }, addNodeView() { return appBlockView('sheet', 'sheet', this.options); } });
const SlidesView = Slides.extend({ addOptions() { return { ydoc: null }; }, addNodeView() { return appBlockView('slides', 'slides', this.options); } });
const SignatureView = Signature.extend({ addNodeView() { return atomView('div', 'sig-block', (dom, n) => { dom.dataset.sig = n.attrs.id; R().signature?.(dom, n.attrs.id); }, 'sig-click'); } });

/* ---------- Find: highlights matches without changing the document ---------- */
export const findKey = new PluginKey('find');
const Find = Extension.create({
  name: 'find',
  addProseMirrorPlugins() {
    const search = (doc, query, matchCase) => {
      const out = [];
      if (!query) return out;
      const q = matchCase ? query : query.toLowerCase();
      doc.descendants((node, pos) => {
        if (!node.isTextblock) return;
        let text = '';
        const map = [];
        node.forEach((child, offset) => {
          if (child.isText) { for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i); text += child.text; }
          else { map.push(-1); text += '\u0000'; }
        });
        const hay = matchCase ? text : text.toLowerCase();
        for (let at = hay.indexOf(q); at !== -1 && out.length < 2000; at = hay.indexOf(q, at + q.length)) {
          if (map[at] < 0 || map[at + q.length - 1] < 0) continue;
          out.push({ from: map[at], to: map[at + q.length - 1] + 1 });
        }
        return false;
      });
      return out;
    };
    return [new Plugin({
      key: findKey,
      state: {
        init: () => ({ query: '', matchCase: false, current: 0, matches: [] }),
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(findKey);
          const next = meta ? { ...prev, ...meta } : prev;
          if (!meta && !tr.docChanged) return prev;
          const matches = search(state.doc, next.query, next.matchCase);
          return { ...next, matches, current: Math.min(next.current, Math.max(0, matches.length - 1)) };
        },
      },
      props: {
        decorations(state) {
          const s = findKey.getState(state);
          if (!s.matches.length) return null;
          return DecorationSet.create(state.doc, s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'find-current' : 'find-match' })));
        },
      },
    })];
  },
});

/* ---------- Keys and typing shortcuts ---------- */
const Keys = Extension.create({
  name: 'docKeys',
  addKeyboardShortcuts() {
    const indent = (d) => () => {
      const { editor } = this;
      if (editor.isActive('table')) return false;
      if (editor.isActive('codeBlock')) { if (d > 0) editor.commands.insertContent('  '); return true; }
      if (editor.isActive('listItem')) return d > 0 ? editor.commands.sinkListItem('listItem') || true : editor.commands.liftListItem('listItem') || true;
      if (editor.isActive('taskItem')) return d > 0 ? editor.commands.sinkListItem('taskItem') || true : editor.commands.liftListItem('taskItem') || true;
      const { $from } = editor.state.selection;
      const type = $from.parent.type.name;
      if (!['paragraph', 'heading', 'callout'].includes(type)) return false;
      const n = Math.min(4, Math.max(0, ($from.parent.attrs.indent || 0) + d));
      return editor.commands.updateAttributes(type, { indent: n });
    };
    return {
      Tab: indent(1),
      'Shift-Tab': indent(-1),
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      // In a code block, Enter on an empty last line leaves the block.
      Enter: () => {
        const { editor } = this;
        if (!editor.isActive('codeBlock')) return false;
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== $from.parent.content.size || !$from.parent.textContent.endsWith('\n')) return false;
        return editor.chain().command(({ tr }) => { tr.delete($from.pos - 1, $from.pos); return true; }).exitCode().run();
      },
    };
  },
  addInputRules() {
    const t = (re, type, attrs) => textblockTypeInputRule({ find: re, type: this.editor.schema.nodes[type], getAttributes: attrs });
    return [t(/^#{1,2}\s$/, 'heading', { level: 2 }), t(/^###\s$/, 'heading', { level: 3 }), t(/^>\s$/, 'callout')];
  },
});

/** A suggestion menu (slash commands, @mentions) whose UI the app provides. */
const suggestionExt = (name, char, hooks) => Extension.create({
  name,
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      char,
      pluginKey: new PluginKey(name),
      allowSpaces: false,
      startOfLine: false,
      allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
      items: ({ query }) => hooks.items(query),
      command: ({ editor, range, props }) => hooks.command(editor, range, props),
      render: () => hooks.render(),
    })];
  },
});

const COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5f3dc4'];
export const colorFor = (id = '') => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

/**
 * Create a live editor for a document.
 * hooks: { slash: {items, command, render}, mention: {...}, onFiles(files, pos) }
 */
export function createLiveEditor({ element, noteId, user, editable = true, hooks = {}, onStatus, onSynced, onUpdate, extensions: extra = [] }) {
  const ydoc = new Y.Doc();
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`;
  // The session cookie is what's checked; the token just starts the sign-in step.
  const provider = new HocuspocusProvider({
    url, name: noteId, document: ydoc, token: 'session',
    onStatus: ({ status }) => onStatus?.(status),
    onSynced: () => onSynced?.(),
    onAuthenticationFailed: () => onStatus?.('denied'),
  });
  const extensions = [
    ...baseExtensions({ mention: hooks.mention ? { suggestion: { char: '@', ...hooks.mention } } : {} }).filter((e) => !['mathBlock', 'mathInline', 'toc', 'dropdown', 'chart', 'signature', 'embed', 'sheet', 'slides'].includes(e.name)),
    MathBlockView, MathInlineView, TocView, DropdownView, ChartView, SignatureView, EmbedView, FileLinkView, SheetView.configure({ ydoc }), SlidesView.configure({ ydoc }), Find, Keys, CodeColors,
    Collaboration.configure({ document: ydoc, field: 'default' }),
    CollaborationCursor.configure({ provider, user: { name: user?.name || 'Someone', color: colorFor(user?.id) } }),
  ];
  if (hooks.slash) extensions.push(suggestionExt('slashCommands', '/', hooks.slash));
  extensions.push(...extra);
  const editor = new Editor({
    element,
    editable,
    extensions,
    editorProps: {
      attributes: { class: 'rich prose', spellcheck: 'true', 'aria-label': 'Document text', role: 'textbox', 'aria-multiline': 'true' },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files || [])];
        if (!files.length || !hooks.onFiles) return false;
        hooks.onFiles(files, view.state.selection.from);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files || [])];
        if (!files.length || !hooks.onFiles) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
        hooks.onFiles(files, pos);
        return true;
      },
    },
    onUpdate: ({ editor: ed, transaction }) => onUpdate?.(ed, transaction),
  });
  return {
    editor, provider, ydoc,
    toMarkdown: () => docToMarkdown(withBlockData(editor.getJSON(), (bid) => { const m = ydoc.getMap('blocks').get(bid); return m && m.size ? m.toJSON() : null; })), // spreadsheets and presentations: their live entries
    destroy() { editor.destroy(); provider.destroy(); ydoc.destroy(); },
  };
}

/** Read-only live connection used while reading, so changes appear as people type. */
export function watchDocument({ noteId, onChange }) {
  const ydoc = new Y.Doc();
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`;
  const provider = new HocuspocusProvider({ url, name: noteId, document: ydoc, token: 'session' });
  const frag = ydoc.getXmlFragment('default');
  let timer = null;
  const blocks = ydoc.getMap('blocks');
  const fire = () => { clearTimeout(timer); timer = setTimeout(() => { try { onChange(docToMarkdown(withBlockData(yDocToProsemirrorJSON(ydoc, 'default'), (bid) => blocks.get(bid)?.toJSON() || null))); } catch { /* ignore */ } }, 250); };
  frag.observeDeep(fire); blocks.observeDeep(fire);
  return { provider, ydoc, destroy() { clearTimeout(timer); provider.destroy(); ydoc.destroy(); } };
}
