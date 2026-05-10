import { z } from 'zod';

export const API_KEY_PREFIX = 'lc_live_';
export const DEV_API_KEY = 'dev_test_key';

export const apiKeySchema = z.string().refine(
  (key) => key === DEV_API_KEY || key.startsWith(API_KEY_PREFIX),
  { message: `API key must start with "${API_KEY_PREFIX}" or be the dev key` }
);

export type ApiKey = z.infer<typeof apiKeySchema>;
