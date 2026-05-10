import { extractContent } from './extractor.js';

describe('extractContent', () => {
  it('extracts title from <title> tag', () => {
    const html = '<html><head><title>My Page Title</title></head><body><p>Content</p></body></html>';
    const result = extractContent(html);
    expect(result.title).toBe('My Page Title');
  });

  it('falls back to <h1> if no <title>', () => {
    const html = '<html><head></head><body><h1>Main Heading</h1><p>Content</p></body></html>';
    const result = extractContent(html);
    expect(result.title).toBe('Main Heading');
  });

  it('returns "Untitled" if no <title> or <h1>', () => {
    const html = '<html><head></head><body><p>Just a paragraph</p></body></html>';
    const result = extractContent(html);
    expect(result.title).toBe('Untitled');
  });

  it('strips nav, header, footer, scripts, and styles', () => {
    const html = `
      <html><head><title>Test</title></head><body>
        <nav>Navigation links</nav>
        <header>Header content</header>
        <main>
          <p>Main content here</p>
        </main>
        <footer>Footer content</footer>
        <script>alert("hi")</script>
        <style>.foo { color: red; }</style>
      </body></html>
    `;
    const result = extractContent(html);
    expect(result.text).toContain('Main content here');
    expect(result.text).not.toContain('Navigation links');
    expect(result.text).not.toContain('Header content');
    expect(result.text).not.toContain('Footer content');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('.foo');
  });

  it('extracts headings from content', () => {
    const html = `
      <html><head><title>Test</title></head><body>
        <h1>First Heading</h1>
        <h2>Second Heading</h2>
        <h3>Third Heading</h3>
        <p>Some text</p>
      </body></html>
    `;
    const result = extractContent(html);
    expect(result.headings).toContain('First Heading');
    expect(result.headings).toContain('Second Heading');
    expect(result.headings).toContain('Third Heading');
  });

  it('returns content from <main> if present', () => {
    const html = `
      <html><head><title>Test</title></head><body>
        <div>Outside main</div>
        <main>
          <p>Inside main content</p>
        </main>
        <div>Also outside</div>
      </body></html>
    `;
    const result = extractContent(html);
    expect(result.html).toContain('Inside main content');
    // <main> is selected, so the html is scoped to it
    expect(result.text).toContain('Inside main content');
  });

  it('falls back to <body> if no <main>', () => {
    const html = `
      <html><head><title>Test</title></head><body>
        <div><p>Body content only</p></div>
      </body></html>
    `;
    const result = extractContent(html);
    expect(result.text).toContain('Body content only');
    expect(result.html).toContain('Body content only');
  });

  it('strips role-based navigation elements', () => {
    const html = `
      <html><head><title>Test</title></head><body>
        <div role="navigation">Nav by role</div>
        <div role="banner">Banner by role</div>
        <div role="contentinfo">Content info by role</div>
        <main><p>Actual content</p></main>
      </body></html>
    `;
    const result = extractContent(html);
    expect(result.text).toContain('Actual content');
    expect(result.text).not.toContain('Nav by role');
    expect(result.text).not.toContain('Banner by role');
    expect(result.text).not.toContain('Content info by role');
  });

  it('strips class-based non-content elements', () => {
    const html = `
      <html><head><title>Test</title></head><body>
        <div class="navbar">Navbar</div>
        <div class="sidebar">Sidebar</div>
        <div class="cookie-banner">Cookie notice</div>
        <main><p>Real content</p></main>
      </body></html>
    `;
    const result = extractContent(html);
    expect(result.text).toContain('Real content');
    expect(result.text).not.toContain('Navbar');
    expect(result.text).not.toContain('Sidebar');
    expect(result.text).not.toContain('Cookie notice');
  });
});
