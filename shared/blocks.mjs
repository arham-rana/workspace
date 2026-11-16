// Spreadsheets and presentations inside documents are co-edited as many small entries (one per cell, slide object,
// sheet or slide), so two people changing different parts never overwrite each other. These helpers turn a block's
// data into entries and back. Values are JSON strings; keys:
//   spreadsheet:  order, names, m:<sheetId> (sheet settings), c:<sheetId>/<cell>
//   presentation: order, deck (ratio, theme and deck-wide settings), m:<slideId> (slide settings), i:<slideId>/<itemId>
export const BLOCK_KINDS = ['sheet', 'slides'];
const j = (v) => JSON.stringify(v);
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

export function toEntries(kind, data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  if (kind === 'sheet') {
    const sheets = Array.isArray(data.sheets) ? data.sheets : [];
    out.order = j(sheets.map((s, i) => String(s.id || `sheet-${i + 1}`)));
    out.names = j(data.names || {});
    sheets.forEach((s, i) => {
      const id = String(s.id || `sheet-${i + 1}`); const { cells, ...meta } = s;
      out[`m:${id}`] = j({ ...meta, id });
      for (const [k, cell] of Object.entries(cells || {})) out[`c:${id}/${k}`] = j(cell);
    });
  } else {
    const slides = Array.isArray(data.slides) ? data.slides : [];
    const { slides: _s, ...deck } = data; void _s;
    out.deck = j(deck); out.order = j(slides.map((s, i) => String(s.id || `slide-${i + 1}`)));
    slides.forEach((s, i) => {
      const id = String(s.id || `slide-${i + 1}`); const { items, ...meta } = s;
      out[`m:${id}`] = j({ ...meta, id });
      for (const it of items || []) out[`i:${id}/${it.id}`] = j(it);
    });
  }
  return out;
}

/** Entries back to data. Parts that someone added while another reordered (missing from "order") are kept, at the end. */
export function fromEntries(kind, entries) {
  const e = entries || {};
  const order = parse(e.order) || [];
  const groups = new Map(); // id → { meta, children: [] }
  for (const [k, v] of Object.entries(e)) {
    const m = /^m:(.+)$/.exec(k); if (m) { (groups.get(m[1]) || groups.set(m[1], { meta: null, children: [] }).get(m[1])).meta = parse(v); continue; }
    const c = /^[ci]:([^/]+)\/(.+)$/.exec(k); if (c) (groups.get(c[1]) || groups.set(c[1], { meta: null, children: [] }).get(c[1])).children.push([c[2], parse(v)]);
  }
  const ids = [...order.filter((id) => groups.get(id)?.meta), ...[...groups.keys()].filter((id) => !order.includes(id) && groups.get(id).meta)];
  if (kind === 'sheet') {
    return { names: parse(e.names) || {}, sheets: ids.map((id) => ({ ...groups.get(id).meta, cells: Object.fromEntries(groups.get(id).children.filter(([, v]) => v)) })) };
  }
  return { ...(parse(e.deck) || {}), slides: ids.map((id) => ({ ...groups.get(id).meta, items: groups.get(id).children.map(([, v]) => v).filter(Boolean).sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || String(a.id).localeCompare(String(b.id))) })) }; // stacking order (entries have no order of their own)
}

/** The changes needed to go from entries `a` to entries `b`: { set: {k: v}, del: [k] }. */
export function entryChanges(a, b) {
  const set = {}; const del = [];
  for (const [k, v] of Object.entries(b)) if (a[k] !== v) set[k] = v;
  for (const k of Object.keys(a)) if (!(k in b)) del.push(k);
  return { set, del };
}

/** A document (ProseMirror JSON) with each block's latest data filled in from its entries (`get(bid)` → entries or null). */
export function withBlockData(docJson, get) {
  const walk = (n) => {
    if (!n || typeof n !== 'object') return n;
    if (BLOCK_KINDS.includes(n.type) && n.attrs?.bid) { const entries = get(n.attrs.bid); if (entries && Object.keys(entries).length) return { ...n, attrs: { ...n.attrs, data: JSON.stringify(fromEntries(n.type, entries)) } }; }
    return Array.isArray(n.content) ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(docJson);
}

/** Turn the app's own change list (see diffBooks / diffDecks) straight into entry updates, so an edit touches only the
 *  entries it changes instead of converting the whole spreadsheet or presentation. `get(key)` reads a current entry;
 *  `keys()` lists them (needed only when a whole sheet or slide is removed). */
export function sideToEntryOps(kind, side, get, keys) {
  const set = {}; const del = new Set();
  const dropGroup = (prefix) => { for (const k of keys()) if (k.startsWith(prefix)) del.add(k); };
  if (side.order) set.order = j(side.order);
  if (kind === 'sheet') {
    for (const [sid, meta] of Object.entries(side.meta || {})) { if (meta) set[`m:${sid}`] = j({ ...meta, id: sid }); else { del.add(`m:${sid}`); dropGroup(`c:${sid}/`); } }
    for (const [k, cell] of Object.entries(side.cells || {})) { if (cell) set[`c:${k}`] = j(cell); else del.add(`c:${k}`); }
    if (side.names) { const names = { ...(parse(get('names')) || {}) }; for (const [n, ref] of Object.entries(side.names)) { if (ref === null) delete names[n]; else names[n] = ref; } set.names = j(names); }
  } else {
    const deck = { ...(parse(get('deck')) || {}) };
    if (side.ratio !== undefined) deck.ratio = side.ratio; if (side.theme !== undefined) deck.theme = side.theme;
    if (side.meta) { const m = parse(side.meta) || {}; for (const [k, v] of Object.entries(m)) { if (v === null) delete deck[k]; else deck[k] = v; } }
    const dj = j(deck); if (dj !== get('deck')) set.deck = dj;
    for (const [sid, meta] of Object.entries(side.slides || {})) { if (meta) set[`m:${sid}`] = j({ ...meta, id: sid }); else { del.add(`m:${sid}`); dropGroup(`i:${sid}/`); } }
    for (const [k, it] of Object.entries(side.items || {})) { if (it) set[`i:${k}`] = j(it); else del.add(`i:${k}`); }
  }
  for (const k of Object.keys(set)) del.delete(k);
  return { set, del: [...del] };
}
