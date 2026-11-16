// Shapes for presentations, in Google Slides' groups. Each draws an SVG path for a box of width w and height h,
// and carries the PowerPoint preset name (prst) used for .pptx export/import.
const f = (n) => Math.round(n * 100) / 100;
const poly = (pts) => (w, h) => `M${pts.map(([x, y]) => `${f(x * w)} ${f(y * h)}`).join(' L')} Z`;
const ellipseD = (cx, cy, rx, ry) => `M${f(cx - rx)} ${f(cy)} a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0 a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0 Z`;
const star = (n, inner) => (w, h) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n; const r = i % 2 ? inner : 0.5; pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]); } return poly(pts)(w, h); };
const ngon = (n) => (w, h) => { const pts = []; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]); } return poly(pts)(w, h); };
const roundRect = (k) => (w, h) => { const r = Math.min(w, h) * k; return `M${f(r)} 0 H${f(w - r)} Q${f(w)} 0 ${f(w)} ${f(r)} V${f(h - r)} Q${f(w)} ${f(h)} ${f(w - r)} ${f(h)} H${f(r)} Q0 ${f(h)} 0 ${f(h - r)} V${f(r)} Q0 0 ${f(r)} 0 Z`; };
const cloudD = (w, h) => { const c = [[0.25, 0.55, 0.22, 0.28], [0.42, 0.32, 0.22, 0.26], [0.62, 0.3, 0.2, 0.24], [0.78, 0.5, 0.2, 0.26], [0.6, 0.7, 0.24, 0.24], [0.36, 0.72, 0.22, 0.22]]; return c.map(([x, y, rx, ry]) => ellipseD(x * w, y * h, rx * w, ry * h)).join(' '); };

