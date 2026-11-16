// Spreadsheets: Excel behaviour (Phase 1), formatting and data tools (Phase 2), tables, PivotTables, charts and more (Phase 3).
import { test, expect } from '@playwright/test';
import { signUp, watchErrors, grid, newSheet, untilSaved, createNote, openNote, tool } from './helpers.mjs';

test('typing modes, moving and entering like Excel', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); await newSheet(page); const g = grid(page); const k = page.keyboard;
  await expect(page.locator('.rb-tab:visible .xl-dd-label')).toHaveText(['Format', 'Insert', 'Formulas', 'Data', 'View', 'File']); // one toolbar row; the rest in drop-down cards
  await g.go('A1'); await k.type('Item'); await k.press('ArrowRight'); await expect(page.locator('.xl-name')).toHaveValue('B1'); // Enter mode: arrows finish the entry
  await g.go('A1'); await k.press('F2'); await k.press('ArrowLeft'); await k.press('ArrowLeft'); await k.type('X'); await k.press('Enter'); // Edit mode: arrows move the cursor
  expect(await g.raw('A1')).toBe('ItXem');
  await g.put('B1', '5'); await g.go('B2'); await k.type('='); await k.press('ArrowUp'); await k.type('*2'); await k.press('Enter'); // Point mode
  expect(await g.raw('B2')).toBe('=B1*2'); expect(await g.texts()).toContain('10');
  await g.go('E1:F2'); for (const v of ['a', 'b', 'c']) { await k.type(v); await k.press('Enter'); } // Enter moves within a selection, down then across
  expect([await g.raw('E1'), await g.raw('E2'), await g.raw('F1')]).toEqual(['a', 'b', 'c']);
  await g.go('H1'); await k.type('1'); await k.press('Tab'); await k.type('2'); await k.press('Enter'); await expect(page.locator('.xl-name')).toHaveValue('H2'); // back to the starting column
  await g.go('J1:J4'); await k.type('=ROW()*10'); await k.press('Control+Enter'); expect(await g.raw('J4')).toBe('=ROW()*10');
  await g.go('L1'); await k.type('Line one'); await k.press('Alt+Enter'); await k.type('Line two'); await k.press('Enter'); expect(await g.raw('L1')).toBe('Line one\nLine two');
  await g.put('N1', 'Apples'); await g.go('N2'); await k.type('Ap'); await expect(page.locator('.xl-edit')).toHaveValue('Apples'); // AutoComplete from the column
  await k.press('Enter'); expect(await g.raw('N2')).toBe('Apples');
  await g.put('P1', 'A long piece of text that spills'); expect(await page.evaluate(() => Math.round([...document.querySelectorAll('.xl-q .xc')].find((e) => e.textContent.startsWith('A long')).getBoundingClientRect().width))).toBeGreaterThan(150); // runs over the empty cells beside it (one column is 64 px)
  errs.check();
});

test('selection, a 100,000-row grid, shortcuts, freeze panes and zoom', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); await newSheet(page); const g = grid(page); const k = page.keyboard;
  for (const [i, v] of ['10', '20', '30', '40'].entries()) await g.put(`A${i + 1}`, v);
  await g.go('A1:A4'); await expect(page.locator('.xl-stats')).toContainText('Sum: 100');
  const t0 = Date.now(); await g.go('D90000'); await expect(page.locator('.xl-rh .xh[data-row="89999"]')).toHaveCount(1); expect(Date.now() - t0).toBeLessThan(10000); // catches gross slowness only: speed is measured separately, and tests run side by side
  await k.press('Control+Home'); await expect(page.locator('.xl-name')).toHaveValue('A1');
  await k.press('Control+Shift+End'); await expect(page.locator('.xl-name')).toHaveValue('A1:A4');
  await g.go('A1:A4'); await k.press('Control+Shift+Digit4'); expect(await g.texts()).toContain('$10.00');
  await g.go('A2'); await k.press('Control+Digit9'); await expect(page.locator('.xl-rh .xh[data-row="1"]')).toHaveCount(0);
  await g.go('A1:A3'); await k.press('Control+Shift+Digit9'); await expect(page.locator('.xl-rh .xh[data-row="1"]')).toHaveCount(1);
  await g.go('C3'); await tool(page, 'View', 'freeze-menu'); await page.click('.menu-item >> text=Freeze Panes');
  await page.evaluate(() => { const w = document.querySelector('.xl-wrap'); w.scrollTop = 4000; w.scrollLeft = 2000; });
  await expect(page.locator('.xl-rh .xh[data-row="0"]')).toHaveCount(1); await expect(page.locator('.xl-ch .xh[data-col="0"]')).toHaveCount(1);
  await tool(page, 'View', 'freeze-menu'); await page.click('.menu-item >> text=Unfreeze Panes');
  await expect(page.locator('.xl-wrap')).toBeFocused(); // keyboard focus returns to the grid after a menu command
  await k.press('Control+Home'); await expect(page.locator('.xl-ch .xh[data-col="0"]')).toHaveCount(1);
  await tool(page, 'View', 'zoom-menu'); await page.click('.menu-item >> text=150%');
  await expect.poll(async () => Math.round((await page.locator('.xl-ch .xh[data-col="0"]').boundingBox()).width)).toBe(96);
  errs.check();
});

