// Templates for new files: documents (unchanged), spreadsheets (with working formulas) and presentations (built from
// the app's layouts, so they follow whichever theme you pick). Shown in the ⌄ menus beside New Document / Spreadsheet /
// Presentation, together with your own saved templates.
import { newSlide } from '/shared/slides-engine.mjs';
import { encData } from './markdown.js';

// Document templates: each shows off what documents can do (table of contents, callouts, status chips, tables,
// checklists, charts, equations, code, highlights, page view with header/footer and page numbers, page breaks).
const STATUS = [{ l: 'Not started', c: 'gray' }, { l: 'In progress', c: 'blue' }, { l: 'Blocked', c: 'red' }, { l: 'Done', c: 'green' }];
const PRIORITY = [{ l: 'High', c: 'red' }, { l: 'Medium', c: 'orange' }, { l: 'Low', c: 'gray' }];
const REVIEW = [{ l: 'Draft', c: 'gray' }, { l: 'In review', c: 'yellow' }, { l: 'Changes needed', c: 'orange' }, { l: 'Approved', c: 'green' }];
const chip = (v, o) => `[[dd:${encData({ v, o })}]]`;
const chart = (spec) => `[[chart:${encData(spec)}]]`;
const lines = (...l) => l.join('\n');
const pages = (header, footer) => JSON.stringify({ header: { text: header, align: 'left', size: 9 }, footer: { text: footer, align: 'left', size: 9 }, pageNumbers: { place: 'footer', align: 'right', format: 'n-of-m' } });

