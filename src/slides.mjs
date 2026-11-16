// Presentations: export to PowerPoint (.pptx) and import from it.
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { normalizeDeck, heightFor, htmlToParagraphs, THEMES, W, newId } from '../shared/slides-engine.mjs';
import { FONTS, themeOf } from '../shared/slides-engine.mjs';
import { SHAPE_LIB, PRST_TO_SHAPE } from '../shared/shapes.mjs';

const hex = (c) => (c ? String(c).replace('#', '').toUpperCase() : undefined);
const IN = (v) => v / 96; // the 960-wide canvas is 10 inches wide
const fontName = (stack) => String(stack).split(',')[0].replace(/['"]/g, '').trim();
const prstOf = (shape) => SHAPE_LIB[shape]?.prst || 'rect';
const DASH_OUT = { dash: 'dash', dot: 'sysDot', dashDot: 'dashDot', longDash: 'lgDash' };
const DASH_IN = { dash: 'dash', sysDash: 'dash', sysDot: 'dot', dot: 'dot', dashDot: 'dashDot', sysDashDot: 'dashDot', lgDash: 'longDash', lgDashDot: 'longDash' };
const HEAD_IN = { triangle: 'triangle', arrow: 'arrow', stealth: 'triangle', oval: 'oval', diamond: 'diamond' };
const SHADOW = { type: 'outer', blur: 4, offset: 2, angle: 90, color: '000000', opacity: 0.35 };

const NUM_TYPES = { decimal: 'arabicPeriod', 'upper-alpha': 'alphaUcPeriod', 'lower-alpha': 'alphaLcPeriod', 'upper-roman': 'romanUcPeriod', 'lower-roman': 'romanLcPeriod' };
const BULLET_CHARS = { circle: '25CB', square: '25A0' };
function textRuns(html, baseFs, baseColor) {
  const paras = htmlToParagraphs(html);
  const out = [];
  paras.forEach((p, pi) => {
    const runs = p.runs.length ? p.runs : [{ text: '' }];
    runs.forEach((r, ri) => {
      const slideLink = r.link && /^#slide=(\d+)$/.exec(r.link);
      out.push({
        text: r.text,
        options: {
          bold: !!r.b, italic: !!r.i, underline: r.u ? { style: 'sng' } : undefined,
          ...(r.s ? { strike: 'sngStrike' } : {}), ...(r.sup ? { superscript: true } : {}), ...(r.sub ? { subscript: true } : {}),
          ...(r.highlight ? { highlight: hex(r.highlight) } : {}), ...(r.font ? { fontFace: r.font } : {}),
          ...(r.link ? { hyperlink: slideLink ? { slide: Number(slideLink[1]) } : { url: r.link } } : {}),
          color: hex(r.color || baseColor), fontSize: Math.round((r.size || baseFs) * 0.75 * 10) / 10,
          ...(ri === 0 && p.bullet ? { bullet: p.bullet === 'ol' ? { type: 'number', ...(NUM_TYPES[p.listType] ? { style: NUM_TYPES[p.listType] } : {}) } : (BULLET_CHARS[p.listType] ? { code: BULLET_CHARS[p.listType] } : true), ...(p.level ? { indentLevel: p.level } : {}) } : {}),
          ...(ri === runs.length - 1 && pi < paras.length - 1 ? { breakLine: true } : {}),
        },
      });
    });
  });
  return out;
}

/** Build a .pptx. `readImage(src)` returns { data: 'image/png;base64,...' } or null for each picture. */
export async function exportPptx(raw, { readImage, title = 'Presentation' } = {}) {
  const deck = normalizeDeck(raw);
  const theme = themeOf(deck);
  const H = heightFor(deck.ratio);
  const pptx = new PptxGenJS();
  const notesOut = new Set();
  pptx.layout = deck.ratio === '4:3' ? 'LAYOUT_4x3' : 'LAYOUT_16x9';
  pptx.title = title;
  for (const s of deck.slides) {
    const sl = pptx.addSlide();
    const bgImg = s.bgImg ? await readImage?.(s.bgImg) : null;
    sl.background = bgImg ? { data: bgImg.data } : { color: hex(s.bg || s.bgGrad?.a || theme.bg) };
    if (s.bgGrad) notesOut.add('gradient backgrounds became their first colour');
    if (deck.num?.on && !(deck.num.skipTitle && s.layout === 'title')) sl.slideNumber = { x: IN(W - 70), y: IN(H - 34), w: IN(50), h: IN(24), fontSize: 10.5, color: hex(theme.muted), align: 'right' };
    for (const it of [...(deck.master?.items || []).map((x) => ({ ...x, z: x.z - 1000 })), ...s.items].sort((a, b) => a.z - b.z)) {
      const box = { x: IN(it.x), y: IN(it.y * (W / W)), w: IN(it.w), h: IN(it.h), ...(it.rot ? { rotate: it.rot } : {}), ...(it.fh ? { flipH: true } : {}), ...(it.fv ? { flipV: true } : {}) };
      const textOpts = { margin: Math.round((it.pad ?? 8) * 0.75), ...(it.af === 'shrink' ? { fit: 'shrink' } : it.af === 'resize' ? { fit: 'resize' } : {}), ...(it.lh ? { lineSpacingMultiple: it.lh } : {}), ...(it.ps ? { paraSpaceAfter: Math.round(it.ps * 0.75) } : {}), ...(it.ff ? { fontFace: it.ff } : {}) };
      if (it.t === 'text') {
        const face = fontName(it.role === 'title' || it.role === 'subtitle' ? theme.title : theme.body);
        sl.addText(textRuns(it.html, it.fs, it.color || theme.ink), { ...box, fontFace: face, align: it.al, valign: it.va, ...textOpts, ...(it.fill ? { fill: { color: hex(it.fill) } } : {}), ...(it.shadow && it.fill ? { shadow: SHADOW } : {}) });
      } else if (it.t === 'shape') {
        const opts = { ...box, fill: it.fill ? { color: hex(it.fill) } : { type: 'none' }, line: it.stroke && it.sw ? { color: hex(it.stroke), width: it.sw * 0.75, ...(it.dash ? { dashType: DASH_OUT[it.dash] } : {}) } : { type: 'none' }, ...(it.shadow ? { shadow: SHADOW } : {}) };
        if (it.html) sl.addText(textRuns(it.html, it.fs || 20, it.color || theme.ink), { ...opts, shape: prstOf(it.shape), align: it.al || 'center', valign: it.va || 'middle', fontFace: fontName(theme.body), ...textOpts });
        else sl.addShape(prstOf(it.shape), opts);
      } else if (it.t === 'line') {
        const lb = { x: IN(Math.min(it.x1, it.x2)), y: IN(Math.min(it.y1, it.y2)), w: IN(Math.max(0.5, Math.abs(it.x2 - it.x1))), h: IN(Math.max(0.5, Math.abs(it.y2 - it.y1))), ...(it.x2 < it.x1 ? { flipH: true } : {}), ...(it.y2 < it.y1 ? { flipV: true } : {}) };
        sl.addShape(it.kind === 'elbow' ? 'bentConnector3' : it.kind === 'curved' ? 'curvedConnector3' : 'line', { ...lb, line: { color: hex(it.stroke), width: it.sw * 0.75, ...(it.dash ? { dashType: DASH_OUT[it.dash] } : {}), ...(it.a1 ? { beginArrowType: it.a1 } : {}), ...(it.a2 ? { endArrowType: it.a2 } : {}) } });
      } else if (it.t === 'table') {
        const rows = it.rows.map((row, r) => row.map((c) => (c.hide ? null : { text: textRuns(c.html || '', it.fs, it.color || theme.ink), options: { ...(c.cs ? { colspan: c.cs } : {}), ...(c.rs ? { rowspan: c.rs } : {}), ...(c.bg ? { fill: { color: hex(c.bg) } } : it.hdr && r === 0 ? { fill: { color: hex(theme.accent) }, color: 'FFFFFF', bold: true } : {}) } })).filter(Boolean));
        sl.addTable(rows, { x: box.x, y: box.y, w: box.w, colW: it.colW.map(IN), rowH: it.rowH.map(IN), fontSize: Math.round(it.fs * 0.75), fontFace: fontName(theme.body), color: hex(it.color || theme.ink), border: it.bw ? { type: 'solid', pt: it.bw * 0.75, color: hex(it.bc) } : { type: 'none' }, margin: 4 });
      } else if (it.t === 'video') {
        sl.addMedia({ type: 'online', link: `https://www.youtube.com/embed/${it.yt}${it.start ? `?start=${it.start}` : ''}`, x: box.x, y: box.y, w: box.w, h: box.h });
      } else if (it.t === 'wordart') {
        sl.addText(it.text, { ...box, fontFace: it.ff || fontName(theme.title), fontSize: Math.max(8, Math.round(it.h * 0.86 * 0.75)), bold: !!it.b, italic: !!it.i, color: hex(it.fill), align: 'center', valign: 'middle', fit: 'shrink', margin: 0, ...(it.stroke && it.sw ? { outline: { color: hex(it.stroke), size: it.sw * 0.75 } } : {}), ...(it.shadow ? { shadow: SHADOW } : {}) });
      } else if (it.t === 'image') {
        const img = await readImage?.(it.src);
        if (img) {
          const c = it.crop; const fw = c ? it.w / (1 - c.l - c.r) : it.w, fh = c ? it.h / (1 - c.t - c.b) : it.h;
          sl.addImage({ ...box, ...(c ? { x: IN(it.x), y: IN(it.y), w: IN(fw), h: IN(fh), sizing: { type: 'crop', x: IN(c.l * fw), y: IN(c.t * fh), w: IN(it.w), h: IN(it.h) } } : {}), data: img.data, ...(it.op ? { transparency: Math.round((1 - it.op) * 100) } : {}), ...(it.mask === 'ellipse' ? { rounding: true } : {}), ...(it.alt ? { altText: it.alt } : {}), ...(it.shadow ? { shadow: SHADOW } : {}) });
          if (it.br || it.ct || it.rc || (it.mask && it.mask !== 'ellipse')) notesOut.add('some image adjustments and masks stay in the app');
        }
      } else if (it.t === 'chart') {
        const sp = it.spec || {};
        const labels = Array.isArray(sp.labels) ? sp.labels.map(String) : [];
        const series = (Array.isArray(sp.series) ? sp.series : []).map((x, i) => ({ name: String(x?.n ?? `Series ${i + 1}`), labels, values: labels.map((_, j) => Number(x?.v?.[j]) || 0) }));
        if (!labels.length || !series.length) continue;
        const type = sp.t === 'line' ? pptx.ChartType.line : sp.t === 'pie' ? pptx.ChartType.pie : pptx.ChartType.bar;
        sl.addChart(type, sp.t === 'pie' ? series.slice(0, 1) : series, {
          ...box, barDir: sp.t === 'bar' ? 'bar' : 'col', showLegend: sp.legend !== false, legendPos: 'b', showTitle: !!sp.title, title: sp.title || undefined,
          chartColors: (Array.isArray(sp.series) ? sp.series : []).map((x) => hex(x?.c) || '4A86E8'), catAxisLabelColor: hex(theme.ink), valAxisLabelColor: hex(theme.ink),
        });
      }
    }
    if (s.notes) sl.addNotes(s.notes);
  }
  const out = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
  out.note = [...notesOut].join('; ');
  return out;
}

/* ---------- Import ---------- */
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', preserveOrder: true, trimValues: false });
const tagOf = (n) => Object.keys(n).find((k) => k !== ':@');
const kids = (n) => (n && Array.isArray(n[tagOf(n)]) ? n[tagOf(n)] : []);
const at = (n) => (n && n[':@']) || {};
const one = (nodes, name) => (nodes || []).find((n) => tagOf(n) === name);
const all = (nodes, name) => (nodes || []).filter((n) => tagOf(n) === name);
const path = (n, ...names) => names.reduce((cur, name) => one(kids(cur), name), n);
const textIn = (n) => kids(n).map((c) => (tagOf(c) === '#text' ? c['#text'] : textIn(c))).join('');
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colorOf = (n) => { const c = path(n, 'a:solidFill', 'a:srgbClr'); return c ? `#${String(at(c)['@val']).toLowerCase()}` : null; };
const relTarget = (base, target) => { const parts = base.split('/').slice(0, -1); for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); } return parts.join('/'); };
async function rels(zip, file) {
  const relFile = file.replace(/([^/]+)$/, '_rels/$1.rels');
  const xml = await zip.file(relFile)?.async('string');
  const out = {};
  if (!xml) return out;
  for (const r of all(kids(one(parser.parse(xml), 'Relationships')), 'Relationship')) out[at(r)['@Id']] = { target: at(r)['@TargetMode'] === 'External' ? at(r)['@Target'] : relTarget(file, at(r)['@Target']), type: at(r)['@Type'] || '' }; // web links stay as they are
  return out;
}