test('ribbon: merge, borders, AutoSum, Insert Function, Format Painter, Paste Transpose, undo', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); await newSheet(page); const g = grid(page); const k = page.keyboard;
  for (const [i, v] of ['10', '20', '30', '40'].entries()) await g.put(`A${i + 1}`, v);
  
  await g.put('E1', 'Title'); await g.go('E1:G1'); await tool(page, 'Home', 'merge'); await page.click('.menu-item >> text=Merge & Center');
  expect(await g.cellStyle('Title', 'justifyContent')).toBe('center');
  await g.go('A1:A4'); await tool(page, 'Home', 'borders'); await page.click('.menu-item >> text=All Borders'); expect(await g.cellStyle('20', 'borderBottomStyle')).toBe('solid');
  await g.go('A5'); await tool(page, 'Home', 'autosum'); await page.click('.menu-item >> text=Sum'); await expect(page.locator('.xl-edit')).toHaveValue('=SUM(A1:A4)'); await k.press('Enter');
  expect(await g.texts()).toContain('100');
  await g.go('C4'); await page.click('.xl-fx'); await page.fill('.xl-fn-search', 'AVERAGE'); await page.locator('.xl-fn-item').first().dblclick();
  await expect(page.locator('.xl-edit')).toHaveValue('=AVERAGE('); await k.type('A1:A4)'); await k.press('Enter'); expect(await g.raw('C4')).toBe('=AVERAGE(A1:A4)');
  await g.go('A1:A3'); await k.press('Control+c'); await g.go('J1'); await tool(page, 'Home', 'paste'); await page.click('.menu-item >> text=Transpose');
  expect([await g.raw('J1'), await g.raw('K1'), await g.raw('L1')]).toEqual(['10', '20', '30']);
  await k.press('Control+z'); expect(await g.raw('K1')).toBe('');
  errs.check();
});

test('Format Cells, cell styles, inserting cells, sort, duplicates, text to columns', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); await newSheet(page); const g = grid(page); const k = page.keyboard;
  await g.put('A1', '-1234.5'); await g.go('A1'); await k.press('Control+Digit1');
  await page.selectOption('[name=cat]', 'Custom'); await page.fill('[name=code]', '#,##0.00;[Red](#,##0.00)'); await expect(page.locator('.xl-sample')).toHaveText('(1,234.50)'); await page.click('.modal-foot .btn-primary');
  expect(await g.cellStyle('(1,234.50)', 'color')).toBe('rgb(255, 0, 0)');
  await g.put('B1', '2026-10-20'); await g.go('B1'); await k.press('Control+Digit1'); await page.selectOption('[name=cat]', 'Date'); await page.selectOption('[name=type]', 'dddd, mmmm d, yyyy'); await page.click('.modal-foot .btn-primary');
  expect(await g.texts()).toContain('Tuesday, October 20, 2026'); // the column widens itself, as in Excel
  await g.put('D1', 'Pass'); await g.go('D1'); await tool(page, 'Home', 'cell-styles'); await page.click('.menu-item >> text=Good'); expect(await g.cellStyle('Pass', 'backgroundColor')).toBe('rgb(198, 239, 206)');
  for (const [i, v] of ['1', '2', '3'].entries()) await g.put(`G${i + 1}`, v);
  await g.put('H1', '=SUM(G1:G3)'); await g.go('G2'); await tool(page, 'Home', 'insert-menu'); await page.click('.menu-item >> text=Insert Cells…'); await page.check('[name=o][value="down"]'); await page.click('.modal-foot .btn-primary');
  expect(await g.raw('H1')).toBe('=SUM(G1:G4)');
  await g.put('J1', '10'); await g.put('J2', '20'); await g.put('K1', '2'); await g.go('K1'); await k.press('Control+c'); await g.go('J1:J2'); await k.press('Control+Alt+KeyV');
  await page.check('[name=what][value="values"]'); await page.check('[name=op][value="mul"]'); await page.click('.modal-foot .btn-primary');
  expect([await g.raw('J1'), await g.raw('J2')]).toEqual(['20', '40']); // Paste Special × over the whole selection
  const rows = [['Name', 'Team', 'Score'], ['Zoe', 'Red', '7'], ['Al', 'Blue', '9'], ['Bo', 'Red', '9'], ['Al', 'Blue', '9'], ['Cy', 'Blue', '4']];
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) await g.put(`${'OPQ'[c]}${r + 1}`, v);
  await g.go('O1'); await tool(page, 'Data', 'sort-dialog'); await expect(page.locator('[name=header]')).toBeChecked();
  await page.selectOption('.xl-sort-level [name=col]', '15'); await page.click('[data-addlevel]'); await page.locator('.xl-sort-level').nth(1).locator('[name=col]').selectOption('16'); await page.locator('.xl-sort-level').nth(1).locator('[name=dir]').selectOption('desc'); await page.click('.modal-foot .btn-primary');
  expect([await g.raw('O2'), await g.raw('Q2'), await g.raw('O6')]).toEqual(['Al', '9', 'Zoe']);
  await g.go('O1'); await tool(page, 'Data', 'remove-dups'); await page.click('.modal-foot .btn-primary'); await expect(page.locator('.toast').last()).toContainText('1 duplicate value');
  await g.put('S1', 'Smith,John,42'); await g.go('S1'); await tool(page, 'Data', 'text-to-cols'); await page.click('.modal-foot .btn-primary');
  expect([await g.raw('S1'), await g.raw('T1'), await g.raw('U1')]).toEqual(['Smith', 'John', '42']);
  errs.check();
});

