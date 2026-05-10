import fs from 'fs';
import path from 'path';
import { scoreFiles, tokenize } from '../src/lib/context-search.js';
import type { Manifest } from '@legal-chatbot/shared';

const manifestPath = path.resolve(import.meta.dirname, '../../../chatbot-context/_manifest.json');
const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const query = process.argv[2];
if (!query) {
  console.log('Usage: npx tsx scripts/test-search.ts "your query here"');
  console.log('\nExample queries:');
  console.log('  "I was in a car accident"');
  console.log('  "John Smith"');
  console.log('  "divorce"');
  console.log('  "tax law"');
  process.exit(1);
}

console.log(`\nQuery: "${query}"`);
console.log(`Tokens: [${[...tokenize(query)].join(', ')}]`);
console.log('---');

const results = scoreFiles(manifest, query);

if (results.length === 0) {
  console.log('No results above threshold (0.15). Query is out of scope for this firm.');
} else {
  console.log(`Found ${results.length} result(s):\n`);
  for (const { file, score } of results) {
    console.log(`  Score: ${score.toFixed(3)} | ${file.title}`);
    console.log(`         Path: ${file.path}`);
    console.log(`         Type: ${file.section_type}`);
    console.log(`         Keywords: ${file.keywords.join(', ')}`);
    console.log('');
  }
}
