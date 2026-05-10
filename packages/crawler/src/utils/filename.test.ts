import { urlToFilename } from './filename.js';

describe('urlToFilename', () => {
  const rootUrl = 'https://example.com/';

  it('returns index.md for the root URL', () => {
    expect(urlToFilename('https://example.com/', rootUrl)).toBe('index.md');
    expect(urlToFilename('https://example.com', rootUrl)).toBe('index.md');
  });

  it('converts simple paths', () => {
    expect(urlToFilename('https://example.com/about.html', rootUrl)).toBe('about.md');
  });

  it('converts nested paths replacing slashes with dashes', () => {
    // The `/` is replaced with `--`, then the cleanup step collapses multiple dashes to one
    expect(urlToFilename('https://example.com/attorneys/john-smith.html', rootUrl)).toBe('attorneys-john-smith.md');
  });

  it('converts practice area nested paths', () => {
    expect(urlToFilename('https://example.com/practice-areas/criminal-defense.html', rootUrl)).toBe('practice-areas-criminal-defense.md');
  });

  it('handles paths without .html extension', () => {
    expect(urlToFilename('https://example.com/about', rootUrl)).toBe('about.md');
    expect(urlToFilename('https://example.com/attorneys/jane-doe', rootUrl)).toBe('attorneys-jane-doe.md');
  });

  describe('file:// URLs', () => {
    const fileRoot = 'file:///path/to/test-site/';

    it('converts file URL to relative filename', () => {
      expect(urlToFilename('file:///path/to/test-site/about.html', fileRoot)).toBe('about.md');
    });

    it('converts nested file URL paths', () => {
      expect(urlToFilename('file:///path/to/test-site/attorneys/maria-garcia.html', fileRoot)).toBe('attorneys-maria-garcia.md');
    });
  });

  it('lowercases the output', () => {
    expect(urlToFilename('https://example.com/About-Us.html', rootUrl)).toBe('about-us.md');
  });

  it('strips non-alphanumeric characters except dashes', () => {
    expect(urlToFilename('https://example.com/page@one!two.html', rootUrl)).toBe('page-one-two.md');
  });
});
