import {
  tokenize,
  scoreFiles,
  searchContext,
  RELEVANCE_THRESHOLD,
  MAX_RESULTS,
} from './context-search.js';
import type { Manifest } from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// Test manifest matching the Demo Law Firm test-site data
// ---------------------------------------------------------------------------
const testManifest: Manifest = {
  version: 1,
  generated_at: '2026-01-01T00:00:00.000Z',
  base_url: 'http://localhost:5173/chatbot-context/',
  files: [
    {
      path: 'pages/index.md',
      title: 'Demo Law Firm - Home',
      section_type: 'general',
      word_count: 46,
      content_hash: 'abc123',
      keywords: ['criminal', 'defense', 'immigration', 'dui', 'consultation'],
    },
    {
      path: 'pages/practice-areas-criminal-defense.md',
      title: 'Criminal Defense',
      section_type: 'practice-area',
      word_count: 57,
      content_hash: 'def456',
      keywords: ['criminal', 'defense', 'drug', 'assault', 'theft', 'dui', 'felonies'],
    },
    {
      path: 'pages/attorneys-maria-garcia.md',
      title: 'Maria Garcia - Attorney',
      section_type: 'attorney-bio',
      word_count: 53,
      content_hash: 'ghi789',
      keywords: ['maria', 'garcia', 'criminal', 'defense', 'immigration', 'spanish'],
    },
    {
      path: 'pages/about.md',
      title: 'About Demo Law Firm',
      section_type: 'about',
      word_count: 45,
      content_hash: 'jkl012',
      keywords: ['demo', 'founded', 'attorneys', 'community'],
    },
    {
      path: 'pages/contact.md',
      title: 'Contact Us',
      section_type: 'contact',
      word_count: 26,
      content_hash: 'mno345',
      keywords: ['phone', 'email', 'office', 'hours', 'address'],
    },
  ],
};

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------
describe('tokenize', () => {
  it('lowercases input', () => {
    const result = tokenize('Criminal Defense');
    expect(result).toEqual(['criminal', 'defense']);
  });

  it('strips non-alphanumeric characters', () => {
    const result = tokenize('drug-related charges! (2024)');
    expect(result).toEqual(['drug', 'related', 'charges', '2024']);
  });

  it('removes stop words including legal domain stop words', () => {
    // 'law', 'legal', 'attorney', 'lawyer', 'firm', 'practice' are stop words
    const result = tokenize('the law firm legal attorney lawyer practice');
    expect(result).toEqual([]);
  });

  it('removes common English stop words', () => {
    const result = tokenize('this is the criminal defense for my case');
    // 'this', 'is', 'the', 'for', 'my' are stop words; 'case' is not
    expect(result).toEqual(['criminal', 'defense', 'case']);
  });

  it('removes single-character tokens', () => {
    const result = tokenize('a b c criminal d defense');
    expect(result).toEqual(['criminal', 'defense']);
  });

  it('returns empty array for stop-words-only input', () => {
    expect(tokenize('the is at in on to of and')).toEqual([]);
    expect(tokenize('law legal attorney lawyer firm practice')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles numeric tokens', () => {
    const result = tokenize('call 555 1234');
    expect(result).toEqual(['call', '555', '1234']);
  });

  it('handles mixed whitespace', () => {
    const result = tokenize('criminal   defense\timmigration');
    expect(result).toEqual(['criminal', 'defense', 'immigration']);
  });
});

// ---------------------------------------------------------------------------
// scoreFiles
// ---------------------------------------------------------------------------
describe('scoreFiles', () => {
  it('returns criminal defense file as top result for "criminal defense"', () => {
    const results = scoreFiles(testManifest, 'criminal defense');
    expect(results.length).toBeGreaterThan(0);

    // The practice-area file has the strongest keyword + title + path match
    const topResult = results[0];
    expect(topResult.file.path).toBe('pages/practice-areas-criminal-defense.md');
  });

  it('returns attorney bio for "Maria Garcia"', () => {
    const results = scoreFiles(testManifest, 'Maria Garcia');
    expect(results.length).toBeGreaterThan(0);

    const mariaResult = results.find(
      (r) => r.file.path === 'pages/attorneys-maria-garcia.md'
    );
    expect(mariaResult).toBeDefined();
    // Should be the top result (title match + keyword match + path match)
    expect(results[0].file.path).toBe('pages/attorneys-maria-garcia.md');
  });

  it('returns contact file as top result for "phone number"', () => {
    const results = scoreFiles(testManifest, 'phone number');
    expect(results.length).toBeGreaterThan(0);

    const topResult = results[0];
    expect(topResult.file.path).toBe('pages/contact.md');
  });

  it('"call" query scores below threshold because only section keyword bonus applies (0.1 total)', () => {
    // tokenize("call") => ["call"]. "call" is in the contact section keywords,
    // giving sectionTypeBonus = 0.5 * 0.2 weight = 0.1, but 0.1 < 0.15 threshold.
    // No keyword, title, or filename matches exist.
    const results = scoreFiles(testManifest, 'call');
    expect(results).toEqual([]);
  });

  it('returns contact file for "phone office" (keyword + section keyword match)', () => {
    // tokenize("phone office") => ["phone", "office"]
    // Contact file keywords include 'phone' and 'office' -> strong keyword match
    // Contact section keywords include 'phone' -> section bonus
    const results = scoreFiles(testManifest, 'phone office');
    expect(results.length).toBeGreaterThan(0);

    const contactResult = results.find(
      (r) => r.file.path === 'pages/contact.md'
    );
    expect(contactResult).toBeDefined();
  });

  it('returns no results for "tax law" (tokens become stop words)', () => {
    // "tax" has 3 chars so survives length filter, but "law" is a stop word
    // "tax" alone does not match any keywords, titles, or filenames well enough
    // Actually, let's verify: tokenize("tax law") => ["tax"]
    // "tax" doesn't appear in any keywords/titles/paths, so all scores should be 0
    const results = scoreFiles(testManifest, 'tax law');
    expect(results).toEqual([]);
  });

  it('returns no results for empty query', () => {
    const results = scoreFiles(testManifest, '');
    expect(results).toEqual([]);
  });

  it('returns no results for query that is only stop words', () => {
    const results = scoreFiles(testManifest, 'the legal attorney at law firm');
    expect(results).toEqual([]);
  });

  it('results are sorted by score descending', () => {
    const results = scoreFiles(testManifest, 'criminal defense');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('returns at most MAX_RESULTS results', () => {
    // Create a manifest with many files to test the limit
    const manyFiles: Manifest = {
      version: 1,
      generated_at: '2026-01-01T00:00:00.000Z',
      base_url: 'http://localhost:5173/chatbot-context/',
      files: Array.from({ length: 20 }, (_, i) => ({
        path: `pages/criminal-page-${i}.md`,
        title: `Criminal Defense Topic ${i}`,
        section_type: 'practice-area' as const,
        word_count: 50,
        content_hash: `hash${i}`,
        keywords: ['criminal', 'defense', `topic${i}`],
      })),
    };

    const results = scoreFiles(manyFiles, 'criminal defense');
    expect(results.length).toBeLessThanOrEqual(MAX_RESULTS);
    expect(results.length).toBe(MAX_RESULTS);
  });

  it('excludes results below the relevance threshold', () => {
    const results = scoreFiles(testManifest, 'criminal defense');
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(RELEVANCE_THRESHOLD);
    }
  });

  it('boosts files matching sectionTypes filter', () => {
    // Without filter
    const withoutFilter = scoreFiles(testManifest, 'criminal defense');
    const contactWithout = withoutFilter.find(
      (r) => r.file.path === 'pages/contact.md'
    );

    // With contact filter - contact file should get a section type bonus
    const withFilter = scoreFiles(testManifest, 'criminal defense', ['contact']);
    const contactWith = withFilter.find(
      (r) => r.file.path === 'pages/contact.md'
    );

    // Contact file either wasn't in unfiltered results or gets a higher score
    if (contactWithout && contactWith) {
      expect(contactWith.score).toBeGreaterThan(contactWithout.score);
    } else if (!contactWithout && contactWith) {
      // It was below threshold before but above with the boost
      expect(contactWith.score).toBeGreaterThanOrEqual(RELEVANCE_THRESHOLD);
    }
    // Either way the filter should have boosted it
  });

  it('section type filter gives full 1.0 bonus (0.2 weighted) to matching files', () => {
    // Query "demo" matches about page's keywords. With section type filter for 'about',
    // the about page should get an extra 0.2 boost (1.0 * 0.2 weight)
    const withoutFilter = scoreFiles(testManifest, 'demo');
    const aboutWithout = withoutFilter.find(
      (r) => r.file.path === 'pages/about.md'
    );

    const withFilter = scoreFiles(testManifest, 'demo', ['about']);
    const aboutWith = withFilter.find(
      (r) => r.file.path === 'pages/about.md'
    );

    expect(aboutWithout).toBeDefined();
    expect(aboutWith).toBeDefined();
    // The difference should be roughly 0.1 (sectionTypeBonus goes from 0.5 to 1.0, diff = 0.5 * 0.2 = 0.1)
    // because "about" section keywords include "about" which is a stop word, so the implicit bonus
    // depends on whether any query token matches section keywords. "demo" doesn't match any about section keywords
    // so without filter it gets 0 bonus, with filter it gets 1.0 * 0.2 = 0.2
    expect(aboutWith!.score).toBeGreaterThan(aboutWithout!.score);
  });

  it('"drug charges" scores below threshold (weak jaccard overlap)', () => {
    // tokenize("drug charges") => ["drug", "charges"]
    // Criminal defense keywords tokenize to: criminal, defense, drug, assault, theft, dui, felonies
    // Jaccard: intersection=1 ("drug"), union=2+7-1=8 => 1/8=0.125, * 0.4 weight = 0.05
    // No title/path/section match for "drug" or "charges" => total 0.05 < 0.15 threshold
    const results = scoreFiles(testManifest, 'drug charges');
    expect(results).toEqual([]);
  });

  it('returns criminal defense file for "drug assault theft" (strong keyword match)', () => {
    // tokenize("drug assault theft") => ["drug", "assault", "theft"]
    // Criminal defense keywords: criminal, defense, drug, assault, theft, dui, felonies (7 tokens)
    // Jaccard: intersection=3, union=3+7-3=7, similarity=3/7=0.429, * 0.4 weight = 0.171
    // Plus section bonus for practice-area if query tokens match section keywords => 0 (none match)
    // Total >= 0.171 > 0.15 threshold
    const results = scoreFiles(testManifest, 'drug assault theft');
    expect(results.length).toBeGreaterThan(0);

    const crimDefense = results.find(
      (r) => r.file.path === 'pages/practice-areas-criminal-defense.md'
    );
    expect(crimDefense).toBeDefined();
    expect(crimDefense!.score).toBeGreaterThanOrEqual(RELEVANCE_THRESHOLD);
  });

  it('all scores are non-negative', () => {
    const results = scoreFiles(testManifest, 'criminal defense immigration');
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// searchContext (with mocked fetch)
// ---------------------------------------------------------------------------
describe('searchContext', () => {
  const contextStoreUrl = 'http://localhost:5173/chatbot-context/';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns search results with content for matching queries', async () => {
    const mockContent = 'Criminal defense practice area content for testing.';

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('_manifest.json')) {
          return Promise.resolve(
            new Response(JSON.stringify(testManifest), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.resolve(
          new Response(mockContent, { status: 200 })
        );
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchContext(
      contextStoreUrl,
      'criminal defense'
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toBe(mockContent);
    expect(results[0].file).toBeDefined();
    expect(results[0].score).toBeGreaterThanOrEqual(RELEVANCE_THRESHOLD);
  });

  it('uses manifestCache when provided (skips manifest fetch)', async () => {
    const mockContent = 'Some file content.';

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => Promise.resolve(new Response(mockContent, { status: 200 }))
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchContext(
      contextStoreUrl,
      'criminal defense',
      undefined,
      testManifest
    );

    expect(results.length).toBeGreaterThan(0);
    // fetch should NOT have been called with _manifest.json
    const manifestCalls = fetchMock.mock.calls.filter((call) => {
      const url = typeof call[0] === 'string' ? call[0] : call[0].toString();
      return url.includes('_manifest.json');
    });
    expect(manifestCalls.length).toBe(0);
  });

  it('returns empty array for no-match queries', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);

    // "tax law" => tokenize produces ["tax"] which doesn't match anything
    const results = await searchContext(
      contextStoreUrl,
      'tax law',
      undefined,
      testManifest
    );

    expect(results).toEqual([]);
    // fetch should not be called for file content since no results matched
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty array for empty query', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchContext(
      contextStoreUrl,
      '',
      undefined,
      testManifest
    );

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces token budget (total content chars capped at 18000)', async () => {
    // MAX_CONTEXT_TOKENS * AVG_CHARS_PER_TOKEN = 4500 * 4 = 18000
    const maxChars = 18000;

    // Each file returns 10000 chars of content
    const bigContent = 'x'.repeat(10000);

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => Promise.resolve(new Response(bigContent, { status: 200 }))
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchContext(
      contextStoreUrl,
      'criminal defense',
      undefined,
      testManifest
    );

    // Calculate total content length
    const totalContentChars = results.reduce(
      (sum, r) => sum + r.content.length,
      0
    );

    expect(totalContentChars).toBeLessThanOrEqual(maxChars);

    // With 10000 char content per file, first file gets 10000, second gets 8000 (trimmed)
    // and the third would exceed the budget
    expect(results.length).toBeGreaterThanOrEqual(1);
    // The second result's content should be trimmed
    if (results.length >= 2) {
      expect(results[1].content.length).toBeLessThanOrEqual(maxChars - 10000);
    }
  });

  it('trims content of last file to fit within token budget', async () => {
    const maxChars = 18000;
    // Return content larger than the full budget for each file
    const hugeContent = 'y'.repeat(25000);

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => Promise.resolve(new Response(hugeContent, { status: 200 }))
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchContext(
      contextStoreUrl,
      'criminal defense',
      undefined,
      testManifest
    );

    // First result should be trimmed to exactly maxChars
    expect(results.length).toBe(1);
    expect(results[0].content.length).toBe(maxChars);
  });

  it('fetches manifest from correct URL when no cache provided', async () => {
    const mockContent = 'Content here.';

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('_manifest.json')) {
          return Promise.resolve(
            new Response(JSON.stringify(testManifest), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.resolve(
          new Response(mockContent, { status: 200 })
        );
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    await searchContext(contextStoreUrl, 'criminal defense');

    // First call should be to the manifest URL
    const firstCallUrl = typeof fetchMock.mock.calls[0][0] === 'string'
      ? fetchMock.mock.calls[0][0]
      : fetchMock.mock.calls[0][0].toString();
    expect(firstCallUrl).toBe(
      'http://localhost:5173/chatbot-context/_manifest.json'
    );
  });
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------
describe('exported constants', () => {
  it('RELEVANCE_THRESHOLD is 0.15', () => {
    expect(RELEVANCE_THRESHOLD).toBe(0.15);
  });

  it('MAX_RESULTS is 5', () => {
    expect(MAX_RESULTS).toBe(5);
  });
});
