// Presentations: the slide editor, read-only slides (reading view and print), presenting and presenter view.
import { esc, kbd } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { toast, confirmDialog, openMenu } from './ui.js';
import { chartSvg, openChartDialog } from './charts.js';
import * as S from '/shared/slides-engine.mjs';

const parse = (json) => { try { return S.normalizeDeck(typeof json === 'string' ? JSON.parse(json) : json); } catch { return S.emptyDeck(); } };
const enc = (deck) => encodeURIComponent(JSON.stringify(deck));

/* ---------- Scaling: every slide is drawn on a 960-wide canvas and scaled to fit its frame ---------- */
const fitter = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
  for (const e of entries) e.target.style.setProperty('--k', String(e.contentRect.width / S.W));
}) : null;
function fitFrames(root = document) {
  if (!root) return;
  requestAnimationFrame(() => fitText(root));
  root.querySelectorAll?.('.sl-frame:not([data-fit])').forEach((f) => { f.dataset.fit = '1'; f.style.setProperty('--k', String(f.clientWidth / S.W || 1)); fitter?.observe(f); });
}
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.('.sl-frame')) fitFrames(n.parentElement || n); else if (n.querySelector?.('.sl-frame')) fitFrames(n); } })
    .observe(document.documentElement, { childList: true, subtree: true });
}