/** Read a .pptx into a deck. `saveImage(buffer, name, mime)` stores a picture and returns its URL. */
export async function importPptx(buffer, { saveImage } = {}) {
  { const { guardZip } = await import('./zip-guard.mjs'); await guardZip(buffer, { label: 'presentation' }); } // zip bombs
  const zip = await JSZip.loadAsync(buffer);
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presXml) throw Object.assign(new Error('That isn’t a PowerPoint (.pptx) file'), { status: 400 });
  const pres = one(parser.parse(presXml), 'p:presentation');
  const size = at(one(kids(pres), 'p:sldSz'));
  const cx = Number(size['@cx']) || 12192000, cy = Number(size['@cy']) || 6858000;
  const ratio = cy / cx > 0.66 ? '4:3' : '16:9';
  const H = heightFor(ratio);
  const sx = (v) => (Number(v) / cx) * W, sy = (v) => (Number(v) / cy) * H;
  const presRels = await rels(zip, 'ppt/presentation.xml');
  const ids = all(kids(one(kids(pres), 'p:sldIdLst')), 'p:sldId').map((n) => at(n)['@r:id']);
  const notes = new Set();
  const slides = [];
  for (const rid of ids.slice(0, 200)) {
    const file = presRels[rid]?.target; if (!file) continue;
    const xml = await zip.file(file)?.async('string'); if (!xml) continue;
    const r = await rels(zip, file);
    const sld = one(parser.parse(xml), 'p:sld');
    const cSld = one(kids(sld), 'p:cSld');
    const bgPr = path(cSld, 'p:bg', 'p:bgPr');
    const bg = colorOf(bgPr);
    const slideBg = {};
    const gf = path(bgPr, 'a:gradFill'); if (gf) { const stops = all(kids(path(gf, 'a:gsLst')), 'a:gs').map((g2) => at(path(g2, 'a:srgbClr'))['@val']).filter(Boolean); if (stops.length >= 2) slideBg.bgGrad = { a: `#${stops[0].toLowerCase()}`, b: `#${stops[stops.length - 1].toLowerCase()}`, ang: Math.round((Number(at(path(gf, 'a:lin'))['@ang']) || 5400000) / 60000) + 90 }; }
    const bblip = at(path(bgPr, 'a:blipFill', 'a:blip'))['@r:embed']; if (bblip && r[bblip] && saveImage) { const tgt = r[bblip].target; const data = await zip.file(tgt)?.async('nodebuffer'); const ext = tgt.split('.').pop().toLowerCase(); const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext]; if (data && mime) slideBg.bgImg = await saveImage(data, tgt.split('/').pop(), mime); }
    const pptxIds = new Map(); // PowerPoint shape ids → our ids (for connectors)
    const pendingCxn = [];
    const items = [];
    let z = 1;
    const walk = async (nodes, map) => {
      for (const n of nodes) {
        const tag = tagOf(n);
        if (tag === 'p:grpSp') {
          const xf = path(n, 'p:grpSpPr', 'a:xfrm');
          const off = at(path(xf, 'a:off')), ext = at(path(xf, 'a:ext')), chOff = at(path(xf, 'a:chOff')), chExt = at(path(xf, 'a:chExt'));
          const kx = Number(ext['@cx']) / (Number(chExt['@cx']) || 1) || 1, ky = Number(ext['@cy']) / (Number(chExt['@cy']) || 1) || 1;
          const before = items.length;
          await walk(kids(n), (x, y, w, h) => map(Number(off['@x']) + (x - Number(chOff['@x'] || 0)) * kx, Number(off['@y']) + (y - Number(chOff['@y'] || 0)) * ky, w * kx, h * ky));
          if (items.length - before > 1) { const g = newId(); for (let i = before; i < items.length; i++) items[i].g ||= g; } // a PowerPoint group stays a group
          continue;
        }
        if (!['p:sp', 'p:pic', 'p:cxnSp', 'p:graphicFrame'].includes(tag)) continue;
        const spPr = one(kids(n), 'p:spPr');
        const xf = tag === 'p:graphicFrame' ? one(kids(n), 'p:xfrm') : path(spPr, 'a:xfrm');
        const ph = at(path(n, tag === 'p:pic' ? 'p:nvPicPr' : 'p:nvSpPr', 'p:nvPr', 'p:ph'));
        const phType = ph['@type'] || (Object.keys(ph).length ? 'body' : null);
        let box = null;
        if (xf) { const off = at(path(xf, 'a:off')), ext = at(path(xf, 'a:ext')); const m = map(Number(off['@x']) || 0, Number(off['@y']) || 0, Number(ext['@cx']) || 0, Number(ext['@cy']) || 0); box = { x: Math.round(sx(m[0])), y: Math.round(sy(m[1])), w: Math.round(sx(m[2])), h: Math.round(sy(m[3])) };
          const xa = at(xf); if (Number(xa['@rot'])) box.rot = Math.round(Number(xa['@rot']) / 60000); if (xa['@flipH'] === '1') box.fh = 1; if (xa['@flipV'] === '1') box.fv = 1; }
        else if (phType) box = phType === 'title' || phType === 'ctrTitle' ? { x: 60, y: phType === 'ctrTitle' ? H / 2 - 110 : 40, w: 840, h: phType === 'ctrTitle' ? 120 : 80 } : phType === 'subTitle' ? { x: 120, y: H / 2 + 20, w: 720, h: 70 } : { x: 60, y: 140, w: 840, h: H - 190 };
        if (!box || ['sldNum', 'dt', 'ftr', 'sldImg'].includes(phType)) continue;
        const cNv = at(path(n, tag === 'p:pic' ? 'p:nvPicPr' : tag === 'p:cxnSp' ? 'p:nvCxnSpPr' : tag === 'p:graphicFrame' ? 'p:nvGraphicFramePr' : 'p:nvSpPr', tag === 'p:pic' ? 'p:cNvPr' : tag === 'p:cxnSp' ? 'p:cNvPr' : tag === 'p:graphicFrame' ? 'p:cNvPr' : 'p:cNvPr'));
        const rememberId = () => { if (cNv['@id'] && items.length) pptxIds.set(cNv['@id'], items[items.length - 1].id); };
        if (tag === 'p:pic') {
          const blip = at(path(n, 'p:blipFill', 'a:blip'))['@r:embed'];
          const src = at(path(n, 'p:blipFill', 'a:srcRect')); const blipKids = kids(path(n, 'p:blipFill', 'a:blip'));
          const picSet = {};
          if (Object.keys(src).length) { const g = (k2) => Math.max(0, Number(src[k2] || 0) / 100000); picSet.crop = { l: g('@l'), t: g('@t'), r: g('@r'), b: g('@b') }; }
          const am = at(one(blipKids, 'a:alphaModFix'))['@amt']; if (am) picSet.op = Number(am) / 100000;
          if (one(blipKids, 'a:grayscl')) picSet.rc = 'gray';
          const descr = cNv['@descr']; if (descr) picSet.alt = descr;
          // an online video (YouTube) is a picture with a link to the video
          const vlink = at(path(n, 'p:nvPicPr', 'p:nvPr', 'a:videoFile'))['@r:link']; const vurl = vlink && r[vlink]?.target;
          const yt = vurl && /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([\w-]{11})/.exec(vurl);
          if (yt) { const st = /[?&]start=(\d+)/.exec(vurl); items.push({ id: newId(), t: 'video', yt: yt[1], ...(st ? { start: Number(st[1]) } : {}), ...box, z: z++ }); rememberId(); continue; }
          const target = r[blip]?.target;
          const data = target ? await zip.file(target)?.async('nodebuffer') : null;
          const ext = (target || '').split('.').pop().toLowerCase();
          const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext];
          if (data && mime && saveImage) { items.push({ id: newId(), t: 'image', ...box, z: z++, src: await saveImage(data, target.split('/').pop(), mime), ...picSet }); rememberId(); }
          else notes.add('some pictures in formats the app can’t show were left out');
          continue;
        }
        if (tag === 'p:graphicFrame') {
          const tbl = path(n, 'a:graphic', 'a:graphicData', 'a:tbl');
          if (tbl) {
            const cols = all(kids(path(tbl, 'a:tblGrid')), 'a:gridCol').map((g2) => Math.max(10, Math.round(sx(at(g2)['@w'] || 914400))));
            const trs = all(kids(tbl), 'a:tr'); let fsz = null;
            const rows = trs.map((tr) => all(kids(tr), 'a:tc').map((tc) => {
              const ta = at(tc); const tcPr = one(kids(tc), 'a:tcPr'); const bgc = colorOf(tcPr);
              const sz = all(kids(one(kids(tc), 'a:txBody')), 'a:p').flatMap((p2) => all(kids(p2), 'a:r')).map((r2) => at(one(kids(r2), 'a:rPr'))['@sz']).find(Boolean); if (sz && !fsz) fsz = Math.round(Number(sz) / 100 / 0.75);
              const html = all(kids(one(kids(tc), 'a:txBody')), 'a:p').map((p2) => { const bold = all(kids(p2), 'a:r').some((r2) => at(one(kids(r2), 'a:rPr'))['@b'] === '1'); const t2 = escape(textIn(p2)); return t2 ? `<div>${bold ? `<b>${t2}</b>` : t2}</div>` : ''; }).join('');
              return { html, ...(bgc ? { bg: bgc } : {}), ...(Number(ta['@gridSpan']) > 1 ? { cs: Number(ta['@gridSpan']) } : {}), ...(Number(ta['@rowSpan']) > 1 ? { rs: Number(ta['@rowSpan']) } : {}), ...(ta['@hMerge'] === '1' || ta['@vMerge'] === '1' ? { hide: 1 } : {}) };
            }));
            const rowH = trs.map((tr) => Math.max(10, Math.round(sy(at(tr)['@h'] || 370840))));
            items.push({ id: newId(), t: 'table', ...box, z: z++, rows, colW: cols.length === (rows[0] || []).length ? cols : undefined, rowH, fs: fsz || 16, bw: 1, bc: '#9aa0a6' });
          } else notes.add('charts and diagrams were left out');
          continue;
        }
        const geom = at(path(spPr, 'a:prstGeom'))['@prst'] || 'rect';
        const fill = colorOf(spPr);
        const ln = path(spPr, 'a:ln');
        const stroke = colorOf(ln); const sw = ln && at(ln)['@w'] ? Math.max(1, Math.round(Number(at(ln)['@w']) / 9525)) : (stroke ? 1 : 0);
        // Text: paragraphs with runs, grouped into lists where they have bullets.
        const body = one(kids(n), 'p:txBody');
        const bodyPr = at(one(kids(body), 'a:bodyPr')); const bodyKids = kids(one(kids(body), 'a:bodyPr'));
        const textSet = {};
        if (bodyPr['@lIns'] !== undefined) textSet.pad = Math.round(Number(bodyPr['@lIns']) / 9525);
        if (one(bodyKids, 'a:normAutofit')) textSet.af = 'shrink'; else if (one(bodyKids, 'a:spAutoFit')) textSet.af = 'resize';
        const faces = new Set(); for (const pp of all(kids(body), 'a:p')) for (const rr of all(kids(pp), 'a:r')) { const f = at(one(kids(one(kids(rr), 'a:rPr')), 'a:latin'))['@typeface']; faces.add(f || ''); }
        const oneFace = faces.size === 1 ? [...faces][0] : null; if (oneFace && FONTS.includes(oneFace) && oneFace !== 'Figtree') textSet.ff = oneFace;
        let html = '', baseFs = null, align = 'left';
        const open = []; // the open lists, one per indent level
        const NUM_IN = { arabicPeriod: 'decimal', arabicParenR: 'decimal', alphaUcPeriod: 'upper-alpha', alphaLcPeriod: 'lower-alpha', alphaLcParenR: 'lower-alpha', romanUcPeriod: 'upper-roman', romanLcPeriod: 'lower-roman' };
        const closeTo = (lvl) => { while (open.length > lvl) html += `</${open.pop()}>`; };
        for (const p of all(kids(body), 'a:p')) {
          const pPr = one(kids(p), 'a:pPr'); const pa = at(pPr);
          const algn = pa['@algn']; if (algn === 'ctr') align = 'center'; else if (algn === 'r') align = 'right'; else if (algn === 'just') align = 'justify';
          const lnPct = at(path(pPr, 'a:lnSpc', 'a:spcPct'))['@val']; if (lnPct && !textSet.lh) textSet.lh = Math.round(Number(lnPct) / 1000) / 100;
          const aft = at(path(pPr, 'a:spcAft', 'a:spcPts'))['@val']; if (aft && !textSet.ps) textSet.ps = Math.round(Number(aft) / 100 / 0.75);
          const num = at(one(kids(pPr), 'a:buAutoNum'))['@type']; const ch = at(one(kids(pPr), 'a:buChar'))['@char'];
          const bullet = one(kids(pPr), 'a:buAutoNum') ? 'ol' : one(kids(pPr), 'a:buChar') ? 'ul' : (phType === 'body' && !one(kids(pPr), 'a:buNone') ? 'ul' : null);
          const listType = bullet === 'ol' ? NUM_IN[num] : ch === '○' || ch === 'o' ? 'circle' : ch === '■' || ch === '§' ? 'square' : null;
          const lvl = Math.min(8, Number(pa['@lvl']) || 0);
          let line = '';
          for (const c of kids(p)) {
            const ct = tagOf(c);
            if (ct === 'a:br') { line += '<br>'; continue; }
            if (ct !== 'a:r' && ct !== 'a:fld') continue;
            const rPr = one(kids(c), 'a:rPr'); const ra = at(rPr);
            let t = escape(textIn(one(kids(c), 'a:t')));
            if (!t) continue;
            const sz = ra['@sz'] ? Math.round((Number(ra['@sz']) / 100) / 0.75) : null;
            if (sz && !baseFs) baseFs = sz;
            const col = ['#000000', '#1f1f1f'].includes(colorOf(rPr)) ? null : colorOf(rPr); // default text colour needs no span
            if (ra['@b'] === '1') t = `<b>${t}</b>`;
            if (ra['@i'] === '1') t = `<i>${t}</i>`;
            if (ra['@u'] && ra['@u'] !== 'none') t = `<u>${t}</u>`;
            if (ra['@strike'] && ra['@strike'] !== 'noStrike') t = `<s>${t}</s>`;
            if (Number(ra['@baseline']) > 0) t = `<sup>${t}</sup>`; else if (Number(ra['@baseline']) < 0) t = `<sub>${t}</sub>`;
            const hlc = path(one(kids(rPr), 'a:highlight'), 'a:srgbClr'); if (hlc) t = `<span style="background-color:#${String(at(hlc)['@val']).toLowerCase()}">${t}</span>`; // a highlight holds its colour directly
            const face = at(one(kids(rPr), 'a:latin'))['@typeface']; if (!oneFace && face && FONTS.includes(face)) t = `<span style="font-family:'${face}'">${t}</span>`; // mixed fonts: per piece of text
            const link = at(one(kids(rPr), 'a:hlinkClick'))['@r:id']; const target = link && r[link]?.target;
            if (target && /^(https?:|mailto:)/i.test(target)) t = `<a href="${escape(target)}">${t}</a>`;
            else if (target && /slide(\d+)\.xml$/.test(target)) t = `<a href="#slide=${/slide(\d+)\.xml$/.exec(target)[1]}">${t}</a>`;
            if (col || (sz && sz !== baseFs)) t = `<span style="${col ? `color:${col};` : ''}${sz && sz !== baseFs ? `font-size:${sz}px` : ''}">${t}</span>`;
            line += t;
          }
          if (bullet) {
            closeTo(lvl + 1);
            if (open.length === lvl + 1 && open[lvl] !== bullet) closeTo(lvl);
            while (open.length < lvl + 1) { const tagName = open.length === lvl ? bullet : 'ul'; html += `<${tagName}${open.length === lvl && listType ? ` style="list-style-type:${listType}"` : ''}>`; open.push(tagName); }
            html += `<li>${line || '<br>'}</li>`;
          } else { closeTo(0); html += `<div>${line || '<br>'}</div>`; }
        }
        closeTo(0);
        const hasText = /[^\s]/.test(html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ''));
        const role = phType === 'title' || phType === 'ctrTitle' ? 'title' : phType === 'subTitle' ? 'subtitle' : phType ? 'body' : undefined;
        const fs = baseFs || (role === 'title' ? 58 : role === 'subtitle' ? 32 : 24); // PowerPoint defaults: 44pt, 24pt, 18pt
        const shapeKind = PRST_TO_SHAPE[geom];
        const dashIn = DASH_IN[at(path(ln, 'a:prstDash'))['@val']];
        if (tag === 'p:cxnSp' || ['line', 'straightConnector1'].includes(geom) || /^(bent|curved)Connector/.test(geom)) {
          const fh2 = box.fh, fv2 = box.fv; const x1 = fh2 ? box.x + box.w : box.x, y1 = fv2 ? box.y + box.h : box.y, x2 = fh2 ? box.x : box.x + box.w, y2 = fv2 ? box.y : box.y + box.h;
          const h1 = HEAD_IN[at(path(ln, 'a:headEnd'))['@type']], h2 = HEAD_IN[at(path(ln, 'a:tailEnd'))['@type']];
          const line = { id: newId(), t: 'line', x1, y1, x2, y2, z: z++, kind: /^bent/.test(geom) ? 'elbow' : /^curved/.test(geom) ? 'curved' : 'straight', stroke: stroke || '#1f1f1f', sw: sw || 2, ...(dashIn ? { dash: dashIn } : {}), ...(h1 ? { a1: h1 } : {}), ...(h2 ? { a2: h2 } : {}) };
          items.push(line);
          const cx2 = path(n, 'p:nvCxnSpPr', 'p:cNvCxnSpPr'); const st = at(path(cx2, 'a:stCxn')), en = at(path(cx2, 'a:endCxn'));
          if (st['@id'] || en['@id']) pendingCxn.push({ item: line, st: st['@id'] ? { id: st['@id'], idx: Number(st['@idx']) || 0 } : null, en: en['@id'] ? { id: en['@id'], idx: Number(en['@idx']) || 0 } : null });
          continue;
        }
        if (hasText && (!shapeKind || shapeKind === 'rect') && !stroke) { items.push({ id: newId(), t: 'text', ...box, z: z++, fs: Math.round(fs), al: align, va: role === 'title' ? 'middle' : 'top', html, ...textSet, ...(role ? { role } : {}), ...(fill ? { fill } : {}) }); rememberId(); }
        else if (fill || stroke || hasText) {
          if (!shapeKind) notes.add('some shapes were simplified');
          items.push({ id: newId(), t: 'shape', shape: shapeKind || 'rect', ...box, z: z++, fill: fill || '', stroke: stroke || '', sw, ...(dashIn ? { dash: dashIn } : {}), ...(hasText ? { html, fs: Math.round(fs), ...textSet } : {}) }); rememberId();
        }
      }
    };
    await walk(kids(one(kids(cSld), 'p:spTree')), (x, y, w, h) => [x, y, w, h]);
    // Speaker notes
    let speaker = '';
    const notesRel = Object.values(r).find((x) => /notesSlide$/.test(x.type));
    if (notesRel) {
      const nx = await zip.file(notesRel.target)?.async('string');
      if (nx) {
        const ns = one(parser.parse(nx), 'p:notes');
        for (const sp of all(kids(path(ns, 'p:cSld', 'p:spTree')), 'p:sp')) {
          const t = at(path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph'))['@type'];
          if (t === 'body') speaker = all(kids(one(kids(sp), 'p:txBody')), 'a:p').map((p) => textIn(p)).join('\n').trim();
        }
      }
    }
    for (const pc of pendingCxn) { // attach connector ends to the shapes they connect in PowerPoint
      for (const [k2, ref] of [['from', pc.st], ['to', pc.en]]) { if (!ref) continue; const id = pptxIds.get(ref.id); if (id) pc.item[k2] = { id, site: ['n', 'w', 's', 'e'][ref.idx % 4] || 'e' }; }
    }
    slides.push({ id: newId(), layout: 'blank', bg, ...slideBg, notes: speaker, items });
  }
  if (!slides.length) throw Object.assign(new Error('No slides were found in that file'), { status: 400 });
  notes.add('theme colours and fonts were replaced with the app’s theme where not set directly');
  return { deck: normalizeDeck({ ratio, theme: 'light', slides }), note: [...notes].slice(0, 3).join('; ') };
}
