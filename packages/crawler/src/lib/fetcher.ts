import fs from 'fs';
import path from 'path';

interface FetchOptions {
  url?: string;
  inputDir?: string;
  exclude: string[];
  maxPages: number;
}

interface Page {
  url: string;
  html: string;
}

export async function fetchPages(options: FetchOptions): Promise<Page[]> {
  if (options.inputDir) {
    return fetchFromLocal(options.inputDir, options.maxPages);
  }
  if (options.url) {
    return fetchFromUrl(options.url, options.exclude, options.maxPages);
  }
  throw new Error('Either url or inputDir is required');
}

async function fetchFromLocal(dir: string, maxPages: number): Promise<Page[]> {
  const absDir = path.resolve(dir);
  const files = findHtmlFiles(absDir).slice(0, maxPages);

  return files.map((filePath) => {
    const relativePath = path.relative(absDir, filePath);
    const url = `file://${filePath}`;
    const html = fs.readFileSync(filePath, 'utf8');
    return { url, html };
  });
}

function findHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findHtmlFiles(fullPath));
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.htm')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function fetchFromUrl(rootUrl: string, exclude: string[], maxPages: number): Promise<Page[]> {
  const visited = new Set<string>();
  const queue: string[] = [rootUrl];
  const pages: Page[] = [];
  const rootOrigin = new URL(rootUrl).origin;

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()!;
    const normalized = normalizeUrl(url);

    if (visited.has(normalized)) continue;
    if (isExcluded(normalized, exclude)) continue;
    visited.add(normalized);

    try {
      console.log(`  Fetching: ${normalized}`);
      const response = await fetch(normalized);
      if (!response.ok) continue;

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) continue;

      const html = await response.text();
      pages.push({ url: normalized, html });

      // Discover links
      const links = extractLinks(html, normalized);
      for (const link of links) {
        const linkOrigin = new URL(link).origin;
        if (linkOrigin === rootOrigin && !visited.has(normalizeUrl(link))) {
          queue.push(link);
        }
      }
    } catch {
      // Skip failed fetches
    }
  }

  return pages;
}

function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  // Remove trailing slash except for root
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.href;
}

function isExcluded(url: string, patterns: string[]): boolean {
  const pathname = new URL(url).pathname;
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern;
  });
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href="([^"]+)"/g;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl).href;
      if (resolved.startsWith('http')) {
        links.push(resolved);
      }
    } catch {
      // Skip invalid URLs
    }
  }
  return links;
}