/* ---------- Drawing a slide ---------- */
const VA = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
const DASH = { dash: [4, 3], dot: [1, 2.2], dashDot: [4, 2, 1, 2], longDash: [8, 3] };
const dashArray = (dash, sw) => (DASH[dash] ? DASH[dash].map((n) => Math.round(n * Math.max(1, sw) * 10) / 10).join(' ') : '');
function shapeSvg(it) {
  const { w, h } = it; const sw = it.sw || 0;
  const d = S.shapePath(it.shape, w, h);
  const da = it.dash && sw ? ` stroke-dasharray="${dashArray(it.dash, sw)}"` : '';
  const ev = S.SHAPE_LIB[it.shape]?.evenodd ? ' fill-rule="evenodd"' : '';
  return `<svg class="sl-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" overflow="visible"><path d="${d}" fill="${it.fill || 'none'}" stroke="${it.stroke || 'none'}" stroke-width="${sw}" stroke-linejoin="round"${da}${ev} vector-effect="non-scaling-stroke"/></svg>`;
}
/* lines and connectors: straight, elbow or curved, with arrowheads and dashes */
const LINE_PAD = (it) => Math.max(10, it.sw * 5);
const DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
export function linePath(it, ox = 0, oy = 0) {
  const x1 = it.x1 - ox, y1 = it.y1 - oy, x2 = it.x2 - ox, y2 = it.y2 - oy;
  if (it.kind === 'elbow') {
    const horiz = it.from ? ['e', 'w'].includes(it.from.site) : Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    return horiz ? `M${x1} ${y1} H${(x1 + x2) / 2} V${y2} H${x2}` : `M${x1} ${y1} V${(y1 + y2) / 2} H${x2} V${y2}`;
  }
  if (it.kind === 'curved') {
    const dist = Math.max(40, Math.hypot(x2 - x1, y2 - y1) / 2);
    const d1 = DIRS[it.from?.site] || (Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? [Math.sign(x2 - x1) || 1, 0] : [0, Math.sign(y2 - y1) || 1]);
    const d2 = DIRS[it.to?.site] || [-d1[0], -d1[1]];
    return `M${x1} ${y1} C${x1 + d1[0] * dist} ${y1 + d1[1] * dist} ${x2 + d2[0] * dist} ${y2 + d2[1] * dist} ${x2} ${y2}`;
  }
  return `M${x1} ${y1} L${x2} ${y2}`;
}
const MARK = { arrow: '<path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linejoin="round"/>', triangle: '<path d="M0 0 L10 5 L0 10 Z"/>', oval: '<circle cx="5" cy="5" r="4"/>', diamond: '<path d="M5 0 L10 5 L5 10 L0 5 Z"/>' };
function lineHtml(it) {
  const P = LINE_PAD(it); const ox = it.x - P, oy = it.y - P; const col = it.stroke || '#1f1f1f';
  const mk = (kind, id, start) => `<marker id="${id}" viewBox="0 0 10 10" refX="${kind === 'arrow' ? 8 : 5}" refY="5" markerWidth="${kind === 'arrow' ? 4 : 3.4}" markerHeight="${kind === 'arrow' ? 4 : 3.4}" orient="${start ? 'auto-start-reverse' : 'auto'}" fill="${col}" stroke="${col}">${MARK[kind].replace('context-stroke', col)}</marker>`;
  const defs = `${it.a1 ? mk(it.a1, `m1-${it.id}`, true) : ''}${it.a2 ? mk(it.a2, `m2-${it.id}`, false) : ''}`;
  return `<div class="sl-item sl-line" data-id="${it.id}" style="left:${ox}px;top:${oy}px;width:${it.w + P * 2}px;height:${it.h + P * 2}px;z-index:${it.z}"><svg class="sl-svg" width="100%" height="100%" overflow="visible" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}<path class="sl-line-hit" d="${linePath(it, ox, oy)}" fill="none" stroke="transparent" stroke-width="${Math.max(12, it.sw + 10)}"/><path d="${linePath(it, ox, oy)}" fill="none" stroke="${col}" stroke-width="${it.sw}" stroke-linecap="${it.dash === 'dot' ? 'round' : 'butt'}" stroke-linejoin="round"${it.dash ? ` stroke-dasharray="${dashArray(it.dash, it.sw)}"` : ''}${it.a1 ? ` marker-start="url(#m1-${it.id})"` : ''}${it.a2 ? ` marker-end="url(#m2-${it.id})"` : ''}/></svg></div>`;
}
function tableHtml(it, theme) {
  const rows = it.rows.map((row, r) => `<tr style="height:${it.rowH[r]}px">${row.map((c, j) => (c.hide ? '' : `<td data-cell="${r},${j}"${c.cs ? ` colspan="${c.cs}"` : ''}${c.rs ? ` rowspan="${c.rs}"` : ''} style="border:${it.bw}px solid ${it.bc};${c.bg ? `background:${c.bg};` : it.hdr && r === 0 ? `background:${theme.accent};color:#fff;font-weight:700;` : ''}"><div class="sl-cell" data-rich-cell="${r},${j}">${c.html}</div></td>`)).join('')}</tr>`).join('');
  return `<table class="sl-table" style="font-size:${it.fs}px;color:${it.color || theme.ink}"><colgroup>${it.colW.map((w) => `<col style="width:${w}px">`).join('')}</colgroup><tbody>${rows}</tbody></table>`;
}
function imageInner(it) {
  const c = it.crop || { l: 0, t: 0, r: 0, b: 0 };
  const iw = it.w / (1 - c.l - c.r), ih = it.h / (1 - c.t - c.b);
  const filt = [it.br ? `brightness(${1 + it.br / 100})` : '', it.ct ? `contrast(${1 + it.ct / 100})` : '', { gray: 'grayscale(1)', sepia: 'sepia(1)', light: 'brightness(1.35) saturate(.55)', dark: 'brightness(.55)', invert: 'invert(1)' }[it.rc] || ''].filter(Boolean).join(' ');
  return `<div class="sl-img-clip" style="${it.mask ? `clip-path:path('${S.shapePath(it.mask, it.w, it.h)}');` : ''}"><img src="${esc(it.src)}" alt="${esc(it.alt || '')}" draggable="false" style="left:${-c.l * iw}px;top:${-c.t * ih}px;width:${iw}px;height:${ih}px;${filt ? `filter:${filt};` : ''}${it.op ? `opacity:${it.op};` : ''}"></div>`;
}
const SHADOW = 'filter:drop-shadow(0 3px 5px rgba(0,0,0,.35));';
const textBoxCss = (it) => `padding:${it.pad ?? 8}px;${it.lh ? `line-height:${it.lh};` : ''}${it.ps ? `--ps:${it.ps}px;` : ''}`;
function textHtml(it, theme, placeholders) {
  const empty = !S.plainText(it.html || '').trim();
  const ph = placeholders && empty && S.PLACEHOLDER[it.role];
  return `<div class="sl-text-inner" style="justify-content:${VA[it.va] || 'flex-start'};${textBoxCss(it)}"><div class="sl-rich${it.ps ? ' ps' : ''}"${it.af === 'shrink' ? ' data-fit="shrink"' : ''} data-rich="${it.id}">${ph ? `<span class="sl-ph">${esc(ph)}</span>` : (it.html || '')}</div></div>`;
}
/** "Shrink text on overflow": scale the text down until it fits its box. */
export function fitText(root) {
  root?.querySelectorAll?.('[data-fit="shrink"]').forEach((el) => {
    const box = el.parentElement; el.style.fontSize = ''; let k = 1;
    for (let i = 0; i < 14 && el.scrollHeight > box.clientHeight - 2 && k > 0.3; i++) { k -= 0.05; el.style.fontSize = `${k * 100}%`; }
  });
}
function itemHtml(it, theme, { placeholders = false, live = false } = {}) {
  const font = it.ff ? `'${it.ff}', sans-serif` : it.role === 'title' || it.role === 'subtitle' ? theme.title : theme.body;
  const tf = [it.rot ? `rotate(${it.rot}deg)` : '', it.fh || it.fv ? `scale(${it.fh ? -1 : 1},${it.fv ? -1 : 1})` : ''].filter(Boolean).join(' ');
  const base = `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;z-index:${it.z}${tf ? `;transform:${tf}` : ''}`;
  if (it.t === 'text') return `<div class="sl-item sl-text" data-id="${it.id}" style="${base};${it.shadow && it.fill ? SHADOW : ''}font-size:${it.fs}px;font-family:${font};color:${it.color || theme.ink};text-align:${it.al};${it.fill ? `background:${it.fill};` : ''}">${textHtml(it, theme, placeholders)}</div>`;
  if (it.t === 'shape') {
    const ph = placeholders && it.role === 'imageSlot' ? `<div class="sl-slot">${icon('image', { size: 28 })}<span>Double-click to add an image</span></div>` : '';
    const label = it.html ? `<div class="sl-text-inner" style="justify-content:${VA[it.va] || 'center'};text-align:${it.al || 'center'};font-size:${it.fs || 20}px;font-family:${font};color:${it.color || theme.ink};${textBoxCss(it)}"><div class="sl-rich${it.ps ? ' ps' : ''}"${it.af === 'shrink' ? ' data-fit="shrink"' : ''} data-rich="${it.id}">${it.html}</div></div>` : '';
    return `<div class="sl-item sl-shape" data-id="${it.id}" style="${base}${it.shadow ? `;${SHADOW}` : ''}">${shapeSvg(it)}${label}${ph}</div>`;
  }
  if (it.t === 'image') return `<div class="sl-item sl-image" data-id="${it.id}" style="${base}${it.shadow ? `;${SHADOW}` : ''}">${imageInner(it)}</div>`;
  if (it.t === 'table') return `<div class="sl-item sl-tablebox" data-id="${it.id}" style="${base};font-family:${font}">${tableHtml(it, theme)}</div>`;
  if (it.t === 'file') return `<div class="sl-item sl-file" data-id="${it.id}" style="${base}" data-file="${esc(JSON.stringify(it.ref))}"><div class="file-embed fe-compact"><div class="fe-head"><span class="fe-title">${esc(it.ref.title)}</span></div></div></div>`; // filled in by the live card (file-embed.js)
  if (it.t === 'video') return live
    ? `<div class="sl-item sl-video" data-id="${it.id}" style="${base}"><iframe src="https://www.youtube-nocookie.com/embed/${it.yt}?rel=0${it.start ? `&start=${it.start}` : ''}" title="YouTube video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
    : `<div class="sl-item sl-video" data-id="${it.id}" style="${base}"><img src="https://i.ytimg.com/vi/${it.yt}/hqdefault.jpg" alt="YouTube video" draggable="false"><span class="sl-play" aria-hidden="true">▶</span></div>`;
  if (it.t === 'wordart') return `<div class="sl-item sl-wordart" data-id="${it.id}" style="${base}${it.shadow ? `;${SHADOW}` : ''}"><svg class="sl-svg" viewBox="0 0 ${it.w} ${it.h}" preserveAspectRatio="none" aria-label="${esc(it.text)}"><text x="${it.w / 2}" y="${it.h * 0.78}" text-anchor="middle" font-size="${it.h * 0.86}" font-family="${esc(it.ff ? `'${it.ff}', sans-serif` : theme.title)}" font-weight="${it.b ? 700 : 400}" font-style="${it.i ? 'italic' : 'normal'}" textLength="${it.w * 0.96}" lengthAdjust="spacingAndGlyphs" fill="${it.fill}" stroke="${it.stroke || 'none'}" stroke-width="${it.sw || 0}" paint-order="stroke" stroke-linejoin="round">${esc(it.text)}</text></svg></div>`;
  if (it.t === 'line') return lineHtml(it);
  if (it.t === 'chart') return `<div class="sl-item sl-chart" data-id="${it.id}" style="${base};color:${theme.ink};--chart-bg:transparent">${chartSvg(it.spec || {}, { width: Math.round(it.w), height: Math.round(it.h) })}</div>`;
  return '';
}
/** One slide as a scalable frame. */
export const slideBackground = (deck, slide, theme = S.themeOf(deck)) => (slide.bgImg ? `${slide.bg || theme.bg} url('${slide.bgImg}') center / cover no-repeat` : slide.bgGrad ? `linear-gradient(${slide.bgGrad.ang}deg, ${slide.bgGrad.a}, ${slide.bgGrad.b})` : slide.bg || theme.bg);
export function slideFrame(deck, slide, { placeholders = false, cls = '', live = false, master = true } = {}) {
  const theme = S.themeOf(deck);
  const H = S.heightFor(deck.ratio);
  const idx = deck.slides.indexOf(slide);
  const masterHtml = master && deck.master?.items?.length ? `<div class="sl-master" aria-hidden="true">${[...deck.master.items].sort((a, b) => a.z - b.z).map((it) => itemHtml(it, theme)).join('')}</div>` : '';
  const num = deck.num?.on && idx >= 0 && !(deck.num.skipTitle && slide.layout === 'title') ? `<div class="sl-num" style="color:${theme.muted}">${idx + 1}</div>` : '';
  return `<div class="sl-frame ${cls}" style="aspect-ratio:${S.W}/${H}"><div class="sl-stage" style="width:${S.W}px;height:${H}px;background:${slideBackground(deck, slide, theme)};color:${theme.ink};font-family:${theme.body}">${masterHtml}${[...slide.items].sort((a, b) => a.z - b.z).map((it) => itemHtml(it, theme, { placeholders, live })).join('')}${num}</div></div>`;
}
/** Read-only slides (reading view, print), with a Present button. */
export function staticDeckHtml(json) {
  const deck = parse(json);
  return `<div class="deck-static" data-deck="${enc(deck)}">
    <div class="deck-static-bar"><span>${deck.slides.length} slide${deck.slides.length === 1 ? '' : 's'}</span><button type="button" class="btn btn-plain btn-sm" data-present-deck>${icon('play', { size: 15 })}Present</button></div>
    ${deck.slides.map((s, i) => `<figure class="deck-static-slide">${slideFrame(deck, s)}<figcaption>Slide ${i + 1}</figcaption></figure>`).join('')}
  </div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-present-deck]'); if (!b) return;
  const host = b.closest('.deck-static'); if (!host) return;
  present(parse(decodeURIComponent(host.dataset.deck)), 0);
});

