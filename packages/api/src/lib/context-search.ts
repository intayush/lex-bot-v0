import type { Manifest, ManifestFile } from '@legal-chatbot/shared';

const RELEVANCE_THRESHOLD = 0.15;
const MAX_RESULTS = 5;
const MAX_CONTEXT_TOKENS = 4500;
const AVG_CHARS_PER_TOKEN = 4;

interface ScoredFile {
  file: ManifestFile;
  score: number;
}

interface SearchResult {
  file: ManifestFile;
  score: number;
  content: string;
}

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'in', 'on', 'to', 'of', 'and', 'or', 'for',
  'was', 'with', 'that', 'this', 'are', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'an', 'as', 'by', 'from', 'it', 'my', 'me',
  'we', 'our', 'can', 'will', 'about', 'would', 'there', 'their',
  'what', 'when', 'how', 'who', 'which', 'if', 'not', 'no', 'so',
  'up', 'out', 'just', 'also', 'than', 'them', 'then', 'its',
  'law', 'legal', 'attorney', 'lawyer', 'firm', 'practice',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function scoreFile(
  file: ManifestFile,
  queryTokens: Set<string>,
  sectionTypeFilter?: string[]
): number {
  const keywordSet = new Set(
    file.keywords.flatMap((k) => tokenize(k))
  );
  const keywordMatch = jaccardSimilarity(queryTokens, keywordSet);

  const titleTokens = new Set(tokenize(file.title));
  let titleMatchCount = 0;
  for (const qt of queryTokens) {
    if (titleTokens.has(qt)) titleMatchCount++;
  }
  const titleMatch = queryTokens.size === 0 ? 0 : titleMatchCount / queryTokens.size;

  let sectionTypeBonus = 0;
  if (sectionTypeFilter && sectionTypeFilter.includes(file.section_type)) {
    sectionTypeBonus = 1.0;
  } else {
    const sectionKeywords: Record<string, string[]> = {
      'practice-area': ['injury', 'law', 'divorce', 'custody', 'estate', 'accident', 'case'],
      'attorney-bio': ['attorney', 'lawyer', 'partner', 'associate'],
      'faq': ['question', 'how', 'what', 'cost', 'fee', 'long', 'much'],
      'contact': ['call', 'phone', 'email', 'address', 'hours', 'location'],
      'about': ['firm', 'history', 'team', 'experience', 'about'],
    };
    const sectionWords = sectionKeywords[file.section_type] || [];
    for (const qt of queryTokens) {
      if (sectionWords.includes(qt)) {
        sectionTypeBonus = 0.5;
        break;
      }
    }
  }

  const fileTokens = new Set(tokenize(file.path));
  let filenameMatch = 0;
  for (const qt of queryTokens) {
    if (fileTokens.has(qt)) {
      filenameMatch = 1.0;
      break;
    }
  }

  return (
    keywordMatch * 0.4 +
    titleMatch * 0.3 +
    sectionTypeBonus * 0.2 +
    filenameMatch * 0.1
  );
}

function scoreFiles(
  manifest: Manifest,
  query: string,
  sectionTypes?: string[]
): ScoredFile[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  return manifest.files
    .map((file) => ({
      file,
      score: scoreFile(file, queryTokens, sectionTypes),
    }))
    .filter((sf) => sf.score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}

export async function searchContext(
  contextStoreUrl: string,
  query: string,
  sectionTypes?: string[],
  manifestCache?: Manifest
): Promise<SearchResult[]> {
  const manifest = manifestCache ?? await fetchManifest(contextStoreUrl);
  const scored = scoreFiles(manifest, query, sectionTypes);

  if (scored.length === 0) return [];

  const maxChars = MAX_CONTEXT_TOKENS * AVG_CHARS_PER_TOKEN;

  // Fetch all scored files concurrently — serial awaits were costing one
  // round-trip per file (50-200ms × N files). Budget trimming happens
  // after all fetches complete.
  const fetched = await Promise.all(
    scored.map(({ file, score }) =>
      fetchFileContent(contextStoreUrl, file.path)
        .then((content) => ({ file, score, content }))
        .catch(() => null),
    ),
  );

  const results: SearchResult[] = [];
  let totalChars = 0;
  for (const item of fetched) {
    if (!item || totalChars >= maxChars) break;
    const trimmedContent = item.content.slice(0, maxChars - totalChars);
    totalChars += trimmedContent.length;
    results.push({ file: item.file, score: item.score, content: trimmedContent });
  }

  return results;
}

export async function fetchManifest(contextStoreUrl: string): Promise<Manifest> {
  const url = new URL('_manifest.json', contextStoreUrl).href;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest from ${url}: ${response.status}`);
  }
  return response.json() as Promise<Manifest>;
}

async function fetchFileContent(contextStoreUrl: string, filePath: string): Promise<string> {
  const url = new URL(filePath, contextStoreUrl).href;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file ${url}: ${response.status}`);
  }
  return response.text();
}

export { scoreFiles, tokenize, RELEVANCE_THRESHOLD, MAX_RESULTS };
export type { ScoredFile, SearchResult };
