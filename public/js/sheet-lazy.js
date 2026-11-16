// The spreadsheet engine (with its formula libraries) is a separate download, loaded only when a
// spreadsheet is shown. Views redraw once it arrives ("sheets:ready").
let engine = null;
let loading = null;
export const sheetEngine = () => engine;
export function loadSheetEngine() {
  return (loading ||= import('/shared/sheet-engine.mjs').then((m) => {
    engine = m;
    window.dispatchEvent(new Event('sheets:ready'));
    return m;
  }));
}
/** A new, empty spreadsheet (no engine needed). */
export const emptySheetJson = (rows = 40, cols = 12) => ({ sheets: [{ name: 'Sheet1', r: rows, c: cols, cells: {}, w: {}, h: {}, merges: [], freeze: { r: 0, c: 0 }, filter: null, cf: [] }] });