/* ---------- Presenting (full screen) and presenter view (second window) ---------- */
/* Object animations (Web Animations API). `base` keeps an object's own rotation/flip. */
const FLY = 1200;
function effectFrames(fx, base) {
  const t = (x) => `${x} ${base}`.trim();
  switch (fx) {
    case 'appear': return [{ opacity: 0 }, { opacity: 1 }];
    case 'fadeIn': return [{ opacity: 0 }, { opacity: 1 }];
    case 'flyInLeft': return [{ transform: t(`translateX(-${FLY}px)`) }, { transform: t('translateX(0)') }];
    case 'flyInRight': return [{ transform: t(`translateX(${FLY}px)`) }, { transform: t('translateX(0)') }];
    case 'flyInTop': return [{ transform: t(`translateY(-${FLY}px)`) }, { transform: t('translateY(0)') }];
    case 'flyInBottom': return [{ transform: t(`translateY(${FLY}px)`) }, { transform: t('translateY(0)') }];
    case 'zoomIn': return [{ transform: t('scale(0)'), opacity: 0 }, { transform: t('scale(1)'), opacity: 1 }];
    case 'spin': return [{ transform: t('rotate(0deg)') }, { transform: t('rotate(360deg)') }];
    case 'disappear': return [{ opacity: 1 }, { opacity: 0 }];
    case 'fadeOut': return [{ opacity: 1 }, { opacity: 0 }];
    case 'flyOutLeft': return [{ transform: t('translateX(0)') }, { transform: t(`translateX(-${FLY}px)`) }];
    case 'flyOutRight': return [{ transform: t('translateX(0)') }, { transform: t(`translateX(${FLY}px)`) }];
    case 'zoomOut': return [{ transform: t('scale(1)'), opacity: 1 }, { transform: t('scale(0)'), opacity: 0 }];
    default: return [{}, {}];
  }
}
/** Which objects are hidden before any step, and after steps up to `upTo` have played (no animation). */
function stateAt(slide, steps, upTo) {
  const hidden = new Set();
  const firstFx = new Map(); for (const a of slide.anims || []) if (!firstFx.has(a.item)) firstFx.set(a.item, a.fx);
  for (const [id, fx] of firstFx) if (S.EFFECTS[fx]?.kind === 'in') hidden.add(id);
  for (let i = 0; i <= upTo && i < steps.length; i++) for (const a of steps[i]) { const kind = S.EFFECTS[a.fx]?.kind; if (kind === 'in') hidden.delete(a.item); if (kind === 'out') hidden.add(a.item); }
  return hidden;
}
/** Play one step's animations on a drawn slide. "With previous" starts together, "After previous" waits for the one before. */
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export function playStep(stage, step, { speed = reduceMotion() ? 0.001 : 1 } = {}) { // "reduce motion": animations finish at once, in their final state
  let at = 0, prevEnd = 0; const anims = [];
  for (const a of step) {
    const el = stage.querySelector(`.sl-item[data-id="${a.item}"]`); if (!el) continue;
    const start = a.start === 'after' ? prevEnd : at; const dur = (a.fx === 'appear' || a.fx === 'disappear' ? 0.01 : a.dur) * 1000 * speed;
    const base = el.style.transform || '';
    el.style.visibility = 'visible';
    const kind = S.EFFECTS[a.fx]?.kind;
    const anim = el.animate(effectFrames(a.fx, base), { duration: dur, delay: start * 1000 * speed, fill: 'both', easing: a.fx.startsWith('fly') ? 'cubic-bezier(.2,.7,.2,1)' : 'ease' });
    if (kind === 'out') anim.onfinish = () => { el.style.visibility = 'hidden'; anim.cancel(); };
    else if (kind === 'emphasis') anim.onfinish = () => anim.cancel();
    anims.push(anim); at = start; prevEnd = start + dur / 1000 / speed;
  }
  return anims;
}
/** Slide transitions: the new slide arrives over the old one. */
function transitionFrames(type) {
  switch (type) {
    case 'fade': return { inF: [{ opacity: 0 }, { opacity: 1 }], outF: null };
    case 'fadeBlack': return { inF: [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 1 }], outF: [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }] };
    case 'slideRight': return { inF: [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], outF: [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }] };
    case 'slideLeft': return { inF: [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }], outF: [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }] };
    case 'flip': return { inF: [{ transform: 'perspective(1600px) rotateY(-90deg)', offset: 0 }, { transform: 'perspective(1600px) rotateY(-90deg)', offset: 0.5 }, { transform: 'perspective(1600px) rotateY(0)' }], outF: [{ transform: 'perspective(1600px) rotateY(0)' }, { transform: 'perspective(1600px) rotateY(90deg)', offset: 0.5 }, { transform: 'perspective(1600px) rotateY(90deg)' }] };
    case 'cube': return { inF: [{ transform: 'perspective(1600px) translateX(50%) rotateY(-90deg) translateX(50%)' }, { transform: 'perspective(1600px) translateX(0) rotateY(0) translateX(0)' }], outF: [{ transform: 'perspective(1600px) translateX(0) rotateY(0) translateX(0)' }, { transform: 'perspective(1600px) translateX(-50%) rotateY(90deg) translateX(-50%)' }] };
    case 'gallery': return { inF: [{ transform: 'translateX(100%) scale(.8)' }, { transform: 'translateX(0) scale(1)' }], outF: [{ transform: 'translateX(0) scale(1)' }, { transform: 'translateX(-100%) scale(.8)' }] };
    default: return null;
  }
}

