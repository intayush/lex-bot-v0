import * as cheerio from 'cheerio';

interface ExtractedContent {
  title: string;
  text: string;
  headings: string[];
  html: string;
}

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.nav', '.navbar', '.header', '.footer', '.sidebar',
  '.cookie-banner', '.cookie-notice', '.modal',
  '.advertisement', '.ad', '.ads',
  '#nav', '#header', '#footer', '#sidebar',
];

export function extractContent(rawHtml: string): ExtractedContent {
  const $ = cheerio.load(rawHtml);

  // Get title
  const title = $('title').text().trim()
    || $('h1').first().text().trim()
    || 'Untitled';

  // Remove non-content elements
  for (const selector of REMOVE_SELECTORS) {
    $(selector).remove();
  }

  // Extract headings for structure
  const headings: string[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    headings.push($(el).text().trim());
  });

  // Get main content area if identifiable
  let contentEl = $('main, [role="main"], article, .content, #content, .main');
  if (contentEl.length === 0) {
    contentEl = $('body');
  }

  const contentHtml = contentEl.html() || '';
  const text = contentEl.text().replace(/\s+/g, ' ').trim();

  return { title, text, headings, html: contentHtml };
}