export const SHAPE_GROUPS = ['Shapes', 'Arrows', 'Callouts', 'Flowchart', 'Equation'];
export const SHAPE_LIB = {
  // Shapes
  rect: { label: 'Rectangle', group: 'Shapes', prst: 'rect', d: poly([[0, 0], [1, 0], [1, 1], [0, 1]]) },
  round: { label: 'Rounded rectangle', group: 'Shapes', prst: 'roundRect', d: roundRect(0.16) },
  snipRect: { label: 'Snip corner rectangle', group: 'Shapes', prst: 'snip1Rect', d: poly([[0, 0], [0.84, 0], [1, 0.16], [1, 1], [0, 1]]) },
  ellipse: { label: 'Oval', group: 'Shapes', prst: 'ellipse', d: (w, h) => ellipseD(w / 2, h / 2, w / 2, h / 2) },
  triangle: { label: 'Triangle', group: 'Shapes', prst: 'triangle', d: poly([[0.5, 0], [1, 1], [0, 1]]) },
  rtTriangle: { label: 'Right triangle', group: 'Shapes', prst: 'rtTriangle', d: poly([[0, 0], [1, 1], [0, 1]]) },
  parallelogram: { label: 'Parallelogram', group: 'Shapes', prst: 'parallelogram', d: poly([[0.25, 0], [1, 0], [0.75, 1], [0, 1]]) },
  trapezoid: { label: 'Trapezoid', group: 'Shapes', prst: 'trapezoid', d: poly([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]) },
  diamond: { label: 'Diamond', group: 'Shapes', prst: 'diamond', d: poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) },
  pentagon: { label: 'Pentagon', group: 'Shapes', prst: 'pentagon', d: ngon(5) },
  hexagon: { label: 'Hexagon', group: 'Shapes', prst: 'hexagon', d: poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]) },
  octagon: { label: 'Octagon', group: 'Shapes', prst: 'octagon', d: poly([[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]]) },
  plus: { label: 'Cross', group: 'Shapes', prst: 'plus', d: poly([[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]]) },
  donut: { label: 'Donut', group: 'Shapes', prst: 'donut', d: (w, h) => `${ellipseD(w / 2, h / 2, w / 2, h / 2)} ${ellipseD(w / 2, h / 2, w * 0.3, h * 0.3)}`, evenodd: true },
  frame: { label: 'Frame', group: 'Shapes', prst: 'frame', d: (w, h) => { const t = Math.min(w, h) * 0.12; return `M0 0 H${f(w)} V${f(h)} H0 Z M${f(t)} ${f(t)} V${f(h - t)} H${f(w - t)} V${f(t)} Z`; }, evenodd: true },
  can: { label: 'Cylinder', group: 'Shapes', prst: 'can', d: (w, h) => { const ry = h * 0.12; return `M0 ${f(ry)} A${f(w / 2)} ${f(ry)} 0 0 1 ${f(w)} ${f(ry)} V${f(h - ry)} A${f(w / 2)} ${f(ry)} 0 0 1 0 ${f(h - ry)} Z M0 ${f(ry)} A${f(w / 2)} ${f(ry)} 0 0 0 ${f(w)} ${f(ry)}`; } },
  cube: { label: 'Cube', group: 'Shapes', prst: 'cube', d: (w, h) => { const d = Math.min(w, h) * 0.25; return `M0 ${f(d)} L${f(d)} 0 H${f(w)} V${f(h - d)} L${f(w - d)} ${f(h)} H0 Z M0 ${f(d)} H${f(w - d)} L${f(w)} 0 M${f(w - d)} ${f(d)} V${f(h)}`; } },
  heart: { label: 'Heart', group: 'Shapes', prst: 'heart', d: (w, h) => `M${f(w / 2)} ${f(h)} C${f(-w * 0.2)} ${f(h * 0.55)} ${f(w * 0.05)} ${f(-h * 0.15)} ${f(w / 2)} ${f(h * 0.22)} C${f(w * 0.95)} ${f(-h * 0.15)} ${f(w * 1.2)} ${f(h * 0.55)} ${f(w / 2)} ${f(h)} Z` },
  lightningBolt: { label: 'Lightning bolt', group: 'Shapes', prst: 'lightningBolt', d: poly([[0.38, 0], [0.62, 0.33], [0.52, 0.38], [0.8, 0.66], [0.68, 0.7], [1, 1], [0.45, 0.76], [0.56, 0.71], [0.18, 0.47], [0.3, 0.42], [0, 0.16]]) },
  moon: { label: 'Moon', group: 'Shapes', prst: 'moon', d: (w, h) => `M${f(w)} 0 A${f(w)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h)} A${f(w * 0.55)} ${f(h / 2)} 0 1 1 ${f(w)} 0 Z` },
  cloud: { label: 'Cloud', group: 'Shapes', prst: 'cloud', d: cloudD },
  star4: { label: '4-point star', group: 'Shapes', prst: 'star4', d: star(4, 0.19) },
  star5: { label: '5-point star', group: 'Shapes', prst: 'star5', d: star(5, 0.2) },
  star6: { label: '6-point star', group: 'Shapes', prst: 'star6', d: star(6, 0.29) },
  star8: { label: '8-point star', group: 'Shapes', prst: 'star8', d: star(8, 0.38) },
  // Arrows
  arrow: { label: 'Right arrow', group: 'Arrows', prst: 'rightArrow', d: poly([[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]]) },
  leftArrow: { label: 'Left arrow', group: 'Arrows', prst: 'leftArrow', d: poly([[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]]) },
  upArrow: { label: 'Up arrow', group: 'Arrows', prst: 'upArrow', d: poly([[0.25, 1], [0.25, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1]]) },
  downArrow: { label: 'Down arrow', group: 'Arrows', prst: 'downArrow', d: poly([[0.25, 0], [0.25, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.75, 0.6], [0.75, 0]]) },
  leftRightArrow: { label: 'Left-right arrow', group: 'Arrows', prst: 'leftRightArrow', d: poly([[0, 0.5], [0.25, 0], [0.25, 0.25], [0.75, 0.25], [0.75, 0], [1, 0.5], [0.75, 1], [0.75, 0.75], [0.25, 0.75], [0.25, 1]]) },
  upDownArrow: { label: 'Up-down arrow', group: 'Arrows', prst: 'upDownArrow', d: poly([[0.5, 0], [1, 0.25], [0.75, 0.25], [0.75, 0.75], [1, 0.75], [0.5, 1], [0, 0.75], [0.25, 0.75], [0.25, 0.25], [0, 0.25]]) },
  chevron: { label: 'Chevron', group: 'Arrows', prst: 'chevron', d: poly([[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]]) },
  homePlate: { label: 'Pentagon arrow', group: 'Arrows', prst: 'homePlate', d: poly([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1]]) },
  notchedRightArrow: { label: 'Notched arrow', group: 'Arrows', prst: 'notchedRightArrow', d: poly([[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75], [0.15, 0.5]]) },
  // Callouts
  wedgeRectCallout: { label: 'Rectangular callout', group: 'Callouts', prst: 'wedgeRectCallout', d: poly([[0, 0], [1, 0], [1, 0.75], [0.42, 0.75], [0.2, 1], [0.25, 0.75], [0, 0.75]]) },
  wedgeRoundRectCallout: { label: 'Rounded callout', group: 'Callouts', prst: 'wedgeRoundRectCallout', d: (w, h) => { const r = Math.min(w, h * 0.75) * 0.14, b = h * 0.75; return `M${f(r)} 0 H${f(w - r)} Q${f(w)} 0 ${f(w)} ${f(r)} V${f(b - r)} Q${f(w)} ${f(b)} ${f(w - r)} ${f(b)} H${f(w * 0.42)} L${f(w * 0.2)} ${f(h)} L${f(w * 0.25)} ${f(b)} H${f(r)} Q0 ${f(b)} 0 ${f(b - r)} V${f(r)} Q0 0 ${f(r)} 0 Z`; } },
  wedgeEllipseCallout: { label: 'Oval callout', group: 'Callouts', prst: 'wedgeEllipseCallout', d: (w, h) => `M${f(w * 0.3)} ${f(h * 0.7)} A${f(w / 2)} ${f(h * 0.38)} 0 1 1 ${f(w * 0.45)} ${f(h * 0.75)} L${f(w * 0.15)} ${f(h)} Z` },
  cloudCallout: { label: 'Cloud callout', group: 'Callouts', prst: 'cloudCallout', d: (w, h) => `${cloudD(w, h * 0.85)} ${ellipseD(w * 0.2, h * 0.9, w * 0.05, h * 0.04)} ${ellipseD(w * 0.12, h * 0.97, w * 0.03, h * 0.025)}` },
  // Flowchart
  flowChartProcess: { label: 'Process', group: 'Flowchart', prst: 'flowChartProcess', d: poly([[0, 0], [1, 0], [1, 1], [0, 1]]) },
  flowChartDecision: { label: 'Decision', group: 'Flowchart', prst: 'flowChartDecision', d: poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) },
  flowChartTerminator: { label: 'Terminator', group: 'Flowchart', prst: 'flowChartTerminator', d: roundRect(0.5) },
  flowChartInputOutput: { label: 'Data', group: 'Flowchart', prst: 'flowChartInputOutput', d: poly([[0.2, 0], [1, 0], [0.8, 1], [0, 1]]) },
  flowChartDocument: { label: 'Document', group: 'Flowchart', prst: 'flowChartDocument', d: (w, h) => `M0 0 H${f(w)} V${f(h * 0.82)} C${f(w * 0.75)} ${f(h * 0.7)} ${f(w * 0.5)} ${f(h * 1.1)} 0 ${f(h * 0.88)} Z` },
  flowChartPredefinedProcess: { label: 'Predefined process', group: 'Flowchart', prst: 'flowChartPredefinedProcess', d: (w, h) => `M0 0 H${f(w)} V${f(h)} H0 Z M${f(w * 0.12)} 0 V${f(h)} M${f(w * 0.88)} 0 V${f(h)}` },
  flowChartManualInput: { label: 'Manual input', group: 'Flowchart', prst: 'flowChartManualInput', d: poly([[0, 0.2], [1, 0], [1, 1], [0, 1]]) },
  flowChartPreparation: { label: 'Preparation', group: 'Flowchart', prst: 'flowChartPreparation', d: poly([[0.2, 0], [0.8, 0], [1, 0.5], [0.8, 1], [0.2, 1], [0, 0.5]]) },
  flowChartConnector: { label: 'Connector', group: 'Flowchart', prst: 'flowChartConnector', d: (w, h) => ellipseD(w / 2, h / 2, w / 2, h / 2) },
  flowChartManualOperation: { label: 'Manual operation', group: 'Flowchart', prst: 'flowChartManualOperation', d: poly([[0, 0], [1, 0], [0.8, 1], [0.2, 1]]) },
  flowChartPunchedCard: { label: 'Card', group: 'Flowchart', prst: 'flowChartPunchedCard', d: poly([[0.2, 0], [1, 0], [1, 1], [0, 1], [0, 0.2]]) },
  // Equation
  mathPlus: { label: 'Plus', group: 'Equation', prst: 'mathPlus', d: poly([[0.4, 0.1], [0.6, 0.1], [0.6, 0.4], [0.9, 0.4], [0.9, 0.6], [0.6, 0.6], [0.6, 0.9], [0.4, 0.9], [0.4, 0.6], [0.1, 0.6], [0.1, 0.4], [0.4, 0.4]]) },
  mathMinus: { label: 'Minus', group: 'Equation', prst: 'mathMinus', d: poly([[0.1, 0.4], [0.9, 0.4], [0.9, 0.6], [0.1, 0.6]]) },
  mathMultiply: { label: 'Multiply', group: 'Equation', prst: 'mathMultiply', d: poly([[0.2, 0.1], [0.5, 0.4], [0.8, 0.1], [0.9, 0.2], [0.6, 0.5], [0.9, 0.8], [0.8, 0.9], [0.5, 0.6], [0.2, 0.9], [0.1, 0.8], [0.4, 0.5], [0.1, 0.2]]) },
  mathDivide: { label: 'Divide', group: 'Equation', prst: 'mathDivide', d: (w, h) => `${poly([[0.1, 0.42], [0.9, 0.42], [0.9, 0.58], [0.1, 0.58]])(w, h)} ${ellipseD(w / 2, h * 0.22, w * 0.09, h * 0.09)} ${ellipseD(w / 2, h * 0.78, w * 0.09, h * 0.09)}` },
  mathEqual: { label: 'Equal', group: 'Equation', prst: 'mathEqual', d: (w, h) => `${poly([[0.1, 0.25], [0.9, 0.25], [0.9, 0.42], [0.1, 0.42]])(w, h)} ${poly([[0.1, 0.58], [0.9, 0.58], [0.9, 0.75], [0.1, 0.75]])(w, h)}` },
  mathNotEqual: { label: 'Not equal', group: 'Equation', prst: 'mathNotEqual', d: (w, h) => `${poly([[0.1, 0.25], [0.9, 0.25], [0.9, 0.42], [0.1, 0.42]])(w, h)} ${poly([[0.1, 0.58], [0.9, 0.58], [0.9, 0.75], [0.1, 0.75]])(w, h)} ${poly([[0.6, 0.05], [0.72, 0.1], [0.4, 0.95], [0.28, 0.9]])(w, h)}` },
};
export const shapePath = (key, w, h) => (SHAPE_LIB[key] || SHAPE_LIB.rect).d(Math.max(1, w), Math.max(1, h));
/** PowerPoint preset name → our shape key. */
export const PRST_TO_SHAPE = Object.fromEntries(Object.entries(SHAPE_LIB).map(([k, v]) => [v.prst, k]));
Object.assign(PRST_TO_SHAPE, { roundRect: 'round', rightArrow: 'arrow', flowChartAlternateProcess: 'round', snip2SameRect: 'snipRect', round1Rect: 'round', star7: 'star6', star10: 'star8', star12: 'star8', heptagon: 'hexagon', decagon: 'octagon', dodecagon: 'octagon', ellipseRibbon: 'rect' });
