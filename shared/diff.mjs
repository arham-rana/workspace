// What changed between two versions of a file: words and paragraphs in documents, cells in spreadsheets, slides and
// objects in presentations. Pure functions (used by the version history in the browser, and by tests).

/** Longest-common-subsequence diff of two token lists → [{ op: 'same'|'add'|'del', items: [...] }]. Unchanged starts and
 *  ends are trimmed first; very large middles fall back to "all removed, all added" rather than taking too long. */
export function diffTokens(a, b, eq = (x, y) => x === y) {
  let s = 0; while (s < a.length && s < b.length && eq(a[s], b[s])) s += 1;
  let e = 0; while (e < a.length - s && e < b.length - s && eq(a[a.length - 1 - e], b[b.length - 1 - e])) e += 1;
  const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e); const mid = [];
  if (A.length * B.length > 4e6) { if (A.length) mid.push({ op: 'del', items: A }); if (B.length) mid.push({ op: 'add', items: B }); }
  else {
    const n = A.length, m = B.length; const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0; const push = (op, x) => { const last = mid[mid.length - 1]; if (last?.op === op) last.items.push(x); else mid.push({ op, items: [x] }); };
    while (i < n && j < m) { if (eq(A[i], B[j])) { push('same', A[i]); i += 1; j += 1; } else if (L[i + 1][j] >= L[i][j + 1]) { push('del', A[i]); i += 1; } else { push('add', B[j]); j += 1; } }
    while (i < n) push('del', A[i++]); while (j < m) push('add', B[j++]);
  }
  const out = []; if (s) out.push({ op: 'same', items: a.slice(0, s) }); out.push(...mid); if (e) out.push({ op: 'same', items: a.slice(a.length - e) });
  return out.filter((p) => p.items.length);
}
/** Word-level changes between two pieces of text (spaces kept with their words). */
export const diffWords = (a, b) => diffTokens(String(a).match(/\s+|[^\s]+/g) || [], String(b).match(/\s+|[^\s]+/g) || []).map((p) => ({ op: p.op, text: p.items.join('') }));

/** A document's paragraphs (blocks separated by blank lines; a fenced code block stays one block). */
export function blocksOf(md) {
  const out = []; let cur = []; let fence = false;
  for (const line of String(md || '').split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (!fence && !line.trim()) { if (cur.length) { out.push(cur.join('\n')); cur = []; } continue; }
    cur.push(line);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}
/** Paragraph changes between two documents: [{ op: 'same'|'add'|'del'|'edit', text, before? }]. A removed paragraph
 *  directly followed by an added one is shown as an edit (with word-level changes). */
export function diffDocument(beforeMd, afterMd) {
  const parts = diffTokens(blocksOf(beforeMd), blocksOf(afterMd)); const out = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k], next = parts[k + 1];
    if (p.op === 'del' && next?.op === 'add') {
      const n = Math.min(p.items.length, next.items.length);
      for (let i = 0; i < n; i++) out.push({ op: 'edit', before: p.items[i], text: next.items[i] });
      p.items.slice(n).forEach((t) => out.push({ op: 'del', text: t })); next.items.slice(n).forEach((t) => out.push({ op: 'add', text: t }));
      k += 1; continue;
    }
    p.items.forEach((t) => out.push({ op: p.op, text: t }));
  }
  return out;
}

/** Cell changes between two workbooks (E: the spreadsheet engine). → { sheets: [{ name, status, cells: [{ cell, before, after, format }] }], count } */
export function diffWorkbooks(E, beforeData, afterData) {
  const A = E.normalizeWorkbook(beforeData || {}), B = E.normalizeWorkbook(afterData || {}); const out = []; let count = 0;
  const byId = (wb) => new Map(wb.sheets.map((s) => [s.id, s]));
  const a = byId(A), b = byId(B);
  for (const sb of B.sheets) {
    const sa = a.get(sb.id);
    if (!sa) { out.push({ name: sb.name, status: 'added', cells: [] }); continue; }
    const cells = [];
    for (const k of new Set([...Object.keys(sa.cells), ...Object.keys(sb.cells)])) {
      const ca = sa.cells[k], cb = sb.cells[k]; const va = ca?.v ?? '', vb = cb?.v ?? '';
      if (va !== vb) cells.push({ cell: k, before: String(va), after: String(vb) });
      else if (JSON.stringify(ca?.s || null) !== JSON.stringify(cb?.s || null) || JSON.stringify(ca?.n || null) !== JSON.stringify(cb?.n || null)) cells.push({ cell: k, before: String(va), after: String(vb), format: true });
    }
    const order = (k) => { const p = E.parseKey(k); return p ? p.row * 10000 + p.col : 0; };
    cells.sort((x, y) => order(x.cell) - order(y.cell)); count += cells.length;
    if (cells.length || sa.name !== sb.name) out.push({ name: sb.name, status: sa.name !== sb.name ? `renamed from “${sa.name}”` : 'changed', cells });
  }
  for (const sa of A.sheets) if (!b.has(sa.id)) out.push({ name: sa.name, status: 'removed', cells: [] });
  return { sheets: out, count };
}

/** Slide and object changes between two presentations (S: the presentation engine, for its text helper). */
export function diffDecks(S, beforeData, afterData) {
  const A = S.normalizeDeck(beforeData || {}), B = S.normalizeDeck(afterData || {});
  const text = (it) => (it.html ? S.plainText(it.html).trim() : it.t === 'wordart' ? it.text || '' : '');
  const kind = (it) => ({ text: 'Text box', shape: 'Shape', image: 'Picture', chart: 'Chart', line: 'Line', table: 'Table', video: 'Video', wordart: 'Word art', file: 'Linked file' }[it.t] || 'Object');
  const before = new Map(A.slides.map((s, i) => [s.id, { s, i }])); const after = new Set(B.slides.map((s) => s.id)); const slides = [];
  B.slides.forEach((s, i) => {
    const old = before.get(s.id);
    if (!old) { slides.push({ n: i + 1, id: s.id, status: 'added', changes: [] }); return; }
    const changes = []; const oi = new Map(old.s.items.map((it) => [it.id, it]));
    for (const it of s.items) {
      const was = oi.get(it.id);
      if (!was) changes.push({ op: 'add', what: kind(it), text: text(it) });
      else if (JSON.stringify(was) !== JSON.stringify(it)) {
        const t0 = text(was), t1 = text(it);
        changes.push(t0 !== t1 ? { op: 'edit', what: kind(it), before: t0, text: t1 } : { op: 'edit', what: kind(it), text: t1, moved: true });
      }
    }
    for (const it of old.s.items) if (!s.items.some((x) => x.id === it.id)) changes.push({ op: 'del', what: kind(it), text: text(it) });
    const { items: _a, ...metaA } = old.s; const { items: _b, ...metaB } = s; void _a; void _b;
    if (JSON.stringify(metaA) !== JSON.stringify(metaB)) changes.push({ op: 'edit', what: 'Slide settings (background, layout, notes, transition)', text: '' });
    if (changes.length || old.i !== i) slides.push({ n: i + 1, id: s.id, status: changes.length ? 'changed' : 'moved', from: old.i + 1, changes });
  });
  A.slides.forEach((s, i) => { if (!after.has(s.id)) slides.push({ n: i + 1, id: s.id, status: 'removed', changes: [], slide: s }); });
  return { slides, deckChanged: JSON.stringify({ ...A, slides: 0 }) !== JSON.stringify({ ...B, slides: 0 }) };
}
