#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { crawl } from './lib/crawler.js';

const { values } = parseArgs({
  options: {
    url: { type: 'string', short: 'u' },
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o', default: './chatbot-context/' },
    exclude: { type: 'string', multiple: true },
    'max-pages': { type: 'string', default: '100' },
    deterministic: { type: 'boolean', default: false },
  },
});

if (!values.url && !values.input) {
  console.error('Error: Either --url or --input is required.');
  console.log('\nUsage:');
  console.log('  legal-chatbot-crawl --url https://example.com --output ./chatbot-context/');
  console.log('  legal-chatbot-crawl --input ./local-html/ --output ./chatbot-context/');
  console.log('\nOptions:');
  console.log('  --url, -u       Root URL to crawl');
  console.log('  --input, -i     Local directory of HTML files');
  console.log('  --output, -o    Output directory (default: ./chatbot-context/)');
  console.log('  --exclude       URL patterns to skip (repeatable)');
  console.log('  --max-pages     Maximum pages to crawl (default: 100)');
  process.exit(1);
}

const maxPages = parseInt(values['max-pages'] || '100', 10);

crawl({
  url: values.url,
  inputDir: values.input,
  outputDir: values.output!,
  exclude: values.exclude || [],
  maxPages,
  deterministic: values.deterministic,
}).then((result) => {
  console.log(`\nCrawl complete.`);
  console.log(`  Pages crawled: ${result.pageCount}`);
  console.log(`  Output: ${result.outputDir}`);
  console.log(`  Manifest: ${result.outputDir}/_manifest.json`);
}).catch((err) => {
  console.error('Crawl failed:', err.message);
  process.exit(1);
});
