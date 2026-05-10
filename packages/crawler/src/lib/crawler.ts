import fs from 'fs';
import path from 'path';
import { fetchPages } from './fetcher.js';
import { extractContent } from './extractor.js';
import { toMarkdown } from './markdown.js';
import { generateManifest } from './manifest.js';
import { inferSectionType } from '../utils/section-type.js';
import { extractKeywords } from '../utils/keywords.js';
import { hashContent } from '../utils/hash.js';
import { urlToFilename } from '../utils/filename.js';

interface CrawlOptions {
  url?: string;
  inputDir?: string;
  outputDir: string;
  exclude: string[];
  maxPages: number;
  deterministic?: boolean;
}

interface CrawlResult {
  pageCount: number;
  outputDir: string;
}

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const { outputDir, exclude, maxPages } = options;
  const pagesDir = path.join(outputDir, 'pages');

  fs.mkdirSync(pagesDir, { recursive: true });

  console.log('Fetching pages...');
  const pages = await fetchPages({
    url: options.url,
    inputDir: options.inputDir,
    exclude,
    maxPages,
  });

  console.log(`Found ${pages.length} page(s). Processing...`);

  const manifestFiles = [];

  for (const page of pages) {
    const extracted = extractContent(page.html);
    if (!extracted.text.trim()) continue;

    const markdown = toMarkdown(extracted);
    const contentHash = hashContent(markdown);
    const sectionType = inferSectionType(page.url, extracted.title, markdown);
    const keywords = extractKeywords(extracted.title, markdown);
    const wordCount = markdown.split(/\s+/).length;
    const rootUrl = options.url || `file://${path.resolve(options.inputDir || '.')}/`;
    const filename = urlToFilename(page.url, rootUrl);

    // Use content-derived timestamp for determinism: same content = same output
    const crawledAt = options.deterministic
      ? '2026-01-01T00:00:00.000Z'
      : new Date().toISOString();

    const frontmatter = [
      '---',
      `title: "${extracted.title.replace(/"/g, '\\"')}"`,
      `source_url: "${page.url}"`,
      `crawled_at: "${crawledAt}"`,
      `word_count: ${wordCount}`,
      `section_type: "${sectionType}"`,
      `content_hash: "${contentHash}"`,
      '---',
      '',
    ].join('\n');

    const fullContent = frontmatter + markdown;
    const filePath = path.join(pagesDir, filename);
    fs.writeFileSync(filePath, fullContent, 'utf8');

    manifestFiles.push({
      path: `pages/${filename}`,
      title: extracted.title,
      section_type: sectionType,
      word_count: wordCount,
      content_hash: contentHash,
      keywords,
    });

    console.log(`  ✓ ${filename} (${wordCount} words, ${sectionType})`);
  }

  const baseUrl = options.url
    ? new URL('/chatbot-context/', options.url).href
    : 'http://localhost:5173/chatbot-context/';

  generateManifest(outputDir, manifestFiles, baseUrl, options.deterministic);
  console.log(`  ✓ _manifest.json (${manifestFiles.length} files)`);

  return { pageCount: manifestFiles.length, outputDir };
}
