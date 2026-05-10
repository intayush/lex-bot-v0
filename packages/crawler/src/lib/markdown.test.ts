import { toMarkdown } from './markdown.js';

function makeContent(html: string) {
  return { title: 'Test', text: '', headings: [], html };
}

describe('toMarkdown', () => {
  it('converts headings to markdown', () => {
    const result = toMarkdown(makeContent('<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>'));
    expect(result).toContain('# Title');
    expect(result).toContain('## Subtitle');
    expect(result).toContain('### Section');
  });

  it('converts unordered lists to markdown', () => {
    const result = toMarkdown(makeContent('<ul><li>First</li><li>Second</li><li>Third</li></ul>'));
    expect(result).toContain('* First');
    expect(result).toContain('* Second');
    expect(result).toContain('* Third');
  });

  it('converts ordered lists to markdown', () => {
    const result = toMarkdown(makeContent('<ol><li>One</li><li>Two</li><li>Three</li></ol>'));
    expect(result).toContain('1. One');
    expect(result).toContain('2. Two');
    expect(result).toContain('3. Three');
  });

  it('converts paragraphs to markdown', () => {
    const result = toMarkdown(makeContent('<p>First paragraph.</p><p>Second paragraph.</p>'));
    expect(result).toContain('First paragraph.');
    expect(result).toContain('Second paragraph.');
  });

  it('cleans up excessive blank lines', () => {
    const result = toMarkdown(makeContent('<p>A</p>\n\n\n\n\n<p>B</p>'));
    // Should not have 3+ consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('removes empty links', () => {
    const result = toMarkdown(makeContent('<a href="https://example.com"></a><p>Text</p>'));
    expect(result).not.toContain('[](');
    expect(result).toContain('Text');
  });

  it('preserves links with text', () => {
    const result = toMarkdown(makeContent('<a href="https://example.com">Click here</a>'));
    expect(result).toContain('[Click here](https://example.com)');
  });

  it('converts bold and italic', () => {
    const result = toMarkdown(makeContent('<p><strong>Bold</strong> and <em>italic</em></p>'));
    expect(result).toContain('**Bold**');
    expect(result).toContain('*italic*');
  });

  it('handles empty html', () => {
    const result = toMarkdown(makeContent(''));
    expect(result).toBe('');
  });
});
