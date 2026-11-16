// Spreadsheet engine: formats, formulas, arrays, structure changes, data tools, tables, PivotTables, Goal Seek.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../shared/sheet-engine.mjs';

const show = (cells, extra = {}) => E.displayWorkbook({ sheets: [{ name: 'S', cells, ...extra }] }).S;
const v = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, { v: String(x) }]));

test('Excel number format codes', () => {
  const F = (val, code) => E.formatCode(val, code).text;
  assert.equal(F(1234.567, '#,##0.00'), '1,234.57');
  assert.equal(F(-1234.5, '#,##0.00;[Red](#,##0.00)'), '(1,234.50)');
  assert.equal(E.formatCode(-1, '#,##0;[Red]-#,##0').color, '#ff0000');
  assert.equal(F(0, '#,##0;-#,##0;"zero"'), 'zero');
  assert.equal(F(0.256, '0.0%'), '25.6%');
  assert.equal(F(12345678, '#,##0,,"M"'), '12M');
  assert.equal(F(0.000123, '0.00E+00'), '1.23E-04');
  assert.equal(F(2.375, '# ?/?'), '2 3/8');
  assert.equal(F(46315, 'dddd, mmmm d, yyyy'), 'Tuesday, October 20, 2026');
  assert.equal(F(1.5, '[h]:mm'), '36:00');
  assert.equal(F(5, '00000'), '00005');
  assert.equal(F('Hi', '@" there"'), 'Hi there');
});

test('typed values: money, percent, thousands, times', () => {
  assert.deepEqual([E.parseInput('$1,200').v, E.parseInput('$1,200').f], ['1200', 'currency']);
  assert.equal(E.parseInput('50%').v, '0.5');
  assert.equal(E.parseInput('1,000').v, '1000');
  const t = E.parseInput('9:30 PM'); assert.equal(Number(t.v).toFixed(6), (21.5 / 24).toFixed(6)); assert.equal(t.nf, 'h:mm AM/PM');
});

test('formulas, cross-sheet references and cycles', () => {
  const d = E.displayWorkbook({ sheets: [{ name: 'A', cells: v({ A1: 2, A2: 3, A3: '=A1*A2', A4: '=SUM(A1:A3)', A5: '=A5+1' }) }, { name: 'B', cells: v({ A1: '=A!A4*2' }) }] });
  assert.equal(d.A.A3.text, '6'); assert.equal(d.A.A4.text, '11'); assert.equal(d.B.A1.text, '22'); assert.equal(d.A.A5.text, '#CYCLE!');
});

test('array maths and spill formulas (Excel 365)', () => {
  const d = show(v({ A2: 'apple', A3: 'pear', A4: 'apple', A5: 'kiwi', B2: 3, B3: 1, B4: 5, B5: 2, C1: '=UNIQUE(A2:A5)', D1: '=COUNTA(C1#)', J1: '=FILTER(A2:A5,B2:B5>2)', K1: '=B2:B5*10', L1: '=SUMPRODUCT((A2:A5="apple")*B2:B5)', E1: '=SEQUENCE(3)', E2: 'x' }));
  assert.deepEqual(['C1', 'C2', 'C3'].map((k) => d[k].text), ['apple', 'pear', 'kiwi']);
  assert.equal(d.D1.text, '3');
  assert.deepEqual([d.J1.text, d.J2.text], ['apple', 'apple']);
  assert.deepEqual(['K1', 'K2', 'K3', 'K4'].map((k) => d[k].text), ['30', '10', '50', '20']);
  assert.equal(d.L1.text, '8');
  assert.equal(d.E1.text, '#SPILL!');
});

test('named ranges follow row changes and sheet renames', () => {
  const wb = { sheets: [{ name: 'S', cells: v({ A1: 1, A2: 2, A3: 3, C1: '=SUM(Nums)' }) }], names: { Nums: 'S!$A$1:$A$3' } };
  assert.equal(E.displayWorkbook(wb).S.C1.text, '6');
  assert.equal(E.changeRowsCols(wb, 0, 'row', 1, 1).names.Nums, 'S!$A$1:$A$4');
  assert.equal(E.changeRowsCols(wb, 0, 'row', 0, -1).names.Nums, 'S!$A$1:$A$2');
  assert.equal(E.renameSheet(wb, 0, 'Q1 Data').names.Nums, "'Q1 Data'!$A$1:$A$3");
});

test('inserting and deleting rows and cells adjusts formulas like Excel', () => {
  const wb = { sheets: [{ name: 'S', cells: v({ A1: 1, A2: 2, A3: 3, E9: '=SUM(A1:A3)', E10: '=A1*2' }) }] };
  const del = E.changeRowsCols(wb, 0, 'row', 0, -1).sheets[0].cells;
  assert.equal(del.E8.v, '=SUM(A1:A2)'); assert.equal(del.E9.v, '=#REF!*2');
  assert.equal(E.changeRowsCols(wb, 0, 'row', 1, 2).sheets[0].cells.E11.v, '=SUM(A1:A5)');
  const shifted = E.shiftCells({ sheets: [{ name: 'S', cells: v({ A1: 1, A2: 2, A3: 3, C1: '=SUM(A1:A3)' }) }] }, 0, { r1: 1, c1: 0, r2: 1, c2: 0 }, 'down');
  assert.equal(shifted.sheets[0].cells.C1.v, '=SUM(A1:A4)');
});