/* ---------- Presenting (full screen) and presenter view (second window) ---------- */
export function present(deck, start = 0, { presenter = false } = {}) {
  const N = deck.slides.length;
  const showable = (n) => !deck.slides[n]?.skip;
  const firstShown = (n, dir = 1) => { for (let x = n; x >= 0 && x < N; x += dir) if (showable(x)) return x; return -1; };
  let i = firstShown(Math.max(0, Math.min(N - 1, start))); if (i < 0) i = firstShown(0); if (i < 0) i = 0; // every slide skipped: show them anyway
  let step = 0, steps = S.animationSteps(deck.slides[i]);
  const started = Date.now();
  const ov = document.createElement('div');
  ov.className = 'deck-present'; ov.tabIndex = 0; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Presentation');
  document.body.appendChild(ov);
  let pw = null; let laser = false, blank = null, typed = '', auto = 0, loop = false, autoTimer = null;
  const H = S.heightFor(deck.ratio);
  const scaleK = () => Math.min(window.innerWidth / S.W, window.innerHeight / H);
  ov.innerHTML = `<div class="deck-present-area"></div><div class="deck-blank" hidden></div><div class="deck-laser" hidden></div><div class="deck-goto" hidden></div>
    <div class="deck-present-bar"><button type="button" data-p="prev" aria-label="Previous">${icon('chevronLeft', { size: 18 })}</button><span class="deck-count"></span><button type="button" data-p="next" aria-label="Next">${icon('chevronRight', { size: 18 })}</button><button type="button" data-p="options" aria-label="Slideshow options" aria-haspopup="menu">⋮</button><button type="button" data-p="notes">Presenter view</button><button type="button" data-p="exit">Exit</button></div>`;
  const area = ov.querySelector('.deck-present-area');
  const stageHtml = (n) => { const k = scaleK(); return `<div class="deck-present-stage" style="width:${S.W * k}px;height:${H * k}px">${slideFrame(deck, deck.slides[n], { live: true })}</div>`; };
  const fit = (el) => { el.querySelectorAll('.sl-frame').forEach((f) => f.style.setProperty('--k', String(scaleK()))); requestAnimationFrame(() => fitText(el)); };
  /** Draw slide n with animation steps up to `upTo` already applied. */
  function show(n, upTo, { transition = false, back = false } = {}) {
    const old = area.querySelector('.deck-present-stage');
    const tmp = document.createElement('div'); tmp.innerHTML = stageHtml(n); const stage = tmp.firstElementChild;
    const hidden = stateAt(deck.slides[n], S.animationSteps(deck.slides[n]), upTo);
    for (const id of hidden) { const el = stage.querySelector(`.sl-item[data-id="${id}"]`); if (el) el.style.visibility = 'hidden'; }
    const tr = transition && !back && !reduceMotion() && deck.slides[n].tr ? transitionFrames(deck.slides[n].tr.type) : null;
    if (old && tr) {
      const dur = deck.slides[n].tr.dur * 1000; stage.classList.add('incoming'); area.appendChild(stage); fit(stage);
      const inA = stage.animate(tr.inF, { duration: dur, easing: 'ease-in-out', fill: 'both' });
      if (tr.outF) old.animate(tr.outF, { duration: dur, easing: 'ease-in-out', fill: 'both' });
      inA.onfinish = () => { old.remove(); stage.classList.remove('incoming'); inA.cancel(); };
    } else { area.innerHTML = ''; area.appendChild(stage); fit(stage); }
    return stage;
  }
  const count = () => { const shownIdx = deck.slides.map((_, x) => x).filter(showable); ov.querySelector('.deck-count').textContent = `${(shownIdx.indexOf(i) + 1) || i + 1} / ${shownIdx.length || N}`; };
  function go(n, { back = false } = {}) {
    if (n < 0 || n >= N) return false;
    i = n; steps = S.animationSteps(deck.slides[i]);
    step = back ? steps.length - 1 : 0; // going back shows the slide fully built (Google Slides)
    const stage = show(i, step, { transition: true, back });
    if (!back && steps[0].length) playStep(stage, steps[0]); // animations that start with the slide
    count(); drawPresenter(); restartAuto(); return true;
  }
  const nextIndex = (dir) => { const n = firstShown(i + dir, dir); return n; };
  function next() {
    if (step + 1 < steps.length) { step += 1; playStep(area.querySelector('.deck-present-stage:last-child'), steps[step]); drawPresenter(); restartAuto(); return; }
    const n = nextIndex(1);
    if (n >= 0) go(n); else if (loop) go(firstShown(0)); else showEnd();
  }
  function prev() {
    if (area.querySelector('.deck-end')) { go(i, { back: true }); return; }
    if (step > 0) { step -= 1; show(i, step); drawPresenter(); return; }
    const n = nextIndex(-1); if (n >= 0) go(n, { back: true });
  }
  function showEnd() { area.innerHTML = '<div class="deck-end">End of slideshow. Click or press Esc to exit.</div>'; clearTimeout(autoTimer); }
  function restartAuto() { clearTimeout(autoTimer); if (auto) autoTimer = setTimeout(next, auto * 1000); }
  const exit = () => { document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', redraw); clearInterval(tick); clearTimeout(autoTimer); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); pw?.close(); ov.remove(); };
  const redraw = () => { if (!area.querySelector('.deck-end')) show(i, step); };
  const setBlank = (c) => { blank = blank === c ? null : c; const b = ov.querySelector('.deck-blank'); b.hidden = !blank; b.style.background = blank || ''; };
  const setLaser = (on) => { laser = on; ov.classList.toggle('laser-on', laser); ov.querySelector('.deck-laser').hidden = !laser; };
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    const k = e.key;
    if (blank && !['b', 'B', 'w', 'W', '.', ','].includes(k)) { e.preventDefault(); setBlank(null); return; } // any key returns from a black/white screen
    if (/^[0-9]$/.test(k)) { typed += k; const g = ov.querySelector('.deck-goto'); g.hidden = false; g.textContent = `Go to slide ${typed}`; return; }
    if (k === 'Enter' && typed) { e.preventDefault(); const n = Number(typed) - 1; typed = ''; ov.querySelector('.deck-goto').hidden = true; if (n >= 0 && n < N) go(n); return; }
    typed = ''; ov.querySelector('.deck-goto').hidden = true;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') { e.preventDefault(); go(firstShown(0)); }
    else if (k === 'End') { e.preventDefault(); go(firstShown(N - 1, -1)); }
    else if (k === 'b' || k === 'B' || k === '.') { e.preventDefault(); setBlank('#000'); }
    else if (k === 'w' || k === 'W' || k === ',') { e.preventDefault(); setBlank('#fff'); }
    else if (k === 'l' || k === 'L') { e.preventDefault(); setLaser(!laser); }
    else if (k === 's' || k === 'S') { e.preventDefault(); openPresenter(); }
    else if (k === 'f' || k === 'F') { e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen?.(); else ov.requestFullscreen?.().catch(() => {}); }
    else if (k === 'Escape') { e.preventDefault(); exit(); }
  };
  ov.addEventListener('mousemove', (e) => { if (!laser) return; const l = ov.querySelector('.deck-laser'); l.style.left = `${e.clientX}px`; l.style.top = `${e.clientY}px`; if (pw && !pw.closed) { /* the presenter sees it on the slide */ } });
  function optionsMenu(anchor) {
    const items = [['Auto-play: off', 0], ['Every 2 seconds', 2], ['Every 3 seconds', 3], ['Every 5 seconds', 5], ['Every 10 seconds', 10], ['Every 15 seconds', 15], ['Every 30 seconds', 30], ['Every minute', 60]].map(([l, v]) => ({ label: `${auto === v ? '✓ ' : '    '}${l}`, run: () => { auto = v; restartAuto(); } }));
    openMenu(anchor, [...items, 'divider', { label: `${loop ? '✓ ' : '    '}Loop`, run: () => { loop = !loop; } }, { label: `${laser ? '✓ ' : '    '}Laser pointer (L)`, run: () => setLaser(!laser) }, { label: 'Black screen (B)', run: () => setBlank('#000') }, { label: 'White screen (W)', run: () => setBlank('#fff') }, { label: 'Full screen (F)', run: () => (document.fullscreenElement ? document.exitFullscreen?.() : ov.requestFullscreen?.().catch(() => {})) }, { label: 'Presenter view (S)', run: () => openPresenter() }], { align: 'end' });
    const m = document.body.lastElementChild; if (m?.classList.contains('menu')) ov.appendChild(m); // inside the slideshow: a full-screen element hides everything outside it
  }
  function drawPresenter() {
    if (!pw || pw.closed) return;
    const d = pw.document;
    const frame = (n, width) => `<div style="width:${width}px">${n >= 0 && deck.slides[n] ? slideFrame(deck, deck.slides[n]) : '<div class="pv-end">End of slideshow</div>'}</div>`;
    d.getElementById('pv-cur').innerHTML = frame(i, 620);
    d.getElementById('pv-next').innerHTML = step + 1 < steps.length ? `<p class="pv-step">Next: animation ${step + 1} of ${steps.length - 1} on this slide</p>${frame(i, 300)}` : frame(nextIndex(1), 300);
    d.querySelectorAll('.sl-frame').forEach((f) => f.style.setProperty('--k', String(f.parentElement.clientWidth / S.W)));
    d.getElementById('pv-notes').textContent = deck.slides[i].notes || 'No speaker notes for this slide.';
    d.getElementById('pv-count').textContent = `Slide ${i + 1} of ${N}`;
  }
  function openPresenter() {
    if (pw && !pw.closed) { pw.focus(); return; }
    pw = window.open('', `presenter-${Date.now()}`, 'width=1120,height=720');
    if (!pw) { toast('Allow pop-ups for this site to open presenter view.', { tone: 'error' }); return; }
    const css = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => `<link rel="stylesheet" href="${l.href}">`).join('');
    pw.document.write(`<!doctype html><html><head><title>Presenter view</title>${css}</head><body class="presenter-view">
      <header><b id="pv-count"></b><span id="pv-timer">00:00</span><span class="pv-btns"><button id="pv-prev" class="btn btn-plain btn-sm">Previous</button><button id="pv-next-btn" class="btn btn-primary btn-sm">Next</button></span></header>
      <main><section><h2>Current slide</h2><div id="pv-cur"></div></section><aside><h2>Next</h2><div id="pv-next"></div><h2>Speaker notes</h2><div id="pv-notes"></div></aside></main></body></html>`);
    pw.document.close();
    pw.document.getElementById('pv-prev').addEventListener('click', () => prev());
    pw.document.getElementById('pv-next-btn').addEventListener('click', () => next());
    pw.document.addEventListener('keydown', onKey, true);
    setTimeout(drawPresenter, 50);
  }
  if (presenter) openPresenter(); // opened inside the click, so the browser allows the window

  const tick = setInterval(() => {
    if (!pw || pw.closed) return;
    const sec = Math.floor((Date.now() - started) / 1000);
    pw.document.getElementById('pv-timer').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }, 1000);
  ov.addEventListener('click', (e) => {
    const a = e.target.closest('.sl-rich a[href]');
    if (a) { e.preventDefault(); const href = a.getAttribute('href'); const m = /^#slide=(\d+)$/.exec(href); if (m) go(Number(m[1]) - 1); else window.open(href, '_blank', 'noopener'); return; }
    const fileCard = e.target.closest('.sl-file[data-file]');
    if (fileCard) { e.preventDefault(); if (e.target.closest('[data-fe="prev"], [data-fe="next"]')) return; try { const r = JSON.parse(fileCard.dataset.file); window.open(`${location.pathname}#/files/${r.id}`, '_blank', 'noopener'); } catch { /* ignore */ } return; } // a linked file opens in a new tab
    if (e.target.closest('.sl-video iframe, .menu')) return; // a menu choice isn't a click on the slide
    if (blank) { setBlank(null); return; }
    const b = e.target.closest('[data-p]');
    if (!b) { if (area.querySelector('.deck-end')) exit(); else next(); return; }
    if (b.dataset.p === 'prev') prev();
    if (b.dataset.p === 'next') next();
    if (b.dataset.p === 'options') optionsMenu(b);
    if (b.dataset.p === 'notes') openPresenter();
    if (b.dataset.p === 'exit') exit();
  });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', redraw);
  go(i);
  ov.focus();
  ov.requestFullscreen?.().catch(() => {});
  return { go, next, prev, exit, openPresenter, get index() { return i; }, get step() { return step; } };
}