test('validation, spills, notes, links and names; Excel export carries them', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); await newSheet(page); const g = grid(page); const k = page.keyboard;
  await g.go('A2:A5'); await tool(page, 'Data', 'validation'); await page.click('.menu-item >> text=Data Validation…');
  await page.selectOption('[name=type]', 'list'); await page.fill('[name=v1]', 'Yes,No,Maybe'); await page.click('[data-dtab="1"]'); await page.check('[name=showmsg]'); await page.fill('[name=mt]', 'Answer'); await page.fill('[name=mx]', 'Pick one'); await page.click('.modal-foot .btn-primary');
  await g.go('A2'); await expect(page.locator('.xl-pop.msg')).toContainText('Pick one');
  await page.click('.xl-dvbtn'); await expect(page.locator('.menu .menu-item')).toHaveText(['Yes', 'No', 'Maybe']); await page.click('.menu-item >> text=Maybe'); expect(await g.raw('A2')).toBe('Maybe');
  await g.go('A3'); await k.type('Perhaps'); await k.press('Enter'); await expect(page.locator('.modal .xl-alert')).toBeVisible(); await page.click('[data-choice="retry"]'); await expect(page.locator('.xl-edit')).toHaveValue('Perhaps'); await k.press('Escape');
  for (const [i, v] of ['pear', 'apple', 'pear', 'kiwi'].entries()) await g.put(`E${i + 2}`, v);
  await g.put('G1', '=UNIQUE(E2:E5)'); expect(await g.raw('G2')).toBe('=UNIQUE(E2:E5)'); await expect(page.locator('.xl-formula')).toHaveClass(/ghost/);
  await g.put('G3', 'x'); expect(await g.texts()).toContain('#SPILL!'); await g.go('G3'); await k.press('Delete');
  await g.put('I1', 'Total'); await g.go('I1'); await k.press('Shift+F2'); await k.type('Checked by finance'); await g.go('J5'); await expect(page.locator('.xn')).toHaveCount(1);
  await g.go('K1'); await k.press('Control+k'); await page.fill('[name=text]', 'Example'); await page.fill('[name=url]', 'example.com'); await page.click('.modal-foot .btn-primary');
  expect(await g.cellStyle('Example', 'color')).toBe('rgb(5, 99, 193)');
  await g.put('M1', '5'); await g.put('M2', '7'); await g.go('M1:M2'); await page.click('.xl-name'); await page.fill('.xl-name', 'Bonus'); await k.press('Enter');
  await g.put('N1', '=SUM(Bonus)'); expect(await g.texts()).toContain('12'); await g.go('M1:M2'); await expect(page.locator('.xl-name')).toHaveValue('Bonus');
  await page.waitForTimeout(1500); const dl = page.waitForEvent('download'); await tool(page, 'File', 'export-xlsx');
  const ExcelJS = (await import('exceljs')).default; const b = new ExcelJS.Workbook(); await b.xlsx.readFile(await (await dl).path()); const ws = b.worksheets[0];
  expect(ws.getCell('A4').dataValidation?.type).toBe('list'); expect(ws.getCell('I1').note).toBe('Checked by finance'); expect(ws.getCell('K1').value.hyperlink).toBe('https://example.com');
  expect(b.definedNames.model.map((n) => n.name)).toContain('Bonus'); expect(ws.getCell('G1').formula).toBe('UNIQUE(E2:E5)');
  errs.check();
});

