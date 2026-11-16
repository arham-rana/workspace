// Excel-style dialogs for the spreadsheet: Format Cells, Paste Special, Insert/Delete Cells, Sort, Remove Duplicates,
// Text to Columns, Data Validation, Define Name / Name Manager, Hyperlink, Cell Styles and Tab Color.
// `ctx` gives access to the open spreadsheet (see sheet-app.js).
import { esc } from './util.js';
import { toast, openModal } from './ui.js';
import { E } from './sheet-core.js';

const PALETTE = ['#000000', '#ffffff', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#c00000', '#ff0000', '#ffc7ce', '#ffeb9c', '#c6efce', '#ddebf7', '#fce4d6', '#e2efda', '#d9e1f2', '#7030a0'];
export const CELL_STYLES = {
  'Good, Bad and Neutral': { Normal: {}, Bad: { bg: '#ffc7ce', fg: '#9c0006' }, Good: { bg: '#c6efce', fg: '#006100' }, Neutral: { bg: '#ffeb9c', fg: '#9c5700' } },
  'Data and Model': { Calculation: { bg: '#f2f2f2', fg: '#fa7d00', b: 1, bd: { t: 1, r: 1, b: 1, l: 1 }, bc: '#7f7f7f' }, 'Check Cell': { bg: '#a5a5a5', fg: '#ffffff', b: 1, bd: { t: 3, r: 3, b: 3, l: 3 }, bc: '#3f3f3f' }, 'Explanatory Text': { fg: '#7f7f7f', i: 1 }, Input: { bg: '#ffcc99', fg: '#3f3f76', bd: { t: 1, r: 1, b: 1, l: 1 }, bc: '#7f7f7f' }, 'Linked Cell': { fg: '#fa7d00', bd: { b: 3 }, bc: '#ff8001' }, Note: { bg: '#ffffcc', bd: { t: 1, r: 1, b: 1, l: 1 }, bc: '#b2b2b2' }, Output: { bg: '#f2f2f2', fg: '#3f3f3f', b: 1, bd: { t: 1, r: 1, b: 1, l: 1 }, bc: '#3f3f3f' }, 'Warning Text': { fg: '#ff0000' } },
  'Titles and Headings': { Title: { fz: 18, fg: '#44546a' }, 'Heading 1': { fz: 15, b: 1, fg: '#44546a', bd: { b: 6 }, bc: '#4472c4' }, 'Heading 2': { fz: 13, b: 1, fg: '#44546a', bd: { b: 6 }, bc: '#a2b8e1' }, 'Heading 3': { b: 1, fg: '#44546a', bd: { b: 2 }, bc: '#8ea9db' }, 'Heading 4': { b: 1, fg: '#44546a' }, Total: { b: 1, bd: { t: 1, b: 3 }, bc: '#4472c4' } },
  'Themed Cell Styles': { '20% - Accent1': { bg: '#d9e1f2' }, '20% - Accent2': { bg: '#fce4d6' }, '20% - Accent6': { bg: '#e2efda' }, '40% - Accent1': { bg: '#b4c6e7' }, '60% - Accent1': { bg: '#8ea9db', fg: '#ffffff' }, Accent1: { bg: '#4472c4', fg: '#ffffff' }, Accent2: { bg: '#ed7d31', fg: '#ffffff' }, Accent6: { bg: '#70ad47', fg: '#ffffff' } },
  'Number Format': { Comma: { nf: '#,##0.00' }, 'Comma [0]': { nf: '#,##0' }, Currency: { nf: '$#,##0.00' }, 'Currency [0]': { nf: '$#,##0' }, Percent: { nf: '0%' } },
};

const modal = (title, body, { ok = 'OK', wide = false, onMount, onOk }) => new Promise((resolve) => {
  let result = null;
  openModal({
    size: wide ? 'lg' : 'md', // wide dialogs (Format Cells, Sort …) get the wide size so nothing is cut off
    title, body: `<form class="form xl-dlg${wide ? ' wide' : ''}" id="xl-dlg" novalidate>${body}</form>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="xl-dlg">${ok}</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('#xl-dlg');
      onMount?.(f, el);
      f.addEventListener('submit', async (e) => { e.preventDefault(); const r = await onOk(f, el); if (r === false) return; result = r ?? true; close(); }); // waits for checks such as password hashing
    },
    onClose: () => setTimeout(() => resolve(result), 30),
  });
});
const tabs = (names) => `<div class="xl-dtabs" role="tablist">${names.map((n, i) => `<button type="button" class="xl-dtab ${i === 0 ? 'on' : ''}" data-dtab="${i}" role="tab">${n}</button>`).join('')}</div>`;
const wireTabs = (f) => f.querySelector('.xl-dtabs')?.addEventListener('click', (e) => { const t = e.target.closest('[data-dtab]'); if (!t) return; f.querySelectorAll('.xl-dtab').forEach((x) => x.classList.toggle('on', x === t)); f.querySelectorAll('[data-dpanel]').forEach((p) => { p.hidden = p.dataset.dpanel !== t.dataset.dtab; }); });

export function createDialogs(ctx) {
  /* ---------- Format Cells (Ctrl+1) ---------- */
  async function formatCells(startTab = 0) {
    const st = { ...(E.styleAt(ctx.sheet(), ctx.active().r, ctx.active().c) || {}) };
    const sample = ctx.shown()[E.cellKey(ctx.active().r, ctx.active().c)]?.value;
    const sampleNum = typeof sample === 'number' ? sample : 1234.5;
    const cats = ['General', 'Number', 'Currency', 'Accounting', 'Date', 'Time', 'Percentage', 'Fraction', 'Scientific', 'Text', 'Custom'];
    const curCat = st.nf ? (/[ymd]/i.test(st.nf.replace(/"[^"]*"/g, '')) && !/^[#0]/.test(st.nf) ? 'Date' : /h|s/i.test(st.nf.replace(/"[^"]*"/g, '')) ? 'Time' : /\?\/|\/\?/.test(st.nf) ? 'Fraction' : /E\+/i.test(st.nf) ? 'Scientific' : /\*/.test(st.nf) ? 'Accounting' : /%/.test(st.nf) ? 'Percentage' : /\$|€|£/.test(st.nf) ? 'Currency' : 'Custom') : { number: 'Number', currency: 'Currency', percent: 'Percentage', date: 'Date', time: 'Time', text: 'Text' }[st.f] || 'General';
    const bdStyles = [[1, 'Thin'], [2, 'Medium'], [6, 'Thick'], [3, 'Double'], [4, 'Dashed'], [5, 'Dotted']];
    const body = `${tabs(['Number', 'Alignment', 'Font', 'Border', 'Fill', 'Protection'])}
      <div data-dpanel="0"><div class="xl-fc-num"><select name="cat" size="11" aria-label="Category">${cats.map((c) => `<option ${c === curCat ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <div class="xl-fc-opts"><div class="xl-fc-sample"><span>Sample</span><b class="xl-sample"></b></div>
          <label class="field xl-o-dp"><span>Decimal places</span><input type="number" name="dp" min="0" max="10" value="${Number.isInteger(st.dp) ? st.dp : 2}"></label>
          <label class="xl-check xl-o-sep"><input type="checkbox" name="sep" ${!st.nf || /,/.test(st.nf) ? 'checked' : ''}> Use 1000 separator (,)</label>
          <label class="field xl-o-sym"><span>Symbol</span><select name="sym"><option value="$">$</option><option value="€">€</option><option value="£">£</option><option value="¥">¥</option><option value="">None</option></select></label>
          <label class="xl-check xl-o-neg"><input type="checkbox" name="negred" ${/\[Red\]/i.test(st.nf || '') ? 'checked' : ''}> Show negative numbers in red</label>
          <label class="field xl-o-type"><span>Type</span><select name="type"></select></label>
          <label class="field xl-o-code"><span>Type (format code)</span><input name="code" value="${esc(st.nf || 'General')}" spellcheck="false"></label>
          <p class="xl-fc-help"></p></div></div></div>
      <div data-dpanel="1" hidden><div class="xl-grid2">
        <label class="field"><span>Horizontal</span><select name="al"><option value="">General</option><option value="left">Left (Indent)</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <label class="field"><span>Indent</span><input type="number" name="ind" min="0" max="15" value="${st.ind || 0}"></label>
        <label class="field"><span>Vertical</span><select name="va"><option value="bottom">Bottom</option><option value="middle">Center</option><option value="top">Top</option></select></label>
        <label class="field"><span>Orientation (degrees)</span><input type="number" name="rot" min="-90" max="90" value="${st.rot && st.rot !== 255 ? st.rot : 0}"></label>
        <label class="xl-check"><input type="checkbox" name="vert" ${st.rot === 255 ? 'checked' : ''}> Vertical text</label>
        <label class="xl-check"><input type="checkbox" name="wr" ${st.wr ? 'checked' : ''}> Wrap text</label></div></div>
      <div data-dpanel="2" hidden><div class="xl-grid2">
        <label class="field"><span>Font</span><select name="ff">${['', 'Aptos', 'Calibri', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS'].map((f) => `<option value="${esc(f)}" ${(st.ff || '') === f ? 'selected' : ''}>${f || 'Default (Aptos)'}</option>`).join('')}</select></label>
        <label class="field"><span>Size</span><input type="number" name="fz" min="6" max="72" value="${st.fz || 11}"></label>
        <label class="field"><span>Font style</span><select name="fs"><option value="">Regular</option><option value="i" ${st.i && !st.b ? 'selected' : ''}>Italic</option><option value="b" ${st.b && !st.i ? 'selected' : ''}>Bold</option><option value="bi" ${st.b && st.i ? 'selected' : ''}>Bold Italic</option></select></label>
        <label class="field"><span>Color</span><input type="color" name="fg" value="${st.fg || '#000000'}"></label>
        <label class="xl-check"><input type="checkbox" name="u" ${st.u ? 'checked' : ''}> Underline</label>
        <label class="xl-check"><input type="checkbox" name="st" ${st.st ? 'checked' : ''}> Strikethrough</label>
        <label class="xl-check"><input type="checkbox" name="sup" ${st.vs === 'sup' ? 'checked' : ''}> Superscript</label>
        <label class="xl-check"><input type="checkbox" name="sub" ${st.vs === 'sub' ? 'checked' : ''}> Subscript</label></div>
        <div class="xl-fc-sample"><span>Preview</span><b class="xl-fpreview">AaBbCcYyZz</b></div></div>
      <div data-dpanel="3" hidden><div class="xl-fc-border">
        <div><div class="menu-label">Line style</div>${bdStyles.map(([v, l]) => `<label class="xl-radio"><input type="radio" name="bstyle" value="${v}" ${v === 1 ? 'checked' : ''}> <i class="xl-bline b${v}"></i> ${l}</label>`).join('')}
          <label class="field"><span>Color</span><input type="color" name="bc" value="${st.bc || '#000000'}"></label></div>
        <div><div class="menu-label">Presets</div><div class="xl-bpresets"><button type="button" class="btn btn-plain btn-sm" data-bp="none">None</button><button type="button" class="btn btn-plain btn-sm" data-bp="outline">Outline</button><button type="button" class="btn btn-plain btn-sm" data-bp="all">All</button></div>
          <div class="menu-label">Border</div><div class="xl-bedges">${[['t', 'Top'], ['b', 'Bottom'], ['l', 'Left'], ['r', 'Right'], ['ih', 'Inside horizontal'], ['iv', 'Inside vertical']].map(([k, l]) => `<label class="xl-check"><input type="checkbox" name="e_${k}"> ${l}</label>`).join('')}</div></div></div></div>
      <div data-dpanel="4" hidden><div class="menu-label">Background color</div><div class="xl-swatches">${['', ...PALETTE].map((c) => `<button type="button" class="xl-sw ${c === (st.bg || '') ? 'on' : ''}" data-bg="${c}" style="background:${c || 'transparent'}" aria-label="${c || 'No color'}">${c ? '' : '∅'}</button>`).join('')}</div><label class="field"><span>More colors</span><input type="color" name="bgc" value="${st.bg || '#ffffff'}"></label></div>
      <div data-dpanel="5" hidden><label class="xl-check"><input type="checkbox" name="locked" ${st.unl ? '' : 'checked'}> Locked</label><label class="xl-check"><input type="checkbox" name="hiddenf" ${st.hf ? 'checked' : ''}> Hidden</label><p class="muted">Locking cells or hiding formulas has no effect until you protect the worksheet (Review tab → Protect Sheet).</p></div>`;
    return modal('Format Cells', body, {
      wide: true,
      onMount: (f) => {
        wireTabs(f); if (startTab) f.querySelector(`[data-dtab="${startTab}"]`).click();
        f.elements.al.value = st.al || ''; f.elements.va.value = st.va || 'bottom';
        const sym = /([$€£¥])/.exec(st.nf || '')?.[1]; if (sym) f.elements.sym.value = sym;
        let bg = st.bg || '';
        f.querySelector('.xl-swatches').addEventListener('click', (e) => { const b = e.target.closest('[data-bg]'); if (!b) return; bg = b.dataset.bg; f.querySelectorAll('.xl-sw').forEach((x) => x.classList.toggle('on', x === b)); });
        f.elements.bgc.addEventListener('input', () => { bg = f.elements.bgc.value; f.querySelectorAll('.xl-sw').forEach((x) => x.classList.remove('on')); });
        f._bg = () => bg;
        let preset = null;
        f.querySelector('.xl-bpresets').addEventListener('click', (e) => { const b = e.target.closest('[data-bp]'); if (!b) return; preset = b.dataset.bp; const on = { none: [], outline: ['t', 'b', 'l', 'r'], all: ['t', 'b', 'l', 'r', 'ih', 'iv'] }[preset]; for (const k of ['t', 'b', 'l', 'r', 'ih', 'iv']) f.elements[`e_${k}`].checked = on.includes(k); });
        f._preset = () => preset;
        const code = () => {
          const cat = f.elements.cat.value, dp = Math.max(0, Math.min(10, Number(f.elements.dp.value) || 0)), s = f.elements.sym.value, red = f.elements.negred.checked, sep = f.elements.sep.checked;
          switch (cat) {
            case 'General': return 'General';
            case 'Number': return E.CATEGORY_CODES.number(dp, sep, red);
            case 'Currency': return E.CATEGORY_CODES.currency(dp, s, red);
            case 'Accounting': return E.CATEGORY_CODES.accounting(dp, s);
            case 'Percentage': return E.CATEGORY_CODES.percent(dp);
            case 'Scientific': return E.CATEGORY_CODES.scientific(dp);
            case 'Date': case 'Time': case 'Fraction': return f.elements.type.value;
            case 'Text': return '@';
            default: return f.elements.code.value || 'General';
          }
        };
        const show = (on, sel) => { f.querySelector(sel).hidden = !on; };
        const sync = (fromCat = false) => {
          const cat = f.elements.cat.value;
          show(['Number', 'Currency', 'Accounting', 'Percentage', 'Scientific'].includes(cat), '.xl-o-dp');
          show(cat === 'Number', '.xl-o-sep'); show(['Currency', 'Accounting'].includes(cat), '.xl-o-sym'); show(['Number', 'Currency'].includes(cat), '.xl-o-neg');
          show(['Date', 'Time', 'Fraction'].includes(cat), '.xl-o-type'); show(cat === 'Custom', '.xl-o-code');
          if (fromCat && ['Date', 'Time', 'Fraction'].includes(cat)) f.elements.type.innerHTML = { Date: E.DATE_CODES, Time: E.TIME_CODES, Fraction: E.FRACTION_CODES }[cat].map((c) => `<option value="${esc(c)}" ${c === st.nf ? 'selected' : ''}>${esc(E.formatCode(cat === 'Fraction' ? 2.375 : cat === 'Time' ? 0.6458 : 46315.6458, c).text)}</option>`).join('');
          if (fromCat && cat === 'Custom' && f.elements.code.value === 'General' && st.nf) f.elements.code.value = st.nf;
          const c = code(); const v = cat === 'Text' ? String(sample ?? 'text') : ['Date'].includes(cat) && typeof sample !== 'number' ? 46315 : ['Time'].includes(cat) && typeof sample !== 'number' ? 0.6458 : sampleNum;
          const out = c === 'General' ? { text: E.formatValue(v) } : E.formatCode(v, c);
          const el = f.querySelector('.xl-sample'); el.textContent = out.text; el.style.color = out.color || '';
          f.querySelector('.xl-fc-help').textContent = { General: 'General format cells have no specific number format.', Number: 'Number is used for general display of numbers.', Currency: 'Currency formats are used for general monetary values.', Accounting: 'Accounting formats line up the currency symbols and decimal points in a column.', Date: 'Date formats display date serial numbers as dates.', Time: 'Time formats display serial numbers as times.', Percentage: 'Percentage formats multiply the cell value by 100 and display the result with a percent symbol.', Fraction: 'Fraction formats display numbers as fractions.', Scientific: 'Scientific formats display numbers in exponential notation.', Text: 'Text format cells are treated as text even when a number is in the cell.', Custom: 'Type a number format code, for example #,##0.00;[Red](#,##0.00) or dddd, mmmm d, yyyy.' }[cat];
          f._code = c;
        };
        f.elements.cat.addEventListener('change', () => sync(true));
        f.addEventListener('input', (e) => { if (e.target.name !== 'cat') sync(); const p = f.querySelector('.xl-fpreview'); p.style.cssText = `font-family:${f.elements.ff.value ? `'${f.elements.ff.value}',` : ''}sans-serif;font-size:${Number(f.elements.fz.value) * 4 / 3}px;font-weight:${f.elements.fs.value.includes('b') ? 700 : 400};font-style:${f.elements.fs.value.includes('i') ? 'italic' : 'normal'};color:${f.elements.fg.value};text-decoration:${[f.elements.u.checked && 'underline', f.elements.st.checked && 'line-through'].filter(Boolean).join(' ') || 'none'}`; });
        f.addEventListener('change', (e) => { if (e.target.name === 'sup' && e.target.checked) f.elements.sub.checked = false; if (e.target.name === 'sub' && e.target.checked) f.elements.sup.checked = false; });
        sync(true); f.dispatchEvent(new Event('input'));
      },
      onOk: (f) => {
        const c = f._code; const bstyle = Number(f.elements.bstyle.value); const edges = Object.fromEntries(['t', 'b', 'l', 'r', 'ih', 'iv'].map((k) => [k, f.elements[`e_${k}`].checked])); const anyEdge = Object.values(edges).some(Boolean) || f._preset() === 'none';
        const rot = f.elements.vert.checked ? 255 : Number(f.elements.rot.value) || 0;
        const fs = f.elements.fs.value; const bg = f._bg();
        ctx.styleSel((s, r, cIdx, g) => {
          const n = { ...s, nf: c === 'General' ? undefined : c, f: c === 'General' ? undefined : s.f === 'text' && c !== '@' ? undefined : s.f, dp: c === 'General' ? undefined : s.dp,
            al: f.elements.al.value || undefined, ind: Number(f.elements.ind.value) || undefined, va: f.elements.va.value === 'bottom' ? undefined : f.elements.va.value, rot: rot || undefined, wr: f.elements.wr.checked ? 1 : undefined,
            ff: f.elements.ff.value || undefined, fz: Number(f.elements.fz.value) === 11 ? undefined : Number(f.elements.fz.value), b: fs.includes('b') ? 1 : undefined, i: fs.includes('i') ? 1 : undefined,
            fg: f.elements.fg.value === '#000000' ? undefined : f.elements.fg.value, u: f.elements.u.checked ? 1 : undefined, st: f.elements.st.checked ? 1 : undefined, vs: f.elements.sup.checked ? 'sup' : f.elements.sub.checked ? 'sub' : undefined, bg: bg || undefined,
            unl: f.elements.locked.checked ? undefined : 1, hf: f.elements.hiddenf.checked ? 1 : undefined };
          if (anyEdge) {
            const whole = r === -1 || cIdx === -1;
            const top = whole || r === g.r1, bot = whole || r === g.r2, lft = whole || cIdx === g.c1, rgt = whole || cIdx === g.c2;
            const bd = {}; if (edges.t && top) bd.t = bstyle; if (edges.b && bot) bd.b = bstyle; if (edges.l && lft) bd.l = bstyle; if (edges.r && rgt) bd.r = bstyle;
            if (edges.ih) { if (!top) bd.t = bstyle; if (!bot) bd.b = bstyle; } if (edges.iv) { if (!lft) bd.l = bstyle; if (!rgt) bd.r = bstyle; }
            n.bd = Object.keys(bd).length ? bd : undefined; n.bc = f.elements.bc.value === '#000000' ? undefined : f.elements.bc.value;
          }
          return n;
        });
        return true;
      },
    });
  }

  /* ---------- Paste Special (Ctrl+Alt+V) ---------- */
  function pasteSpecial() {
    if (!ctx.clip()) { toast('Copy cells in this spreadsheet first'); return null; }
    return modal('Paste Special', `<div class="xl-grid2"><fieldset><legend>Paste</legend>${[['all', 'All'], ['formulas', 'Formulas'], ['values', 'Values'], ['formats', 'Formats'], ['notes', 'Notes'], ['validation', 'Validation'], ['noborders', 'All except borders'], ['widths', 'Column widths'], ['formulasnum', 'Formulas and number formats'], ['valuesnum', 'Values and number formats']].map(([v, l], i) => `<label class="xl-radio"><input type="radio" name="what" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>
      <fieldset><legend>Operation</legend>${[['', 'None'], ['add', 'Add'], ['sub', 'Subtract'], ['mul', 'Multiply'], ['div', 'Divide']].map(([v, l], i) => `<label class="xl-radio"><input type="radio" name="op" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}
      <label class="xl-check"><input type="checkbox" name="skip"> Skip blanks</label><label class="xl-check"><input type="checkbox" name="tr"> Transpose</label></fieldset></div>`, {
      onOk: (f) => { ctx.pasteSpecial({ what: f.elements.what.value, op: f.elements.op.value, skip: f.elements.skip.checked, transpose: f.elements.tr.checked }); return true; },
    });
  }

  /* ---------- Insert / Delete cells ---------- */
  async function insertCells(isDelete = false) {
    const opts = isDelete ? [['up', 'Shift cells up'], ['left', 'Shift cells left'], ['row', 'Entire row'], ['col', 'Entire column']] : [['right', 'Shift cells right'], ['down', 'Shift cells down'], ['row', 'Entire row'], ['col', 'Entire column']];
    const v = await modal(isDelete ? 'Delete' : 'Insert', opts.map(([k, l], i) => `<label class="xl-radio"><input type="radio" name="o" value="${k}" ${i === (isDelete ? 0 : 1) ? 'checked' : ''}> ${l}</label>`).join(''), { onOk: (f) => f.elements.o.value });
    if (v) ctx.insertDelete(v, isDelete);
  }

  /* ---------- Sort (several levels) ---------- */
  function sortDialog() {
    const g = ctx.sortTarget(); const sh = ctx.sheet();
    const headerGuess = (() => { for (let c = g.c1; c <= g.c2; c++) { const v = ctx.shown()[E.cellKey(g.r1, c)]; const below = ctx.shown()[E.cellKey(g.r1 + 1, c)]; if (v && !v.number && below?.number) return true; } return false; })();
    const colLabel = (c, header) => (header ? (ctx.shown()[E.cellKey(g.r1, c)]?.text || `Column ${E.colName(c)}`) : `Column ${E.colName(c)}`);
    const levelHtml = (header, col = g.c1, dir = 'asc') => `<div class="xl-sort-level"><span>Sort by</span><select name="col">${Array.from({ length: g.c2 - g.c1 + 1 }, (_, i) => g.c1 + i).map((c) => `<option value="${c}" ${c === col ? 'selected' : ''}>${esc(colLabel(c, header))}</option>`).join('')}</select><select name="dir"><option value="asc" ${dir === 'asc' ? 'selected' : ''}>A to Z / Smallest to Largest</option><option value="desc" ${dir === 'desc' ? 'selected' : ''}>Z to A / Largest to Smallest</option></select><button type="button" class="tb-btn" data-dellevel aria-label="Delete level">✕</button></div>`;
    void sh;
    return modal('Sort', `<p class="muted">Range ${E.rangeRef(g)}</p><div class="xl-sort-tools"><button type="button" class="btn btn-plain btn-sm" data-addlevel>+ Add Level</button><label class="xl-check"><input type="checkbox" name="header" ${headerGuess ? 'checked' : ''}> My data has headers</label></div><div class="xl-sort-levels">${levelHtml(headerGuess, ctx.active().c >= g.c1 && ctx.active().c <= g.c2 ? ctx.active().c : g.c1)}</div>`, {
      wide: true,
      onMount: (f) => {
        const levels = f.querySelector('.xl-sort-levels');
        f.addEventListener('click', (e) => { if (e.target.closest('[data-addlevel]')) levels.insertAdjacentHTML('beforeend', levelHtml(f.elements.header.checked)); const d = e.target.closest('[data-dellevel]'); if (d && levels.children.length > 1) d.parentElement.remove(); });
        f.elements.header.addEventListener('change', () => { const vals = [...levels.children].map((l) => [Number(l.querySelector('[name=col]').value), l.querySelector('[name=dir]').value]); levels.innerHTML = vals.map(([c, d]) => levelHtml(f.elements.header.checked, c, d)).join(''); });
      },
      onOk: (f) => { const keys = [...f.querySelectorAll('.xl-sort-level')].map((l) => ({ col: Number(l.querySelector('[name=col]').value), dir: l.querySelector('[name=dir]').value })); ctx.sortRange(g, keys, f.elements.header.checked); return true; },
    });
  }

  /* ---------- Remove Duplicates ---------- */
  function removeDuplicates() {
    const g = ctx.sortTarget();
    const header = (() => { for (let c = g.c1; c <= g.c2; c++) { const v = ctx.shown()[E.cellKey(g.r1, c)]; if (v && !v.number) return true; } return false; })();
    return modal('Remove Duplicates', `<p>To delete duplicate values, select one or more columns that contain duplicates.</p><label class="xl-check"><input type="checkbox" name="header" ${header ? 'checked' : ''}> My data has headers</label><div class="xl-cols">${Array.from({ length: g.c2 - g.c1 + 1 }, (_, i) => g.c1 + i).map((c) => `<label class="xl-check"><input type="checkbox" name="c" value="${c}" checked> ${esc(header ? (ctx.shown()[E.cellKey(g.r1, c)]?.text || `Column ${E.colName(c)}`) : `Column ${E.colName(c)}`)}</label>`).join('')}</div>`, {
      onOk: (f) => { const cols = [...f.querySelectorAll('[name=c]:checked')].map((x) => Number(x.value)); if (!cols.length) { toast('Select at least one column', { tone: 'error' }); return false; } ctx.removeDuplicates(g, cols, f.elements.header.checked); return true; },
    });
  }

  /* ---------- Text to Columns ---------- */
  function textToColumns() {
    const g = ctx.range();
    if (g.c1 !== g.c2) { toast('Text to Columns works on one column at a time', { tone: 'error' }); return null; }
    const first = String(ctx.sheet().cells[E.cellKey(g.r1, g.c1)]?.v ?? '');
    return modal('Convert Text to Columns', `<p>Choose the delimiters your data has.</p><div class="xl-cols">${[['tab', 'Tab'], ['semicolon', 'Semicolon'], ['comma', 'Comma'], ['space', 'Space']].map(([v, l]) => `<label class="xl-check"><input type="checkbox" name="d" value="${v}" ${(v === 'comma' && first.includes(',')) || (v === 'tab' && first.includes('\t')) || (v === 'semicolon' && first.includes(';')) ? 'checked' : ''}> ${l}</label>`).join('')}<label class="xl-check">Other <input name="other" maxlength="1" size="2"></label></div>
      <label class="xl-check"><input type="checkbox" name="merge"> Treat consecutive delimiters as one</label><label class="field"><span>Destination</span><input name="dest" value="${E.cellKey(g.r1, g.c1)}"></label><div class="menu-label">Preview</div><pre class="xl-ttc-prev"></pre>`, {
      onMount: (f) => { const prev = () => { const delims = [...f.querySelectorAll('[name=d]:checked')].map((x) => x.value); const t = E.textToColumns({ cells: { A1: { v: first } } }, { r1: 0, c1: 0, r2: 0, c2: 0 }, { delims, other: f.elements.other.value, merge: f.elements.merge.checked }); f.querySelector('.xl-ttc-prev').textContent = Object.keys(t.sheet.cells).sort((a, b) => E.colIndex(a.replace(/\d+/, '')) - E.colIndex(b.replace(/\d+/, ''))).map((k) => t.sheet.cells[k].v).join(' │ '); }; f.addEventListener('input', prev); prev(); },
      onOk: (f) => { const d = E.parseKey(f.elements.dest.value.trim().toUpperCase().replace(/\$/g, '')); if (!d) { toast('Type a destination cell such as B1', { tone: 'error' }); return false; } ctx.textToColumns(g, { delims: [...f.querySelectorAll('[name=d]:checked')].map((x) => x.value), other: f.elements.other.value, merge: f.elements.merge.checked, dest: { r: d.row, c: d.col } }); return true; },
    });
  }

  /* ---------- Data Validation ---------- */
  function validation() {
    const g = ctx.range(); const cur = E.dvRuleAt(ctx.sheet(), ctx.active().r, ctx.active().c) || { type: 'any', op: 'between', v1: '', v2: '', blank: true, drop: true, err: { style: 'stop', title: '', text: '' } };
    const ops = [['between', 'between'], ['notbetween', 'not between'], ['eq', 'equal to'], ['ne', 'not equal to'], ['gt', 'greater than'], ['lt', 'less than'], ['ge', 'greater than or equal to'], ['le', 'less than or equal to']];
    return modal('Data Validation', `${tabs(['Settings', 'Input Message', 'Error Alert'])}
      <div data-dpanel="0"><label class="field"><span>Allow</span><select name="type"><option value="any">Any value</option><option value="whole">Whole number</option><option value="decimal">Decimal</option><option value="list">List</option><option value="date">Date</option><option value="textlen">Text length</option></select></label>
        <label class="field xl-v-op"><span>Data</span><select name="op">${ops.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="field xl-v-1"><span class="xl-v-1l">Minimum</span><input name="v1" value="${esc(cur.v1)}"></label><label class="field xl-v-2"><span>Maximum</span><input name="v2" value="${esc(cur.v2)}"></label>
        <label class="xl-check"><input type="checkbox" name="blank" ${cur.blank !== false ? 'checked' : ''}> Ignore blank</label><label class="xl-check xl-v-drop"><input type="checkbox" name="drop" ${cur.drop !== false ? 'checked' : ''}> In-cell dropdown</label>
        <p class="muted xl-v-help">For a list, type items separated by commas (Yes,No,Maybe) or a range such as =$F$1:$F$5.</p></div>
      <div data-dpanel="1" hidden><label class="xl-check"><input type="checkbox" name="showmsg" ${cur.msg ? 'checked' : ''}> Show input message when cell is selected</label><label class="field"><span>Title</span><input name="mt" value="${esc(cur.msg?.title || '')}"></label><label class="field"><span>Input message</span><textarea name="mx" rows="3">${esc(cur.msg?.text || '')}</textarea></label></div>
      <div data-dpanel="2" hidden><label class="field"><span>Style</span><select name="es"><option value="stop">Stop</option><option value="warning">Warning</option><option value="info">Information</option></select></label><label class="field"><span>Title</span><input name="et" value="${esc(cur.err?.title || '')}"></label><label class="field"><span>Error message</span><textarea name="ex" rows="3">${esc(cur.err?.text || '')}</textarea></label></div>
      <p class="muted">Applies to ${esc(E.rangeRef(g))}. <button type="button" class="btn btn-plain btn-sm" data-clearall>Clear All</button></p>`, {
      onMount: (f) => {
        wireTabs(f); f.elements.type.value = cur.type; f.elements.op.value = cur.op || 'between'; f.elements.es.value = cur.err?.style || 'stop';
        const sync = () => { const t = f.elements.type.value; const list = t === 'list'; f.querySelector('.xl-v-op').hidden = list || t === 'any'; f.querySelector('.xl-v-1').hidden = t === 'any'; f.querySelector('.xl-v-2').hidden = list || t === 'any' || !['between', 'notbetween'].includes(f.elements.op.value); f.querySelector('.xl-v-drop').hidden = !list; f.querySelector('.xl-v-help').hidden = !list; f.querySelector('.xl-v-1l').textContent = list ? 'Source' : ['between', 'notbetween'].includes(f.elements.op.value) ? 'Minimum' : 'Value'; };
        f.addEventListener('change', sync); sync();
        f.querySelector('[data-clearall]').addEventListener('click', () => { f.elements.type.value = 'any'; sync(); });
      },
      onOk: (f) => {
        const t = f.elements.type.value;
        const rule = t === 'any' ? null : { range: E.rangeRef(g), type: t, op: f.elements.op.value, v1: f.elements.v1.value.trim(), v2: f.elements.v2.value.trim(), blank: f.elements.blank.checked, drop: f.elements.drop.checked, ...(f.elements.showmsg.checked && (f.elements.mt.value || f.elements.mx.value) ? { msg: { title: f.elements.mt.value, text: f.elements.mx.value } } : {}), err: { style: f.elements.es.value, title: f.elements.et.value, text: f.elements.ex.value } };
        if (rule && !rule.v1) { toast(t === 'list' ? 'Type the list items or a range' : 'Type a value', { tone: 'error' }); return false; }
        ctx.setValidation(g, rule); return true;
      },
    });
  }

  /* ---------- Names ---------- */
  function defineName(prefill = '') {
    const g = ctx.range(); const sh = ctx.sheet(); const quote = (n) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n}'`);
    const refers = `${quote(sh.name)}!${E.rangeRef(g).split(':').map((p) => p.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')).join(':')}`;
    return modal('New Name', `<label class="field"><span>Name</span><input name="n" value="${esc(prefill)}" autocomplete="off"></label><label class="field"><span>Refers to</span><input name="ref" value="${esc(refers)}" spellcheck="false"></label>`, {
      onMount: (f) => setTimeout(() => f.elements.n.focus(), 40),
      onOk: (f) => { const n = f.elements.n.value.trim(); if (!E.isValidName(n)) { toast('That name isn’t valid. Use letters, numbers and _ (no spaces), and don’t make it look like a cell such as A1.', { tone: 'error' }); return false; } if (Object.keys(ctx.wb().names || {}).some((k) => k.toLowerCase() === n.toLowerCase())) { toast('That name already exists', { tone: 'error' }); return false; } ctx.setName(n, f.elements.ref.value.trim().replace(/^=/, '')); return true; },
    });
  }
  function nameManager() {
    const names = Object.entries(ctx.wb().names || {});
    return modal('Name Manager', `<table class="xl-names"><thead><tr><th>Name</th><th>Value</th><th>Refers To</th><th></th></tr></thead><tbody>${names.map(([n, ref]) => `<tr><td>${esc(n)}</td><td class="muted">${esc(ctx.nameValue(n))}</td><td><input data-ref="${esc(n)}" value="${esc(ref)}" spellcheck="false"></td><td><button type="button" class="btn btn-plain btn-sm" data-delname="${esc(n)}">Delete</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No names yet. Select cells and use Define Name, or type a name in the Name Box.</td></tr>'}</tbody></table><button type="button" class="btn btn-plain btn-sm" data-newname>New…</button>`, {
      ok: 'Close', wide: true,
      onMount: (f, el) => { f.addEventListener('click', (e) => { const d = e.target.closest('[data-delname]'); if (d) { ctx.deleteName(d.dataset.delname); d.closest('tr').remove(); } if (e.target.closest('[data-newname]')) { el.querySelector('[data-close]')?.click(); setTimeout(() => defineName(), 60); } }); },
      onOk: (f) => { for (const inp of f.querySelectorAll('[data-ref]')) if (inp.value.trim() !== ctx.wb().names[inp.dataset.ref]) ctx.setName(inp.dataset.ref, inp.value.trim().replace(/^=/, ''), true); return true; },
    });
  }

  /* ---------- Hyperlink (Ctrl+K) ---------- */
  function hyperlink() {
    const a = ctx.active(); const cell = ctx.sheet().cells[E.cellKey(a.r, a.c)];
    const cur = cell?.l || ''; const internal = cur.startsWith('#');
    return modal(cur ? 'Edit Hyperlink' : 'Insert Hyperlink', `<label class="field"><span>Text to display</span><input name="text" value="${esc(ctx.shown()[E.cellKey(a.r, a.c)]?.text || '')}"></label>
      <div class="xl-cols"><label class="xl-radio"><input type="radio" name="kind" value="web" ${internal ? '' : 'checked'}> Web address or email</label><label class="xl-radio"><input type="radio" name="kind" value="place" ${internal ? 'checked' : ''}> Place in this workbook</label></div>
      <label class="field xl-h-web"><span>Address</span><input name="url" value="${esc(internal ? '' : cur)}" placeholder="https://example.com or mailto:name@example.com"></label>
      <div class="xl-h-place xl-grid2"><label class="field"><span>Sheet</span><select name="sheet">${ctx.wb().sheets.map((s) => `<option ${internal && cur.slice(1).startsWith(`${s.name}!`) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label><label class="field"><span>Cell reference</span><input name="ref" value="${esc(internal ? cur.split('!').pop() : 'A1')}"></label></div>
      ${cur ? '<button type="button" class="btn btn-plain btn-sm" data-unlink>Remove Link</button>' : ''}`, {
      onMount: (f, el) => { const sync = () => { const web = f.elements.kind.value === 'web'; f.querySelector('.xl-h-web').hidden = !web; f.querySelector('.xl-h-place').hidden = web; }; f.addEventListener('change', sync); sync(); f.querySelector('[data-unlink]')?.addEventListener('click', () => { ctx.setLink(null, null); el.querySelector('[data-close]')?.click(); }); },
      onOk: (f) => {
        let link;
        if (f.elements.kind.value === 'web') { link = f.elements.url.value.trim(); if (!link) { toast('Type an address', { tone: 'error' }); return false; } if (!/^(https?:|mailto:)/i.test(link)) link = /@/.test(link) && !/\//.test(link) ? `mailto:${link}` : `https://${link}`; }
        else { const ref = f.elements.ref.value.trim().toUpperCase(); if (!E.parseRange(ref.replace(/\$/g, ''))) { toast('Type a cell such as A1', { tone: 'error' }); return false; } link = `#${f.elements.sheet.value}!${ref}`; }
        ctx.setLink(link, f.elements.text.value); return true;
      },
    });
  }

  /* ---------- Tab color ---------- */
  function tabColor(i) {
    return modal('Tab Color', `<div class="xl-swatches">${['', ...PALETTE].map((c) => `<button type="button" class="xl-sw" data-tc="${c}" style="background:${c || 'transparent'}" aria-label="${c || 'No color'}">${c ? '' : '∅'}</button>`).join('')}</div>`, {
      onMount: (f, el) => f.addEventListener('click', (e) => { const b = e.target.closest('[data-tc]'); if (!b) return; ctx.setTabColor(i, b.dataset.tc || null); el.querySelector('[data-close]')?.click(); }),
      onOk: () => true,
    });
  }

  /* ---------- Phase 3: tables, PivotTables, Goal Seek, protection, sheets, charts ---------- */
  function createTable() {
    const g = ctx.tableTarget();
    const headGuess = (() => { for (let c = g.c1; c <= g.c2; c++) { const v = ctx.shown()[E.cellKey(g.r1, c)]; if (!v || v.number) return false; } return g.r2 > g.r1; })();
    return modal('Create Table', `<label class="field"><span>Where is the data for your table?</span><input name="range" value="${esc(E.rangeRef(g))}" spellcheck="false"></label><label class="xl-check"><input type="checkbox" name="header" ${headGuess ? 'checked' : ''}> My table has headers</label>`, {
      onOk: (f) => { const rg = E.parseRange(f.elements.range.value.trim().toUpperCase().replace(/\$/g, '')); if (!rg) { toast('Type a range such as A1:D20', { tone: 'error' }); return false; } ctx.createTable(rg, f.elements.header.checked); return true; },
    });
  }
  function resizeTable(t) {
    return modal('Resize Table', `<label class="field"><span>Select the new data range for your table</span><input name="range" value="${esc(t.range)}" spellcheck="false"></label><p class="muted">The headers must stay in the same row, and the range must overlap the table.</p>`, {
      onOk: (f) => { const rg = E.parseRange(f.elements.range.value.trim().toUpperCase().replace(/\$/g, '')); const old = E.parseRange(t.range); if (!rg || rg.r1 !== old.r1) { toast('The headers must remain in the same row.', { tone: 'error' }); return false; } ctx.updateTable(t.name, { range: E.rangeRef(rg) }); return true; },
    });
  }
  function createPivot() {
    const g = ctx.tableTarget(); const sh = ctx.sheet(); const q = (n) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n}'`);
    const inTable = E.tableAt(sh, ctx.active().r, ctx.active().c);
    return modal('Create PivotTable', `<label class="field"><span>Table/Range</span><input name="src" value="${esc(inTable ? inTable.name : `${q(sh.name)}!${E.rangeRef(g)}`)}" spellcheck="false"></label>
      <div class="menu-label">Choose where you want the PivotTable to be placed</div><label class="xl-radio"><input type="radio" name="where" value="new" checked> New Worksheet</label><label class="xl-radio"><input type="radio" name="where" value="here"> Existing Worksheet</label>
      <label class="field"><span>Location</span><input name="at" value="${esc(E.cellKey(0, Math.min(E.MAX_COLS - 1, g.c2 + 2)))}" spellcheck="false"></label>`, {
      onOk: (f) => {
        let src = f.elements.src.value.trim(); const tbl = ctx.wb().sheets.flatMap((x) => (x.tables || []).map((t) => ({ x, t }))).find(({ t }) => t.name.toLowerCase() === src.toLowerCase());
        if (tbl) { const tg = E.parseRange(tbl.t.range); if (tbl.t.total) tg.r2 -= 1; src = `${q(tbl.x.name)}!${E.rangeRef(tg)}`; } // a table's header and data rows, not its Total row
        if (!src.includes('!')) src = `${q(sh.name)}!${src}`;
        if (!E.pivotSource(ctx.wb(), src.replace(/\$/g, ''))) { toast('The source data reference isn’t valid.', { tone: 'error' }); return false; }
        const at = f.elements.at.value.trim().toUpperCase().replace(/\$/g, '');
        if (f.elements.where.value === 'here' && !E.parseKey(at)) { toast('Type a location such as H3', { tone: 'error' }); return false; }
        ctx.createPivot(src.replace(/\$/g, ''), f.elements.where.value === 'new' ? null : at); return true;
      },
    });
  }
  function goalSeek() {
    return modal('Goal Seek', `<label class="field"><span>Set cell</span><input name="set" value="${esc(E.cellKey(ctx.active().r, ctx.active().c))}"></label><label class="field"><span>To value</span><input name="to" inputmode="decimal"></label><label class="field"><span>By changing cell</span><input name="by"></label>`, {
      onOk: (f) => {
        const set = f.elements.set.value.trim().toUpperCase().replace(/\$/g, ''), by = f.elements.by.value.trim().toUpperCase().replace(/\$/g, ''), to = Number(f.elements.to.value);
        if (!E.parseKey(set) || !String(ctx.sheet().cells[set]?.v || '').startsWith('=')) { toast('Set cell must contain a formula.', { tone: 'error' }); return false; }
        if (!E.parseKey(by) || String(ctx.sheet().cells[by]?.v || '').startsWith('=')) { toast('By changing cell must contain a value, not a formula.', { tone: 'error' }); return false; }
        if (!Number.isFinite(to)) { toast('To value must be a number.', { tone: 'error' }); return false; }
        ctx.goalSeek(set, to, by); return true;
      },
    });
  }
  // Sheet passwords are kept as fingerprints. Older sheets used a different prefix, so both are accepted when unlocking.
  const digest = async (text) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); };
  const hash = (text) => digest(`sheet-protect:${text}`);
  const matches = async (text, stored) => (await hash(text)) === stored || (await digest(`${['still', 'point'].join('')}:${text}`)) === stored;
  function protectSheet() {
    return modal('Protect Sheet', `<label class="field"><span>Password to unprotect sheet (optional)</span><input type="password" name="pw" autocomplete="new-password"></label><label class="field"><span>Reenter password</span><input type="password" name="pw2" autocomplete="new-password"></label>
      <div class="menu-label">Allow all users of this worksheet to:</div>${[['selectLocked', 'Select locked cells', true], ['format', 'Format cells'], ['insert', 'Insert rows and columns'], ['delete', 'Delete rows and columns'], ['sort', 'Sort'], ['filter', 'Use AutoFilter']].map(([k, l, on]) => `<label class="xl-check"><input type="checkbox" name="a_${k}" ${on ? 'checked' : ''}> ${l}</label>`).join('')}
      <p class="muted">Protection prevents accidental changes. It isn’t a security feature: anyone who can edit the document can still change its data.</p>`, {
      onOk: async (f) => { if (f.elements.pw.value !== f.elements.pw2.value) { toast('The passwords don’t match.', { tone: 'error' }); return false; } const pw = f.elements.pw.value ? await hash(f.elements.pw.value) : null; ctx.setProtect({ on: true, ...(pw ? { pw } : {}), allow: Object.fromEntries(['selectLocked', 'format', 'insert', 'delete', 'sort', 'filter'].map((k) => [k, f.elements[`a_${k}`].checked])) }); return true; },
    });
  }
  async function unprotectSheet() {
    const pr = ctx.sheet().protect; if (!pr) return;
    if (!pr.pw) { ctx.setProtect(null); return; }
    let ok = false;
    await modal('Unprotect Sheet', '<label class="field"><span>Password</span><input type="password" name="pw" autocomplete="current-password"></label>', {
      onMount: (f) => setTimeout(() => f.elements.pw.focus(), 40),
      onOk: async (f) => { if (!(await matches(f.elements.pw.value, pr.pw))) { toast('The password you supplied is not correct.', { tone: 'error' }); return false; } ok = true; return true; },
    });
    if (ok) ctx.setProtect(null);
  }
  function unhideSheet() {
    const hidden = ctx.wb().sheets.map((x, i) => [x, i]).filter(([x]) => x.hidden);
    if (!hidden.length) { toast('There are no hidden sheets'); return null; }
    return modal('Unhide', `<p>Unhide sheet:</p>${hidden.map(([x, i], k) => `<label class="xl-radio"><input type="radio" name="s" value="${i}" ${k === 0 ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}`, { onOk: (f) => { ctx.unhideSheet(Number(f.elements.s.value)); return true; } });
  }
  function chartOptions(ch) {
    return modal('Chart', `<div class="xl-grid2"><label class="field"><span>Chart type</span><select name="t">${[['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['pie', 'Pie']].map(([v, l]) => `<option value="${v}" ${ch.t === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Chart title</span><input name="title" value="${esc(ch.title)}"></label><label class="field"><span>Data range</span><input name="range" value="${esc(ch.range)}" spellcheck="false"></label>
      <label class="xl-check"><input type="checkbox" name="legend" ${ch.legend ? 'checked' : ''}> Legend</label><label class="xl-check"><input type="checkbox" name="byRow" ${ch.byRow ? 'checked' : ''}> Series in rows (Switch Row/Column)</label></div>`, {
      onOk: (f) => { const r = f.elements.range.value.trim(); if (!E.parseRange(r.split('!').pop().replace(/\$/g, ''))) { toast('Type a range such as A1:C6', { tone: 'error' }); return false; } ctx.updateChart(ch.id, { t: f.elements.t.value, title: f.elements.title.value, range: r.replace(/\$/g, ''), legend: f.elements.legend.checked, byRow: f.elements.byRow.checked }); return true; },
    });
  }

  return { createTable, resizeTable, createPivot, goalSeek, protectSheet, unprotectSheet, unhideSheet, chartOptions, formatCells, pasteSpecial, insertCells, sortDialog, removeDuplicates, textToColumns, validation, defineName, nameManager, hyperlink, tabColor };
}
