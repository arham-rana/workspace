// The spreadsheet ribbon (tabs → groups → controls), in the app's web style. Each control has a command
// name; the spreadsheet handles the commands. Later features add their controls here.
import { esc, kbd } from './util.js';
import { icon } from './icons.js';

export const FONTS = ['', 'Aptos', 'Calibri', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS'];
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const FN_CATEGORIES = {
  Financial: ['PMT', 'PV', 'FV', 'NPV', 'IRR', 'RATE', 'NPER', 'IPMT', 'PPMT', 'XNPV', 'XIRR', 'SLN', 'DB', 'DDB'],
  Logical: ['IF', 'IFS', 'IFERROR', 'IFNA', 'AND', 'OR', 'NOT', 'XOR', 'SWITCH', 'TRUE', 'FALSE'],
  Text: ['CONCAT', 'TEXTJOIN', 'LEFT', 'RIGHT', 'MID', 'LEN', 'FIND', 'SEARCH', 'SUBSTITUTE', 'REPLACE', 'UPPER', 'LOWER', 'PROPER', 'TRIM', 'TEXT', 'VALUE', 'REPT', 'EXACT', 'CHAR'],
  'Date & Time': ['TODAY', 'NOW', 'DATE', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'WEEKDAY', 'WEEKNUM', 'EDATE', 'EOMONTH', 'DATEDIF', 'DAYS', 'NETWORKDAYS', 'WORKDAY'],
  'Lookup & Reference': ['XLOOKUP', 'VLOOKUP', 'HLOOKUP', 'INDEX', 'MATCH', 'LOOKUP', 'CHOOSE', 'ROW', 'COLUMN', 'ROWS', 'COLUMNS', 'TRANSPOSE', 'UNIQUE', 'SORT', 'FILTER'],
  'Math & Trig': ['SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'PRODUCT', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'TRUNC', 'ABS', 'MOD', 'POWER', 'SQRT', 'PI', 'RAND', 'RANDBETWEEN', 'CEILING', 'FLOOR', 'SIGN'],
  Statistical: ['AVERAGE', 'AVERAGEIF', 'AVERAGEIFS', 'COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTIF', 'COUNTIFS', 'MAX', 'MIN', 'MEDIAN', 'MODE', 'STDEV', 'VAR', 'LARGE', 'SMALL', 'RANK', 'PERCENTILE', 'QUARTILE'],
};
export const NUMBER_FORMATS = [['general', 'General'], ['number', 'Number'], ['currency', 'Currency'], ['date', 'Short date'], ['percent', 'Percentage'], ['text', 'Text']];

/* Control helpers */
const big = (cmd, ic, label, title = label, menu = false) => `<button type="button" class="rb-big" data-cmd="${cmd}" title="${esc(title)}"${menu ? ' aria-haspopup="menu"' : ''}>${icon(ic, { size: 22 })}<span>${label}${menu ? '<i class="rb-caret"></i>' : ''}</span></button>`;
// Accessible names: a visible word is the button's name (the tooltip describes it); icon-only buttons are named by
// their tooltip; symbols drawn with text (A+, .00) are hidden from screen readers and replaced by the spoken name.
const glyph = (ic) => (ic.startsWith('<svg') ? ic : ic.startsWith('<') ? `<span aria-hidden="true">${ic}</span>` : icon(ic, { size: 16 }));
const sm = (cmd, ic, title, label = '', menu = false) => `<button type="button" class="rb-sm" data-cmd="${cmd}" title="${esc(title)}"${label ? '' : ic.startsWith('<') && !ic.startsWith('<svg') ? '' : ` aria-label="${esc(title)}"`}${menu ? ' aria-haspopup="menu"' : ''}>${glyph(ic)}${label ? `<span>${label}</span>` : ic.startsWith('<') && !ic.startsWith('<svg') ? `<span class="sr-only">${esc(title)}</span>` : ''}${menu ? '<i class="rb-caret" aria-hidden="true"></i>' : ''}</button>`;
const txt = (cmd, text, title, menu = false) => `<button type="button" class="rb-sm rb-txt" data-cmd="${cmd}" title="${esc(title)}"${menu ? ' aria-haspopup="menu"' : ''}><b aria-hidden="true">${text}</b><span class="sr-only">${esc(title)}</span>${menu ? '<i class="rb-caret" aria-hidden="true"></i>' : ''}</button>`;
const color = (cmd, ic, title, value) => `<span class="rb-color" title="${esc(title)}"><button type="button" class="rb-sm" data-cmd="${cmd}" aria-label="${esc(title)}">${icon(ic, { size: 16 })}<i class="rb-swatch" data-swatch="${cmd}" style="background:${value}"></i></button><label class="rb-color-pick" aria-label="Choose ${esc(title.toLowerCase())}"><i class="rb-caret"></i><input type="color" data-color="${cmd}" value="${value}"></label></span>`;
const group = (label, body, cls = '') => `<div class="rb-group ${cls}" role="group" aria-label="${esc(label)}"><div class="rb-body">${body}</div><div class="rb-label">${label}</div></div>`;

export function ribbonHtml() {
  // the everyday controls, shown in the main toolbar row
  const FONT_A = `<select class="rb-select rb-font" data-cmd="font" aria-label="Font" title="Font">${FONTS.map((f) => `<option value="${esc(f)}">${f || 'Default (Aptos)'}</option>`).join('')}</select><select class="rb-select rb-size" data-cmd="size" aria-label="Font size" title="Font size">${SIZES.map((n) => `<option value="${n}">${n}</option>`).join('')}</select>${txt('grow', 'A<sup>+</sup>', 'Increase font size')}${txt('shrink', 'A<sup>−</sup>', 'Decrease font size')}`;
  const FONT_B = `${sm('bold', 'bold', kbd('Bold (Cmd+B)'))}${sm('italic', 'italic', kbd('Italic (Cmd+I)'))}${sm('underline', 'underline', kbd('Underline (Cmd+U)'))}${sm('strike', 'strike', kbd('Strikethrough (Cmd+5)'))}<span class="rb-sep"></span>${sm('borders', 'table', 'Borders', '', true)}${color('fill', 'highlighter', 'Fill colour', '#ffff00')}${color('fontcolor', 'textColor', 'Font colour', '#c00000')}`;
  const ALIGN_A = `${sm('va-top', '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16M12 8v12M8 12l4-4 4 4"/></svg>', 'Top align')}${sm('va-middle', '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h16M12 3v6M12 15v6M9 6l3 3 3-3M9 18l3-3 3 3"/></svg>', 'Middle align')}${sm('va-bottom', '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h16M12 4v12M8 12l4 4 4-4"/></svg>', 'Bottom align')}<span class="rb-sep"></span>${sm('wrap', '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M3 12h15a3 3 0 0 1 0 6h-4M3 18h7M16 16l-2 2 2 2"/></svg>', 'Wrap text', 'Wrap Text')}`;
  const ALIGN_B = `${sm('al-left', 'alignLeft', 'Align left')}${sm('al-center', 'alignCenter', 'Centre')}${sm('al-right', 'alignRight', 'Align right')}<span class="rb-sep"></span>${sm('indent-less', 'outdent', 'Decrease Indent')}${sm('indent-more', 'indent', 'Increase Indent')}${sm('orientation', '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 19 19 5M12 5h7v7"/></svg>', 'Orientation', '', true)}<span class="rb-sep"></span>${sm('merge', '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2"/></svg>', 'Merge & Centre', 'Merge & Centre', true)}`;
  const NUM_A = `<select class="rb-select rb-numfmt" data-cmd="numfmt" aria-label="Number format" title="Number format">${NUMBER_FORMATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`;
  const NUM_B = `${txt('fmt-currency', '$', kbd('Currency (Cmd+Shift+$)'))}${txt('fmt-percent', '%', kbd('Percent style (Cmd+Shift+%)'))}${txt('fmt-comma', ',', 'Comma style (thousands separator)')}<span class="rb-sep"></span>${txt('dp-more', '.0<small>→</small>.00', 'Increase decimal')}${txt('dp-less', '.00<small>→</small>.0', 'Decrease decimal')}`;
  const GROW_SHRINK = /<button[^>]*data-cmd="(grow|shrink)"[\s\S]*?<\/button>/g; // in the Format card (the size list is in the row)
  const tabs = {
    File: [
      group('Open', big('import', 'upload', 'Import', 'Import an .xlsx or .csv file')),
      group('Save a copy', big('export-xlsx', 'fileDown', 'Excel (.xlsx)') + big('export-csv', 'fileDown', 'CSV (.csv)', 'This sheet as .csv')),
    ],
    Home: [
      group('Clipboard', big('paste', 'clipboard', 'Paste', kbd('Paste (Cmd+V)'), true) + `<div class="rb-stack">${sm('cut', 'scissors', kbd('Cut (Cmd+X)'), 'Cut')}${sm('copy', 'copy', kbd('Copy (Cmd+C)'), 'Copy')}${sm('painter', 'paintbrush', 'Format Painter: copy formatting to other cells (double-click to keep it on)', 'Format Painter')}</div>`),
      group('Font', `<div class="rb-rows"><div class="rb-row">${(FONT_A.match(GROW_SHRINK) || []).join('')}${sm('strike', 'strike', kbd('Strikethrough (Cmd+5)'))}</div></div>`),
      group('Number', `<div class="rb-rows"><div class="rb-row">${NUM_B}</div></div>`),
      group('Format Cells', big('more-formats', 'settings', 'Format Cells', kbd('Format Cells (Cmd+1)')) + big('font-dialog', 'textSize', 'Font', kbd('Font settings (Cmd+Shift+F)')) + big('align-dialog', 'alignLeft', 'Alignment', 'Alignment settings')),
      group('Styles', big('cf', 'palette', 'Conditional Formatting', 'Conditional Formatting', true) + big('cell-styles', 'paintbrush', 'Cell Styles', 'Cell Styles', true)),
      group('Cells', big('insert-menu', 'plus', 'Insert', 'Insert cells, rows, columns or sheets', true) + big('delete-menu', 'minus', 'Delete', 'Delete cells, rows, columns or sheets', true) + big('format-menu', 'settings', 'Format', 'Row height, column width, hide and unhide, rename sheet', true)),
      group('Editing', `<div class="rb-stack">${sm('autosum', '<b class="sigma">Σ</b>', kbd('AutoSum (Alt+=)'), 'AutoSum', true)}${sm('fill-menu', 'arrowDown', 'Fill', 'Fill', true)}${sm('clear-menu', 'eraser', 'Clear', 'Clear', true)}</div>${big('sortfilter', 'sort', 'Sort & Filter', 'Sort & Filter', true)}${big('findselect', 'search', 'Find & Select', 'Find & Select', true)}`),
    ],
    Insert: [
      group('Tables', big('insert-pivot', 'table', 'PivotTable', 'Summarise data with a PivotTable') + big('insert-table', 'table', 'Table', kbd('Create a table (Cmd+T)'))),
      group('Charts', big('insert-chart', 'barChart', 'Chart', 'Insert a chart of the selected data', true)),
      group('Functions', big('insert-function', 'sigma', 'Function', 'Insert a function')),
      group('Links', big('insert-link', 'link', 'Link', kbd('Insert a hyperlink (Cmd+K)'))),
      group('Notes', big('note-new', 'messageSquare', 'Note', 'Insert a note (Shift+F2)')),
    ],
    'Page Layout': [
      group('Page Setup', big('pl-margins', 'layoutTop', 'Margins', 'Margins', true) + big('pl-orient', 'file', 'Orientation', 'Orientation', true) + big('pl-size', 'file', 'Size', 'Paper size', true) + big('pl-area', 'table', 'Print Area', 'Print Area', true) + big('pl-titles', 'layoutTop', 'Print Titles', 'Rows to repeat at the top of every page')),
      group('Scale to Fit', big('pl-fit', 'search', 'Scale to Fit', 'Fit to the page', true)),
      group('Sheet Options', `<div class="rb-stack"><label class="rb-check"><input type="checkbox" data-cmd="print-grid" checked> Print gridlines</label><label class="rb-check"><input type="checkbox" data-cmd="print-heads"> Print headings</label></div>`),
    ],
    Formulas: [
      group('Function Library', big('insert-function', 'sigma', 'Insert Function') + big('autosum', 'sigma', 'AutoSum', 'AutoSum', true) + Object.keys(FN_CATEGORIES).map((cat) => big(`fncat:${cat}`, 'book', cat, `${cat} functions`, true)).join('')),
      group('Defined Names', big('define-name', 'tag', 'Define Name', 'Define a name for the selected cells') + `<div class="rb-stack">${sm('use-name', 'tag', 'Use a name in a formula (F3)', 'Use in Formula', true)}${sm('name-manager', 'list', kbd('Name Manager (Cmd+F3)'), 'Name Manager')}</div>`),
      group('Formula Auditing', `<div class="rb-stack">${sm('trace-pre', 'arrowRight', 'Show arrows from the cells this formula uses', 'Trace Precedents')}${sm('trace-dep', 'arrowRight', 'Show arrows to the formulas that use this cell', 'Trace Dependents')}${sm('trace-clear', 'x', 'Remove the arrows', 'Remove Arrows')}</div>${big('show-formulas', 'code', 'Show Formulas', kbd('Show formulas instead of results (Ctrl+`)'))}${big('err-check', 'check', 'Error Checking', 'Go to the next cell with an error')}`),
      group('Calculation', big('calc-now', 'refresh', 'Calculate Now', 'Recalculate (F9)')),
    ],
    Data: [
      group('Get Data', big('import', 'upload', 'From File', 'Import an .xlsx or .csv file')),
      group('Sort & Filter', `<div class="rb-stack">${sm('sort-asc', 'sort', 'Sort A to Z', 'A → Z')}${sm('sort-desc', 'sort', 'Sort Z to A', 'Z → A')}</div>${big('filter', 'filter', 'Filter', kbd('Filter (Cmd+Shift+L)'))}<div class="rb-stack">${sm('filter-clear', 'x', 'Clear filter', 'Clear')}${sm('filter-reapply', 'refresh', 'Reapply filter', 'Reapply')}</div>${big('sort-dialog', 'sort', 'Sort', 'Sort by several columns')}`),
      group('Queries', big('pv-refresh-all', 'refresh', 'Refresh All', 'Refresh all PivotTables (Cmd+Alt+F5)')),
      group('Forecast', big('what-if', 'sigma', 'What-If Analysis', 'Goal Seek', true)),
      group('Data Tools', big('text-to-cols', 'columns', 'Text to Columns', 'Split one column of text into several') + big('remove-dups', 'copy', 'Remove Duplicates', 'Remove duplicate rows') + big('validation', 'check', 'Data Validation', 'Data Validation', true)),
    ],
    Review: [
      group('Protect', big('protect', 'lock', 'Protect Sheet', 'Protect or unprotect this sheet')),
      group('Notes', big('note-new', 'messageSquare', 'New Note', 'New or edit note (Shift+F2)') + `<div class="rb-stack">${sm('note-delete', 'trash', 'Delete note', 'Delete')}${sm('note-prev', 'chevronLeft', 'Previous note', 'Previous')}${sm('note-next', 'chevronRight', 'Next note', 'Next')}</div>${big('note-all', 'messageSquare', 'Show All Notes', 'Show all notes')}`),
    ],
    View: [
      group('Window', big('freeze-menu', 'snowflake', 'Freeze Panes', 'Freeze Panes', true)),
      group('Show', `<div class="rb-stack"><label class="rb-check"><input type="checkbox" data-cmd="toggle-grid" checked> Gridlines</label><label class="rb-check"><input type="checkbox" data-cmd="toggle-heads" checked> Headings</label><label class="rb-check"><input type="checkbox" data-cmd="toggle-fbar" checked> Formula Bar</label></div>`),
      group('Zoom', big('zoom-menu', 'search', 'Zoom', 'Zoom', true) + big('zoom-100', 'search', '100%', 'Zoom to 100%') + big('zoom-sel', 'search', 'Zoom to Selection', 'Zoom so the selection fills the window')),
    ],
  };
  // contextual tabs: shown only when a table, PivotTable or chart is selected
  tabs['Table Design'] = [
    group('Properties', `<label class="rb-namefield">Table Name:<input class="rb-tblname" aria-label="Table name" spellcheck="false"></label>${sm('tbl-resize', 'columns', 'Resize the table', 'Resize Table')}`),
    group('Tools', sm('tbl-convert', 'table', 'Convert the table to a normal range', 'Convert to Range')),
    group('Table Style Options', `<div class="rb-checkgrid">${[['header', 'Header Row'], ['total', 'Total Row'], ['banded', 'Banded Rows'], ['firstCol', 'First Column'], ['lastCol', 'Last Column'], ['bandedCols', 'Banded Columns'], ['filterBtn', 'Filter Button']].map(([k, l]) => `<label class="rb-check"><input type="checkbox" data-tblopt="${k}"> ${l}</label>`).join('')}</div>`),
    group('Table Styles', big('tbl-styles', 'palette', 'Quick Styles', 'Table styles', true)),
  ];
  tabs['PivotTable Analyze'] = [
    group('Data', big('pv-refresh', 'refresh', 'Refresh', 'Refresh this PivotTable') + big('pv-refresh-all', 'refresh', 'Refresh All', 'Refresh all PivotTables') + big('pv-source', 'table', 'Change Data Source', 'Change the source range')),
    group('Show', big('pv-fields', 'list', 'Field List', 'Show or hide the PivotTable Fields panel')),
    group('Actions', big('pv-delete', 'trash', 'Delete', 'Delete this PivotTable')),
  ];
  tabs['Chart Design'] = [
    group('Type', big('ch-type', 'barChart', 'Change Chart Type', 'Change chart type', true)),
    group('Data', big('ch-switch', 'refresh', 'Switch Row/Column', 'Switch rows and columns') + big('ch-data', 'table', 'Select Data', 'Chart data and options')),
    group('Chart Elements', big('ch-title', 'textSize', 'Chart Title', 'Chart title') + big('ch-legend', 'list', 'Legend', 'Show or hide the legend')),
    group('Actions', big('ch-delete', 'trash', 'Delete', 'Delete chart (Delete)')),
  ];
  const CONTEXT = ['Table Design', 'PivotTable Analyze', 'Chart Design'];
  tabs.File = [...tabs.File, ...tabs['Page Layout']]; tabs.Data = [...tabs.Data, ...tabs.Review]; delete tabs['Page Layout']; delete tabs.Review;
  const names = ['Home', 'Insert', 'Formulas', 'Data', 'View', 'File'].filter((n) => tabs[n]).concat(CONTEXT.filter((n) => tabs[n]));
  const ICONS = { Home: 'palette', Insert: 'plus', Formulas: 'sigma', Data: 'table', View: 'eye', File: 'file', 'Table Design': 'table', 'PivotTable Analyze': 'table', 'Chart Design': 'barChart' };
  const label = (n) => (n === 'Home' ? 'Format' : n.replace(' Design', '').replace(' Analyze', '')); // Format, Insert … Table, Chart, PivotTable
  const grp = (html) => `<span class="xl-tb-grp">${html}</span>`, sep = '<span class="tb-sep" aria-hidden="true"></span>';
  // One row like the document toolbar: everyday tools, then drop-downs that open the rest as a card.
  return `<div class="ribbon xl-toolbar" role="toolbar" aria-label="Spreadsheet tools">
    <div class="xl-tb-row">
      ${grp(sm('undo', 'undo', kbd('Undo (Cmd+Z)')) + sm('redo', 'redo', kbd('Redo (Cmd+Shift+Z)')) + sm('painter', 'paintbrush', 'Format Painter (double-click to keep it on)'))}${sep}
      ${grp(NUM_A)}${sep}
      ${grp(FONT_A.replace(GROW_SHRINK, ''))}${sep}${grp(FONT_B)}${sep}
      ${grp(sm('align-menu', 'alignLeft', 'Alignment, indent, wrap and text direction', '', true) + sm('merge', '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2"/></svg>', 'Merge & Centre', '', true))}${sep}
      ${grp(sm('autosum', '<b class="sigma" aria-hidden="true">Σ</b>', kbd('AutoSum (Alt+=)'), '', true))}
      <span class="xl-tb-fill"></span>
      ${grp(names.map((n) => `<button type="button" class="rb-tab tb-btn tb-text tb-menu${CONTEXT.includes(n) ? ' rb-ctx' : ''}" data-rbtab="${n}" aria-haspopup="dialog" aria-expanded="false" title="${label(n)}"${CONTEXT.includes(n) ? ' hidden' : ''}><span class="xl-dd-ic" aria-hidden="true">${icon(ICONS[n] || 'menu', { size: 16 })}</span><span class="xl-dd-label">${label(n)}</span><span class="tb-caret" aria-hidden="true"></span></button>`).join(''))}
    </div>
    <div class="rb-pop" role="dialog" aria-label="Spreadsheet tools" hidden>
      ${names.map((n) => `<div class="rb-panel" data-rbpanel="${n}" hidden>${tabs[n].join('')}</div>`).join('')}
    </div>
  </div>`;
}
