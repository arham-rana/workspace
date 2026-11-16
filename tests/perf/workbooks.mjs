// Realistic test workbooks: a ledger with row totals, running balances, SUMIF summaries and VLOOKUPs into a price list.
export function ledger(rows) {
  const cells = {};
  const cats = ['Rent', 'Food', 'Travel', 'Office', 'Software'];
  for (let r = 2; r <= rows + 1; r++) {
    cells[`A${r}`] = { v: cats[r % cats.length] }; cells[`B${r}`] = { v: String((r * 37) % 500) }; cells[`C${r}`] = { v: String((r * 11) % 90) };
    cells[`D${r}`] = { v: `=B${r}+C${r}` }; // row total
    cells[`E${r}`] = { v: r === 2 ? `=D${r}` : `=E${r - 1}+D${r}` }; // running balance (a long chain)
    cells[`F${r}`] = { v: `=VLOOKUP(A${r},$H$2:$I$6,2,FALSE)*D${r}` };
  }
  cats.forEach((c, i) => { cells[`H${i + 2}`] = { v: c }; cells[`I${i + 2}`] = { v: String(1 + i / 10) }; cells[`J${i + 2}`] = { v: `=SUMIF($A$2:$A$${rows + 1},H${i + 2},$D$2:$D$${rows + 1})` }; });
  cells.A1 = { v: 'Category' }; cells.B1 = { v: 'Amount' }; cells.C1 = { v: 'Tax' }; cells.D1 = { v: 'Total' }; cells.E1 = { v: 'Balance' }; cells.F1 = { v: 'Weighted' };
  cells.K1 = { v: `=SUM(D2:D${rows + 1})` };
  return { sheets: [{ name: 'Ledger', cells }] };
}