export const DOC_TEMPLATES = [
  { id: 'project', name: 'Project plan', icon: 'briefcase', color: 'teal', text: 'Goal, milestones with status, a timeline chart and tasks.', note: { title: 'Project plan', icon: 'briefcase', color: 'teal', content: lines(
    '[[toc]]', '',
    '> 💡 **Goal:** one sentence on what this project achieves, and for whom. {{hl:yellow|Launch target: March 1.}}', '',
    '## Overview', '',
    `Status: ${chip('In progress', STATUS)}`, '',
    'Why this matters, who it’s for, and what success looks like. Keep it short: this is what people read first.', '',
    '## Milestones', '',
    '| Milestone | Owner | Due | Status |', '| --- | --- | --- | --- |',
    `| Kick-off | Sam | Jan 6 | ${chip('Done', STATUS)} |`, `| Design approved | Priya | Jan 24 | ${chip('In progress', STATUS)} |`, `| Beta release | Jordan | Feb 14 | ${chip('Not started', STATUS)} |`, `| Launch | Sam | Mar 1 | ${chip('Not started', STATUS)} |`, '',
    '## Timeline', '',
    chart({ t: 'column', title: 'Effort by phase (weeks)', labels: ['Discovery', 'Design', 'Build', 'Test', 'Launch'], series: [{ n: 'Planned', v: [2, 3, 6, 2, 1] }, { n: 'Actual', v: [2, 4, 3, 0, 0] }] }), '',
    '## Tasks', '',
    '- [x] Agree the scope with stakeholders', '- [x] Book the kick-off', '- [ ] Write the design brief', '- [ ] Line up beta testers', '',
    '## Risks', '',
    '> ⚠️ **Risk:** what could go wrong, how likely it is, and what we’ll do about it.') } },
  { id: 'meeting', name: 'Meeting notes', icon: 'users', color: 'green', text: 'Attendees, agenda, decisions and action items with status.', note: { title: 'Meeting notes', icon: 'lightbulb', color: 'green', content: lines(
    '**Date:** Monday · **Time:** 10:00 · **Where:** Room 2 / video call', '',
    '## Attendees', '',
    '| Name | Role | Present |', '| --- | --- | --- |', '| Sam | Facilitator | ✓ |', '| Priya | Design | ✓ |', '| Jordan | Engineering | — |', '',
    '## Agenda', '',
    '- [x] Last week’s actions', '- [ ] Project status', '- [ ] Open questions', '- [ ] Any other business', '',
    '## Notes', '',
    'Key points from the discussion. {{hl:yellow|Highlight anything people must not miss.}}', '',
    '## Decisions', '',
    '> ✅ **Decided:** what was agreed, and why.', '',
    '## Action items', '',
    '| Action | Owner | Due | Status |', '| --- | --- | --- | --- |',
    `| Send the summary | Sam | Tuesday | ${chip('Not started', STATUS)} |`, `| Update the designs | Priya | Friday | ${chip('In progress', STATUS)} |`) } },
  { id: 'report', name: 'Research report', icon: 'book', color: 'purple', text: 'Page view with page numbers, a chart, equations, code and an appendix.', note: { title: 'Research report', icon: 'book', color: 'purple', layout: 'pages', pageSetup: pages('Research report', 'Draft — not for distribution'), content: lines(
    '[[toc]]', '',
    '> 💡 **Summary:** the question, what you found, and why it matters — in three sentences.', '',
    '## Introduction', '',
    'Background and the question this report answers.', '',
    '## Findings', '',
    chart({ t: 'line', title: 'Weekly active users (thousands)', labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'], series: [{ n: 'Control', v: [12, 13, 13, 14, 14, 15] }, { n: 'New onboarding', v: [12, 14, 16, 18, 19, 21] }] }), '',
    'Retention improved for the new onboarding group. The growth rate was estimated as:', '',
    '$$', 'r = \\left(\\frac{N_{end}}{N_{start}}\\right)^{1/t} - 1', '$$', '',
    'where $t$ is the number of weeks.', '',
    '> 💬 “A short pull quote from an interview or source that supports the finding.” — Source name', '',
    '## Method', '',
    'How the data was collected and analysed:', '',
    '```python', 'import pandas as pd', '', 'users = pd.read_csv("weekly_users.csv")', 'growth = (users.end / users.start) ** (1 / users.weeks) - 1', 'print(growth.describe())', '```', '',
    '## Conclusions', '',
    '- What the results mean', '- What we recommend', '- What we’ll look at next', '',
    '[[pagebreak]]', '',
    '## Appendix', '',
    '| Week | Control | New onboarding |', '| --- | --- | --- |', '| W1 | 12 | 12 |', '| W2 | 13 | 14 |', '| W3 | 13 | 16 |', '| W4 | 14 | 18 |', '| W5 | 14 | 19 |', '| W6 | 15 | 21 |') } },
  { id: 'week', name: 'Weekly planner', icon: 'calendar', color: 'amber', text: 'Priorities with chips, daily checklists and a habit tracker.', note: { title: 'This week', icon: 'star', color: 'amber', content: lines(
    '## Top priorities', '',
    `1. Finish the proposal ${chip('High', PRIORITY)}`, `2. Prepare for Thursday’s review ${chip('Medium', PRIORITY)}`, `3. Tidy the shared folder ${chip('Low', PRIORITY)}`, '',
    '## Monday', '', '- [ ] Plan the week', '- [ ] {{color:blue|Team sync at 10:00}}', '',
    '## Tuesday', '', '- [ ] Draft the proposal', '',
    '## Wednesday', '', '- [ ] Review with Sam', '',
    '## Thursday', '', '- [ ] {{hl:yellow|Review meeting — bring the numbers}}', '',
    '## Friday', '', '- [ ] Send the proposal', '- [ ] Look back at the week', '',
    '## Habits', '',
    '| Habit | Mon | Tue | Wed | Thu | Fri |', '| --- | --- | --- | --- | --- | --- |', '| Exercise | ✓ |  | ✓ |  |  |', '| Read 20 minutes | ✓ | ✓ |  |  |  |', '| No phone after 10pm |  | ✓ |  |  |  |', '',
    '## Notes', '', '{{color:gray|Anything to remember for next week.}}') } },
  { id: 'approval', name: 'Approval form', icon: 'signature', color: 'blue', text: 'Page view with header and footer, details, review status and sign-off.', note: { title: 'Approval request', icon: 'file', color: 'blue', layout: 'pages', pageSetup: pages('Company name — Approval request', 'Confidential'), content: lines(
    '## Request details', '',
    '| Field | Details |', '| --- | --- |', '| Requested by | Your name |', '| Date | Today |', '| Amount | $0.00 |', '| Cost centre | — |', '',
    `Review status: ${chip('In review', REVIEW)}`, '',
    '## Description', '',
    'What is being requested, why it is needed, and what happens if it isn’t approved.', '',
    '## Sign-off', '',
    '> 💡 To collect signatures, place the cursor below and choose **Insert → Signature**, then pick who signs. Each person is asked to sign, and their signature appears here.', '',
    '| Approver | Role | Decision |', '| --- | --- | --- |', '| Name | Manager | Pending |', '| Name | Finance | Pending |', '',
    '[[pagebreak]]', '',
    '## Terms', '',
    'Any conditions attached to the approval.') } },
];

/* ---------- spreadsheets ---------- */
// Filled cells set their text colour (as in Excel), so they read in dark mode too.
const B = { b: 1 }, HEAD = { b: 1, bg: '#dbe6f5', fg: '#1f1f1f' }, TITLE = { b: 1, fz: 16 }, NUM = { nf: '#,##0.00' }, NUMB = { nf: '#,##0.00', b: 1 }, PCT = { nf: '0%' }, DATE = { nf: 'mmm d, yyyy' };
const cellsOf = (rows) => { const out = {}; for (const [ref, v, s] of rows) out[ref] = { v: String(v), ...(s ? { s } : {}) }; return out; };
const day = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000); // spreadsheet date number

export const SHEET_TEMPLATES = [
  { id: 'budget', name: 'Monthly budget', text: 'Income, expenses by category, and what’s left.', title: 'Monthly budget', make: () => {
    const exp = [['Rent', 1500, 1500], ['Groceries', 450, 412.6], ['Utilities', 180, 164.2], ['Transport', 120, 98], ['Insurance', 90, 90], ['Savings', 500, 500], ['Eating out', 150, 176.4], ['Other', 100, 54.3]];
    const rows = [['A1', 'Monthly budget', TITLE], ['A3', 'Income', HEAD], ['B3', 'Amount', HEAD], ['A4', 'Salary'], ['B4', 4200, NUM], ['A5', 'Other income'], ['B5', 300, NUM], ['A6', 'Total income', B], ['B6', '=SUM(B4:B5)', NUMB],
      ['A8', 'Expenses', HEAD], ['B8', 'Budget', HEAD], ['C8', 'Actual', HEAD], ['D8', 'Difference', HEAD]];
    exp.forEach(([c, b, a], i) => { const r = 9 + i; rows.push([`A${r}`, c], [`B${r}`, b, NUM], [`C${r}`, a, NUM], [`D${r}`, `=B${r}-C${r}`, NUM]); });
    const t = 9 + exp.length; rows.push([`A${t}`, 'Total expenses', B], [`B${t}`, `=SUM(B9:B${t - 1})`, NUMB], [`C${t}`, `=SUM(C9:C${t - 1})`, NUMB], [`D${t}`, `=B${t}-C${t}`, NUMB],
      [`A${t + 2}`, 'Left this month', B], [`B${t + 2}`, `=B6-C${t}`, { ...NUMB, bg: '#e6f4ea', fg: '#1f1f1f' }]);
    return { sheets: [{ name: 'Budget', cells: cellsOf(rows), w: { A: 150, B: 100, C: 100, D: 100 } }] };
  } },
  { id: 'expenses', name: 'Expense tracker', text: 'A table of expenses with a summary by category.', title: 'Expenses', make: () => {
    const data = [['2026-11-02', 'Groceries', 'Food', 64.2], ['2026-11-03', 'Train pass', 'Transport', 45], ['2026-11-05', 'Lunch with team', 'Food', 23.5], ['2026-11-07', 'Electricity', 'Utilities', 58.9], ['2026-11-09', 'Cinema', 'Fun', 18], ['2026-11-12', 'Groceries', 'Food', 71.35], ['2026-11-14', 'Fuel', 'Transport', 52.1], ['2026-11-15', 'Internet', 'Utilities', 39.99]];
    const rows = [['A1', 'Date'], ['B1', 'Description'], ['C1', 'Category'], ['D1', 'Amount']];
    data.forEach(([d, desc, cat, amt], i) => { const r = i + 2; rows.push([`A${r}`, day(d), DATE], [`B${r}`, desc], [`C${r}`, cat], [`D${r}`, amt, NUM]); });
    const cats = ['Food', 'Transport', 'Utilities', 'Fun'];
    rows.push(['F1', 'Category', HEAD], ['G1', 'Total', HEAD]);
    cats.forEach((c, i) => rows.push([`F${i + 2}`, c], [`G${i + 2}`, `=SUMIF(Expenses[Category],F${i + 2},Expenses[Amount])`, NUM]));
    rows.push([`F${cats.length + 2}`, 'All', B], [`G${cats.length + 2}`, '=SUM(Expenses[Amount])', NUMB]);
    return { sheets: [{ name: 'Expenses', cells: cellsOf(rows), w: { A: 110, B: 160, C: 100, D: 90, F: 100, G: 90 }, tables: [{ name: 'Expenses', range: `A1:D${data.length + 1}` }] }] };
  } },
  { id: 'tracker', name: 'Project tracker', text: 'Tasks, owners, status, dates and progress.', title: 'Project tracker', make: () => {
    const tasks = [['Kick-off meeting', 'Sam', 'Done', '2026-11-02', '2026-11-03', 1], ['Requirements', 'Alex', 'Done', '2026-11-03', '2026-11-10', 1], ['Design', 'Priya', 'In progress', '2026-11-10', '2026-11-21', 0.6], ['Build', 'Jordan', 'In progress', '2026-11-17', '2026-12-12', 0.25], ['Testing', 'Alex', 'Not started', '2026-12-08', '2026-12-19', 0], ['Launch', 'Sam', 'Not started', '2026-12-22', '2026-12-22', 0]];
    const rows = [['A1', 'Project tracker', TITLE], ['A3', 'Task', HEAD], ['B3', 'Owner', HEAD], ['C3', 'Status', HEAD], ['D3', 'Start', HEAD], ['E3', 'Due', HEAD], ['F3', '% done', HEAD]];
    tasks.forEach(([t, o, st, a, d, p], i) => { const r = i + 4; rows.push([`A${r}`, t], [`B${r}`, o], [`C${r}`, st], [`D${r}`, day(a), DATE], [`E${r}`, day(d), DATE], [`F${r}`, p, PCT]); });
    const last = tasks.length + 3;
    rows.push([`A${last + 2}`, 'Done', B], [`B${last + 2}`, `=COUNTIF(C4:C${last},"Done")&" of "&ROWS(C4:C${last})`], [`A${last + 3}`, 'Overall progress', B], [`B${last + 3}`, `=AVERAGE(F4:F${last})`, { ...PCT, b: 1 }]);
    return { sheets: [{ name: 'Tasks', cells: cellsOf(rows), w: { A: 170, B: 90, C: 110, D: 110, E: 110, F: 80 }, dv: [{ range: `C4:C${last + 20}`, type: 'list', v1: 'Not started,In progress,Done' }] }] };
  } },
  { id: 'invoice', name: 'Invoice', text: 'Line items, subtotal, tax and total.', title: 'Invoice', make: () => {
    const items = [['Design work (hours)', 12, 85], ['Development (hours)', 20, 95], ['Hosting (month)', 1, 25]];
    const rows = [['A1', 'INVOICE', TITLE], ['A3', 'Your company'], ['A4', '123 Main Street'], ['D3', 'Invoice #', B], ['E3', '0001'], ['D4', 'Date', B], ['E4', day('2026-11-14'), DATE],
      ['A6', 'Bill to', B], ['A7', 'Client name'], ['A8', 'Client address'],
      ['A10', 'Description', HEAD], ['C10', 'Qty', HEAD], ['D10', 'Unit price', HEAD], ['E10', 'Amount', HEAD]];
    items.forEach(([d, q, u], i) => { const r = 11 + i; rows.push([`A${r}`, d], [`C${r}`, q], [`D${r}`, u, NUM], [`E${r}`, `=C${r}*D${r}`, NUM]); });
    const s = 11 + items.length + 1;
    rows.push([`D${s}`, 'Subtotal', B], [`E${s}`, `=SUM(E11:E${s - 2})`, NUM], [`C${s + 1}`, 0.08, PCT], [`D${s + 1}`, 'Tax', B], [`E${s + 1}`, `=E${s}*C${s + 1}`, NUM], [`D${s + 2}`, 'Total', B], [`E${s + 2}`, `=E${s}+E${s + 1}`, { ...NUMB, bg: '#dbe6f5', fg: '#1f1f1f' }],
      [`A${s + 4}`, 'Thank you for your business.']);
    return { sheets: [{ name: 'Invoice', cells: cellsOf(rows), w: { A: 120, B: 110, C: 60, D: 100, E: 100 } }] };
  } },
];

/* ---------- presentations ---------- */
const ul = (items) => `<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;
/** A slide from one of the app's layouts, with its placeholders filled in order (title, subtitle/body, second column). */
function slide(layout, ...texts) {
  const s = newSlide(layout); let i = 0;
  for (const it of s.items) { if (it.t !== 'text' || i >= texts.length) continue; it.html = texts[i] || ''; i += 1; }
  return s;
}
export const SLIDE_TEMPLATES = [
  { id: 'pitch', name: 'Pitch deck', text: 'Problem, solution, market, model, team and ask.', title: 'Pitch deck', make: () => ({ ratio: '16:9', theme: 'blue', slides: [
    slide('title', 'Company name', 'One sentence about what you do'),
    slide('titleBody', 'The problem', ul(['Who has the problem', 'How they deal with it today', 'Why that isn’t good enough'])),
    slide('titleBody', 'Our solution', ul(['What we built', 'How it solves the problem', 'Why now'])),
    slide('twoCol', 'Market', ul(['Total market size', 'The segment we start with']), ul(['Who else is in it', 'How we’re different'])),
    slide('titleBody', 'Business model', ul(['How we make money', 'Pricing', 'Early traction'])),
    slide('titleBody', 'Team', ul(['Founder — background', 'Co-founder — background', 'Advisors'])),
    slide('section', 'The ask', 'How much we’re raising, and what it gets us'),
  ] }) },
  { id: 'update', name: 'Project update', text: 'Status, progress, risks and next steps.', title: 'Project update', make: () => ({ ratio: '16:9', theme: 'light', slides: [
    slide('title', 'Project update', 'Team · Date'),
    slide('titleBody', 'Status at a glance', ul(['Overall: on track', 'Budget: on plan', 'Next milestone: date'])),
    slide('twoCol', 'Progress', ul(['Done since last update', '…']), ul(['In progress', '…'])),
    slide('titleBody', 'Risks and issues', ul(['Risk — what we’re doing about it', 'Decision needed — by whom, by when'])),
    slide('titleBody', 'Next steps', ul(['Step — owner — date', 'Step — owner — date'])),
  ] }) },
  { id: 'meeting', name: 'Team meeting', text: 'Agenda, updates, decisions and actions.', title: 'Team meeting', make: () => ({ ratio: '16:9', theme: 'minimal', slides: [
    slide('title', 'Team meeting', 'Date'),
    slide('titleBody', 'Agenda', ul(['Updates', 'Discussion', 'Decisions', 'Actions'])),
    slide('titleBody', 'Updates', ul(['Person — update', 'Person — update'])),
    slide('titleBody', 'Decisions', ul(['What we decided, and why'])),
    slide('titleBody', 'Action items', ul(['Action — owner — due date'])),
  ] }) },
];
