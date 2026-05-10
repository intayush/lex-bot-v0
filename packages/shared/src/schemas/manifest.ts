import { z } from 'zod';

export const manifestFileSchema = z.object({
  path: z.string(),
  title: z.string(),
  section_type: z.enum([
    'practice-area',
    'attorney-bio',
    'faq',
    'blog-post',
    'contact',
    'about',
    'general',
  ]),
  word_count: z.number().int().positive(),
  content_hash: z.string(),
  keywords: z.array(z.string()),
});

export const manifestSchema = z.object({
  version: z.number().int(),
  generated_at: z.string(),
  base_url: z.string().url(),
  files: z.array(manifestFileSchema),
});

export type ManifestFile = z.infer<typeof manifestFileSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