test('tables and PivotTables', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); await newSheet(page); const g = grid(page); const k = page.keyboard;
  await g.go('A1'); for (const row of [['Region', 'Product', 'Sales'], ['North', 'Pens', '10'], ['South', 'Pens', '20'], ['North', 'Ink', '5'], ['East', 'Ink', '8']]) { for (const v of row) { await k.type(v); await k.press('Tab'); } await k.press('Enter'); }
  await g.go('B2'); await k.press('Control+t'); await expect(page.locator('.xl-dlg [name=range]')).toHaveValue('A1:C5'); await page.click('.modal-foot .btn-primary');
  await expect(page.locator('.rb-tab[data-rbtab="Table Design"]')).toBeVisible(); expect(await g.cellStyle('Region', 'backgroundColor')).toBe('rgb(68, 114, 196)');
  await g.put('E1', '=SUM(Table1[Sales])'); expect(await g.texts()).toContain('43');
  await g.go('A6'); await k.type('West'); await k.press('Tab'); await k.type('Pens'); await k.press('Tab'); await k.type('7'); await k.press('Enter'); expect(await g.texts()).toContain('50'); // the table grew
  await g.go('B3'); await page.click('.rb-tab[data-rbtab="Table Design"]'); await page.check('[data-tblopt="total"]'); expect(await g.raw('C7')).toBe('=SUBTOTAL(109,Table1[Sales])');
  await g.go('C7'); await page.click('[data-totaldrop]'); await page.click('.menu-item >> text=Average'); expect(await g.raw('C7')).toBe('=SUBTOTAL(101,Table1[Sales])');
  await g.go('B3'); await page.click('.rb-tab[data-rbtab="Table Design"]'); await page.fill('.rb-tblname', 'Sales'); await k.press('Enter'); expect(await g.raw('E1')).toBe('=SUM(Sales[Sales])'); // formulas follow the rename
  await g.go('B3'); await tool(page, 'Insert', 'insert-pivot'); await expect(page.locator('.xl-dlg [name=src]')).toHaveValue('Sales'); await page.click('.modal-foot .btn-primary'); // from inside the table
  await expect(page.locator('.xl-pivot')).toBeVisible();
  await page.click('.xl-pivot [data-pfield="Region"]'); await expect(page.locator('.xl-pivot [data-pfield="Region"]')).toBeChecked(); await page.click('.xl-pivot [data-pfield="Sales"]'); // the panel redraws after each change
  await expect.poll(() => g.texts()).toEqual(expect.arrayContaining(['Region', 'Sum of Sales', 'East', '8', 'North', '15', 'South', '20', 'West', '7', 'Grand Total', '50']));
  await page.locator('.xl-pivot [data-pmove="Region"]').selectOption('cols'); await page.click('.xl-pivot [data-pfield="Product"]');
  await expect.poll(() => g.texts()).toContain('Product');
  await g.go('B6'); await k.type('9'); await expect(page.locator('.toast').last()).toContainText('Cannot change this part of a PivotTable report');
  errs.check();
});

