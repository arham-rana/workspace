// Spreadsheets: the entry point used by the rest of the app.
// - staticSheetHtml(json): read-only tables (reading view, print, PDF)   → sheet-core.js
// - mountSheet(root, json, opts): the Excel-style grid                    → sheet-app.js
import { sheetEngine, loadSheetEngine } from './sheet-lazy.js';
import { bind, setChartRenderer } from './sheet-core.js';
import { chartSvg } from './charts.js';

setChartRenderer(chartSvg); // charts linked to cells use the app's chart drawing
import { mountApp } from './sheet-app.js';

export { staticSheetHtml } from './sheet-core.js';

export function mountSheet(root, json, opts = {}) {
  if (sheetEngine()) { bind(sheetEngine()); return mountApp(root, json, opts); }
  // The formula engine is a separate download: show a moment's wait the first time.
  root.innerHTML = '<p class="sheet-wait">Loading spreadsheet…</p>';
  let latest = json, ctl = null, gone = false;
  loadSheetEngine().then((engine) => { if (gone) return; bind(engine); root.innerHTML = ''; ctl = mountApp(root, latest, opts); });
  return { update(next) { latest = next; ctl?.update(next); }, destroy() { gone = true; ctl?.destroy(); } };
}
