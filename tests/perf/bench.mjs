// Measure the work done after each spreadsheet edit. Run: node tests/perf/bench.mjs
import * as E from '../../shared/sheet-engine.mjs';
import { ledger } from './workbooks.mjs';
const time = (fn, n = 3) => { let best = Infinity, out; for (let i = 0; i < n; i++) { const t = performance.now(); out = fn(); best = Math.min(best, performance.now() - t); } return [best, out]; };
for (const rows of [500, 5000, 20000]) {
  const wb = E.normalizeWorkbook(ledger(rows));
  const formulas = Object.values(wb.sheets[0].cells).filter((c) => String(c.v).startsWith('=')).length;
  const [tEval, vals] = time(() => E.evaluateWorkbook(wb));
  const [tNorm] = time(() => E.normalizeWorkbook(wb));
  const [tShow] = time(() => E.displayFrom(wb.sheets[0], vals.Ledger));
  console.log(`${String(rows).padStart(6)} rows, ${String(Object.keys(wb.sheets[0].cells).length).padStart(6)} cells, ${String(formulas).padStart(6)} formulas | full recalculation ${tEval.toFixed(0).padStart(5)} ms | tidy ${tNorm.toFixed(0).padStart(4)} ms | display ${tShow.toFixed(0).padStart(4)} ms | K1 = ${vals.Ledger.K1.value}`);
}

// After an edit: recalculating only what the edit affects
{
  const rows = 20000; let wb = E.normalizeWorkbook(ledger(rows)); const calc = E.createCalculator(); calc.evaluate(wb);
  const edit = (label, ref, v) => { const next = structuredClone(wb); next.sheets[0].cells[ref] = { v }; wb = E.normalizeWorkbook(next); const t = performance.now(); const vals = calc.evaluate(wb, { tidy: false }); console.log(`20000 rows, edit ${label.padEnd(28)} ${String(Math.round(performance.now() - t)).padStart(5)} ms   (K1 = ${vals.Ledger.K1.value})`); };
  edit('a value near the end', `B${rows}`, '1');
  edit('a value in the middle', `B${rows / 2}`, '2');
  edit('a lookup-table price', 'I3', '9');
}
