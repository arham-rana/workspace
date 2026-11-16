// Recalculating only what an edit affects must give exactly the same values as a full recalculation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../shared/sheet-engine.mjs';
import { ledger } from '../perf/workbooks.mjs';

const same = (a, b) => { for (const name of Object.keys(b)) for (const k of new Set([...Object.keys(a[name] || {}), ...Object.keys(b[name])])) assert.deepEqual(a[name]?.[k] ?? null, b[name][k] ?? null, `${name}!${k}`); };

test('after hundreds of random edits, incremental results equal full recalculation', () => {
  let wb = E.normalizeWorkbook(ledger(120));
  wb.sheets.push(E.normalizeSheet({ name: 'Summary', cells: { A1: { v: '=Ledger!K1*2' }, A2: { v: '=SUM(Ledger!B2:B50)' }, A3: { v: '=A1+A2' } } }, 'Summary'));
  wb = E.normalizeWorkbook(wb);
  const calc = E.createCalculator(); calc.evaluate(wb);
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const cats = ['Rent', 'Food', 'Travel', 'Office', 'Software', 'Other'];
  for (let i = 0; i < 300; i++) {
    const next = structuredClone(wb); const cells = next.sheets[0].cells; const r = 2 + rnd(121);
    const kind = rnd(10);
    if (kind < 5) cells[`B${r}`] = { v: String(rnd(1000)) };              // a number
    else if (kind < 7) cells[`A${r}`] = { v: cats[rnd(cats.length)] };   // a category (SUMIF, VLOOKUP)
    else if (kind < 8) delete cells[`C${r}`];                             // cleared
    else if (kind < 9) cells[`I${2 + rnd(5)}`] = { v: String(rnd(5)) };  // a lookup table price
    else cells[`D${r}`] = { v: `=B${r}*2` };                             // a formula changed
    wb = E.normalizeWorkbook(next);
    same(calc.evaluate(wb), E.evaluateWorkbook(wb));
  }
});

test('spills, volatile functions and sheet changes still give correct results', () => {
  const calc = E.createCalculator();
  let wb = E.normalizeWorkbook({ sheets: [{ name: 'S', cells: { A1: { v: '3' }, A2: { v: '1' }, A3: { v: '2' }, C1: { v: '=SORT(A1:A3)' }, D1: { v: '=SUM(C1#)' } } }] });
  same(calc.evaluate(wb), E.evaluateWorkbook(wb));
  wb = structuredClone(wb); wb.sheets[0].cells.A2 = { v: '10' }; wb = E.normalizeWorkbook(wb);
  const v = calc.evaluate(wb); same(v, E.evaluateWorkbook(wb)); assert.equal(v.S.C3.value, 10);
  wb = structuredClone(wb); wb.sheets.push(E.normalizeSheet({ name: 'T', cells: { A1: { v: '=S!D1' } } }, 'T')); wb = E.normalizeWorkbook(wb);
  same(calc.evaluate(wb), E.evaluateWorkbook(wb));
});