test('sort, remove duplicates and text to columns', () => {
  const s = { name: 'S', cells: v({ A1: 'Name', B1: 'Team', A2: 'Zoe', B2: 'Red', A3: 'Al', B3: 'Blue', A4: 'Bo', B4: 'Red', A5: 'Al', B5: 'Blue' }) };
  const vals = E.evaluateWorkbook({ sheets: [s] }).S;
  const so = E.sortRange(s, vals, { r1: 0, c1: 0, r2: 4, c2: 1 }, [{ col: 1, dir: 'asc' }, { col: 0, dir: 'desc' }], true);
  assert.deepEqual([2, 3, 4, 5].map((r) => so.cells[`A${r}`].v), ['Al', 'Al', 'Zoe', 'Bo']);
  assert.equal(E.removeDuplicates(s, vals, { r1: 0, c1: 0, r2: 4, c2: 1 }, [0, 1], true).removed, 1);
  const t = E.textToColumns({ cells: v({ A1: '"Doe, Jr",Jane,7' }) }, { r1: 0, c1: 0, r2: 0, c2: 0 }, { delims: ['comma'] });
  assert.deepEqual(['A1', 'B1', 'C1'].map((k) => t.sheet.cells[k].v), ['Doe, Jr', 'Jane', '7']);
});

test('data validation checks', () => {
  assert.deepEqual([5, 11, 2.5, ''].map((x) => E.dvCheck({ type: 'whole', op: 'between', v1: '1', v2: '10', blank: true }, x, String(x))), [true, false, false, true]);
  assert.equal(E.dvCheck({ type: 'list', v1: 'Yes, No' }, 'yes', 'yes'), true);
  assert.equal(E.dvCheck({ type: 'list', v1: 'Yes, No' }, 'maybe', 'maybe'), false);
});

test('tables and structured references', () => {
  const d = show(v({ A1: 'Item', B1: 'Qty', C1: 'Price', A2: 'Pen', B2: 3, C2: 2, A3: 'Ink', B3: 5, C3: 4, D2: '=[@Qty]*[@Price]', F1: '=SUM(Sales[Qty])', F2: '=ROWS(Sales[#Data])', F3: '=SUM(Sales[[Qty]:[Price]])' }), { tables: [{ name: 'Sales', range: 'A1:C3' }] });
  assert.equal(d.D2.text, '6'); assert.equal(d.F1.text, '8'); assert.equal(d.F2.text, '2'); assert.equal(d.F3.text, '14');
  assert.equal(E.tableStyleDef('medium2').head.bg, '#4472c4'); // Excel's default blue
});

test('PivotTables summarise and leave empty combinations blank', () => {
  const wb = { sheets: [{ name: 'Data', cells: v({ A1: 'Region', B1: 'Product', C1: 'Sales', A2: 'North', B2: 'Ink', C2: 5, A3: 'South', B3: 'Pens', C3: 20, A4: 'North', B4: 'Pens', C4: 7 }) }, { name: 'P', cells: {}, pivots: [{ id: 'p', src: 'Data!A1:C4', at: 'A1', rows: ['Region'], cols: ['Product'], vals: [{ f: 'Sales', fn: 'sum' }] }] }] };
  const out = E.refreshPivot(wb, 1, 'p').sheets[1];
  const g = E.parseRange(out.pivots[0].out); const grid = [];
  for (let r = g.r1; r <= g.r2; r++) { const row = []; for (let c = g.c1; c <= g.c2; c++) row.push(out.cells[E.cellKey(r, c)]?.v ?? ''); grid.push(row); }
  assert.deepEqual(grid.find((r) => r[0] === 'North'), ['North', '5', '7', '12']); // row grand total
  assert.deepEqual(grid.find((r) => r[0] === 'South'), ['South', '', '20', '20']); // no Ink sales in the South: blank
  assert.deepEqual(grid.at(-1), ['Grand Total', '5', '27', '32']);
});

test('Goal Seek finds an input value (and reports impossible targets)', () => {
  const r = E.goalSeek({ sheets: [{ name: 'S', cells: v({ A1: 1000, B1: 0.05, C1: '=PMT(B1/12,A1,-20000)' }) }] }, 'S', 'C1', 500, 'A1');
  assert.ok(r.ok); assert.ok(Math.abs(r.value - 43.8483) < 0.001);
  assert.equal(E.goalSeek({ sheets: [{ name: 'S', cells: v({ A1: 2, B1: '=A1^2' }) }] }, 'S', 'B1', -5, 'A1').ok, false);
});

test('precedents and dependents', () => {
  const wb = E.normalizeWorkbook({ sheets: [{ name: 'S', cells: v({ A1: 1, B1: '=A1*2', C1: '=SUM(A1:B1)' }) }] });
  assert.deepEqual(E.precedents(wb, wb.sheets[0], 'C1').map((x) => E.rangeRef(x.g)), ['A1:B1']);
  assert.deepEqual(E.dependents(wb, wb.sheets[0], 'A1').map((x) => x.key).sort(), ['B1', 'C1']);
});

test('model keeps notes, links, validation and names; rejects names that look like cells', () => {
  const wb = E.normalizeWorkbook({ sheets: [{ name: 'S', cells: { A1: { v: '5', n: { t: 'Check' }, l: 'https://example.com', s: { nf: '#,##0.00', rot: 45, bd: { b: 6 } } } }, dv: [{ range: 'B2:B9', type: 'list', v1: 'Yes,No' }] }], names: { Sales: 'S!$A$1:$A$5', A1: 'S!A1' } });
  const c = wb.sheets[0].cells.A1; assert.equal(c.n.t, 'Check'); assert.equal(c.l, 'https://example.com'); assert.equal(c.s.rot, 45);
  assert.equal(wb.sheets[0].dv.length, 1); assert.deepEqual(Object.keys(wb.names), ['Sales']);
  assert.equal(E.normalizeWorkbook({ sheets: [{ name: 'S', cells: { A1: { v: '1', l: 'javascript:alert(1)' } } }] }).sheets[0].cells.A1.l, undefined);
});
