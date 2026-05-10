import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';

interface ExtractedContent {
  title: string;
  text: string;
  headings: string[];
  html: string;
}

export function toMarkdown(content: ExtractedContent): string {
  const result = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeRemark)
    .use(remarkGfm)
    .use(remarkStringify)
    .processSync(content.html);

  let markdown = String(result);

  // Clean up excessive blank lines
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  // Remove empty links and image placeholders
  markdown = markdown.replace(/\[]\([^)]*\)/g, '');

  return markdown.trim();
}
