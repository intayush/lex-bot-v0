import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/auth', () => ({
  verifyApiKey: vi.fn(async (k: string) =>
    k === 'good' ? { accountId: 'acct_1' } : null),
}));
vi.mock('../../../../lib/session', () => ({
  revertLastTurn: vi.fn(async () => ({ messages: [], sopState: null })),
  getSessionForSOP: vi.fn(async () => ({ messages: [], sopState: null, conversationAnchorIso: '' })),
}));
vi.mock('../../../../lib/sop-config', () => ({ getCaseTypes: vi.fn(async () => []) }));

import { POST } from './route';

function req(headers: Record<string, string>) {
  return new Request('http://x/api/chat/undo', { method: 'POST', headers });
}

describe('POST /api/chat/undo', () => {
  it('401 without api key', async () => {
    const res = await POST(req({ 'x-session-id': 's1' }));
    expect(res.status).toBe(401);
  });

  it('401 with invalid api key', async () => {
    const res = await POST(req({ 'x-api-key': 'bad', 'x-session-id': 's1' }));
    expect(res.status).toBe(401);
  });

  it('400 without session id', async () => {
    const res = await POST(req({ 'x-api-key': 'good' }));
    expect(res.status).toBe(400);
  });

  it('200 with history-shaped payload on success', async () => {
    const res = await POST(req({ 'x-api-key': 'good', 'x-session-id': 's1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('messages');
    expect(body).toHaveProperty('sopState');
    expect(res.headers.get('x-session-id')).toBe('s1');
  });
});