/* ---------- Printing: one slide per page (optionally with speaker notes) ---------- */
export async function printDeck(json, { notes = false } = {}) {
  const deck = parse(json);
  document.getElementById('print-root')?.remove();
  document.getElementById('print-page-style')?.remove();
  const page = notes ? { w: 8.5, h: 11 } : deck.ratio === '4:3' ? { w: 10, h: 7.5 } : { w: 11, h: 6.1875 };
  const slideW = notes ? 7.5 : page.w; // inches
  const root = document.createElement('div');
  root.id = 'print-root';
  root.className = 'measuring print-deck';
  root.innerHTML = deck.slides.map((s, i) => `<section class="print-deck-page${notes ? ' with-notes' : ''}" style="width:${page.w}in;height:${page.h}in">
      <div class="print-deck-slide" style="width:${slideW}in">${slideFrame(deck, s)}</div>
      ${notes ? `<div class="print-deck-notes"><b>Slide ${i + 1}</b><p>${esc(s.notes || '').replace(/\n/g, '<br>') || '<em>No speaker notes.</em>'}</p></div>` : ''}
    </section>`).join('');
  document.body.appendChild(root);
  root.querySelectorAll('.sl-frame').forEach((f) => { f.dataset.fit = '1'; f.style.setProperty('--k', String((slideW * 96) / S.W)); });
  const style = document.createElement('style');
  style.id = 'print-page-style';
  style.textContent = `@page { size: ${page.w}in ${page.h}in; margin: 0; }`;
  document.head.appendChild(style);
  const imgs = [...root.querySelectorAll('img')].filter((im) => !im.complete);
  await Promise.race([Promise.all(imgs.map((im) => new Promise((r) => { im.onload = im.onerror = r; }))), new Promise((r) => setTimeout(r, 2500))]);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.remove(); style.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

/* ---------- The editor: Google Slides-style, in slides-app.js ---------- */
export { mountSlides as mountDeck } from './slides-app.js';

/** Plain-text outline of a deck (Markdown downloads). */
export function deckOutline(json) {
  const deck = parse(json);
  return deck.slides.map((s, i) => {
    const lines = [...s.items].sort((a, b) => a.y - b.y || a.x - b.x).filter((it) => it.html).map((it) => S.htmlToParagraphs(it.html).map((p) => `${p.bullet ? '- ' : ''}${p.runs.map((r) => r.text).join('')}`).join('\n'));
    return `### Slide ${i + 1}\n\n${lines.join('\n\n') || '_(no text)_'}${s.notes ? `\n\n> Notes: ${s.notes.replace(/\n/g, ' ')}` : ''}`;
  }).join('\n\n');
}
