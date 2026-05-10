import { z } from 'zod';

export const frontmatterSchema = z.object({
  title: z.string(),
  source_url: z.string().url(),
  crawled_at: z.string(),
  word_count: z.number().int().positive(),
  section_type: z.enum([
    'practice-area',
    'attorney-bio',
    'faq',
    'blog-post',
    'contact',
    'about',
    'general',
  ]),
  content_hash: z.string(),
});

export type Frontmatter = z.infer<typeof frontmatterSchema>;
