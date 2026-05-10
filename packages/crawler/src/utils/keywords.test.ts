import { extractKeywords } from './keywords.js';

describe('extractKeywords', () => {
  it('returns top keywords by frequency', () => {
    const content = 'criminal defense criminal law criminal attorney defense attorney';
    const keywords = extractKeywords('', content);
    expect(keywords[0]).toBe('criminal');
    expect(keywords[1]).toBe('defense');
    expect(keywords[2]).toBe('attorney');
  });

  it('filters stop words', () => {
    const content = 'the law is for the people and the community';
    const keywords = extractKeywords('', content);
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('is');
    expect(keywords).not.toContain('for');
    expect(keywords).not.toContain('and');
  });

  it('filters short words (2 characters or less)', () => {
    const content = 'we do it on to go at in criminal defense';
    const keywords = extractKeywords('', content);
    expect(keywords).not.toContain('do');
    expect(keywords).not.toContain('it');
    expect(keywords).not.toContain('go');
    expect(keywords).toContain('criminal');
  });

  it('returns a maximum of 10 keywords', () => {
    const content = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
    const keywords = extractKeywords('', content);
    expect(keywords.length).toBeLessThanOrEqual(10);
  });

  it('handles empty input', () => {
    const keywords = extractKeywords('', '');
    expect(keywords).toEqual([]);
  });

  it('combines title and content for keyword extraction', () => {
    const title = 'Criminal Defense';
    const content = 'Our firm focuses on criminal defense cases. Defense strategies are key.';
    const keywords = extractKeywords(title, content);
    // "defense" and "criminal" appear in both title and content
    expect(keywords).toContain('criminal');
    expect(keywords).toContain('defense');
  });

  it('lowercases all keywords', () => {
    const keywords = extractKeywords('Criminal Defense', 'Criminal DEFENSE attorney');
    for (const kw of keywords) {
      expect(kw).toBe(kw.toLowerCase());
    }
  });
});
