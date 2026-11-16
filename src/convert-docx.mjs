// Word (.docx) → the app's document format, for "Open as editable" on an uploaded Word file. Best effort, like other
// office suites: headings, paragraphs, bold/italic, lists, links, tables and pictures come across; exotic layout doesn't.
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export async function docxToMarkdown(buffer, { saveImage }) {
  const { value: html } = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const data = await image.read(); const url = await saveImage({ data, mime: image.contentType || 'image/png' });
      return url ? { src: url } : { src: '' };
    }),
  });
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });
  td.use(gfm);
  // Word tables have no header row, which Markdown tables need: use the first row as the header.
  td.addRule('anyTable', {
    filter: 'table',
    replacement: (content, node) => {
      // walk the table's rows and cells (the server-side parser has no querySelectorAll)
      const trs = []; const walk = (n) => { for (const c of n.childNodes || []) { if (c.nodeName === 'TR') trs.push(c); else if (c.nodeType === 1) walk(c); } }; walk(node);
      const rows = trs.map((tr) => [...tr.childNodes].filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH').map((c) => td.turndown(c.innerHTML || c.textContent || '').replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()));
      if (!rows.length) return '';
      const width = Math.max(...rows.map((r) => r.length)); const pad = (r) => [...r, ...Array(width - r.length).fill('')];
      return `\n\n| ${pad(rows[0]).join(' | ')} |\n| ${Array(width).fill('---').join(' | ')} |\n${rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`).join('\n')}\n\n`;
    },
  });
  td.addRule('emptyImage', { filter: (n) => n.nodeName === 'IMG' && !n.getAttribute('src'), replacement: () => '' });
  return td.turndown(html)
    .replace(/^(\s*)([-*]|\d+\.)\s{2,}/gm, '$1$2 ') // "-   item" → "- item"
    .replace(/\n{3,}/g, '\n\n').trim();
}
