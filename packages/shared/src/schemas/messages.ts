import { z } from 'zod';

export const messageRoleSchema = z.enum(['user', 'assistant', 'system']);

export const messageSchema = z.object({
  role: messageRoleSchema,
  content: z.string(),
});

export const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1),
});

export type MessageRole = z.infer<typeof messageRoleSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