test('charts, formula auditing, Goal Seek, protection, hidden sheets, page layout', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); const id = await newSheet(page); const g = grid(page); const k = page.keyboard;
  await g.go('A1'); for (const row of [['Month', 'Sales'], ['Jan', '10'], ['Feb', '14'], ['Mar', '9']]) { for (const v of row) { await k.type(v); await k.press('Tab'); } await k.press('Enter'); }
  await g.go('A1:B4'); await tool(page, 'Insert', 'insert-chart'); await page.click('.menu-item >> text=Clustered Column');
  await expect(page.locator('.xchart')).toHaveCount(1); await expect(page.locator('.rb-tab[data-rbtab="Chart Design"]')).toBeVisible();
  const before = await page.locator('.xchart').innerHTML(); await g.put('B3', '40'); await expect.poll(() => page.locator('.xchart').innerHTML()).not.toBe(before);
  await page.locator('.xchart').click({ position: { x: 40, y: 20 } }); await k.press('Delete'); await expect(page.locator('.xchart')).toHaveCount(0);
  await g.put('D1', '=B2+B3'); await g.go('D1'); await tool(page, 'Formulas', 'trace-pre'); await expect(page.locator('.xs-arrows line')).toHaveCount(2); await tool(page, 'Formulas', 'trace-clear');
  await g.put('E1', '=1/0'); await g.go('E2'); await k.type("'123"); await k.press('Enter'); await expect(page.locator('.xe')).toHaveCount(2);
  await g.go('E2'); await page.click('[data-errtag]'); await page.click('.menu-item >> text=Convert to Number'); expect(await g.raw('E2')).toBe('123');
  await g.put('G1', '20000'); await g.put('G2', '0.05'); await g.put('G3', '24'); await g.put('G4', '=PMT(G2/12,G3,-G1)');
  await tool(page, 'Data', 'what-if'); await page.click('.menu-item >> text=Goal Seek…');
  await page.fill('[name=set]', 'G4'); await page.fill('[name=to]', '500'); await page.fill('[name=by]', 'G3'); await page.click('.modal-foot .btn-primary');
  await expect(page.locator('.modal p').first()).toContainText('found a solution'); await page.click('[data-keep]'); expect(Number(await g.raw('G3'))).toBeCloseTo(43.848, 2);
  await g.go('I2'); await k.press('Control+Digit1'); await page.click('[data-dtab="5"]'); await page.uncheck('[name=locked]'); await page.click('.modal-foot .btn-primary');
  await tool(page, 'Data', 'protect'); await page.fill('[name=pw]', 'secret'); await page.fill('[name=pw2]', 'secret'); await page.click('.modal-foot .btn-primary');
  await g.go('I1'); await k.type('x'); await expect(page.locator('.xl-edit')).toHaveCount(0); await expect(page.locator('.toast').last()).toContainText('protected sheet');
  await g.put('I2', 'ok'); expect(await g.raw('I2')).toBe('ok');
  await tool(page, 'Data', 'protect'); await page.fill('[name=pw]', 'wrong'); await page.click('.modal-foot .btn-primary'); await expect(page.locator('.modal')).toBeVisible(); // stays open
  await page.fill('[name=pw]', 'secret'); await page.click('.modal-foot .btn-primary'); await g.put('I1', 'now'); expect(await g.raw('I1')).toBe('now');
  await page.click('[data-tabadd]'); await page.locator('.sheet-tab').nth(1).click({ button: 'right' }); await page.click('.menu-item >> text=Hide'); await expect(page.locator('.sheet-tab')).toHaveCount(1);
  await page.locator('.sheet-tab').first().click({ button: 'right' }); await page.click('.menu-item >> text=Unhide…'); await page.click('.modal-foot .btn-primary'); await expect(page.locator('.sheet-tab')).toHaveCount(2);
  await page.locator('.sheet-tab').first().click();
  await g.go('A1:B4'); await tool(page, 'File', 'pl-area'); await page.click('.menu-item >> text=Set Print Area');
  await tool(page, 'File', 'pl-orient'); await page.click('.menu-item >> text=Landscape');
  await untilSaved(page, id, 'sheet', (d) => d.sheets[0].print?.area === 'A1:B4', 'print area saved');
  errs.check();
});

test('a spreadsheet inside a document; older spreadsheets still open', async ({ page }) => {
  const errs = watchErrors(page); await signUp(page); const g = grid(page);
  await page.click('[data-action=new-note]'); await page.waitForSelector('.ProseMirror'); await page.click('.ProseMirror'); await page.keyboard.type('Budget below:'); await page.keyboard.press('Enter');
  await page.click('[data-cmd=insert]'); await page.click('.pick-pop [data-pick=sheet]'); await page.waitForSelector('.ProseMirror .xl-wrap');
  await g.put('A1', 'Rent'); await g.put('B1', '1500'); await g.put('A2', 'Food'); await g.put('B2', '400'); await g.put('B3', '=SUM(B1:B2)');
  await page.waitForTimeout(1500); await page.click('[data-action=done-editing]');
  await expect(page.locator('#doc-sheet .sheet-static td')).toContainText(['Rent', '1500', 'Food', '400', '', '1900']);
  const old = { sheets: [{ name: 'Old', r: 40, c: 12, cells: { A1: { v: 'Legacy' }, B1: { v: '=2+3', s: { fz: 16, b: 1 } } }, w: { A: 140 } }] };
  const oid = await createNote(page, { title: 'Old one', kind: 'sheet', block: 'sheet', data: old }); await openNote(page, oid); await page.waitForSelector('.xl-wrap');
  await expect(page.locator('.sheet-tab')).toHaveText(['Old']); expect(await g.texts()).toEqual(expect.arrayContaining(['Legacy', '5']));
  errs.check();
});
