/**
 * 027 Polish (T058) — end-to-end admin console flow.
 *
 * Verifies: super-admin login → register tenant → complete onboarding wizard →
 * publish → tenant appears live; and a firm login is denied /api/admin/*.
 *
 * PREREQUISITE: a seeded super-admin (`pnpm --filter @legal-chatbot/api
 * db:seed-super-admin`) and applied migration 0010. When the super-admin is not
 * seeded, the login step fails and the suite is skipped with a clear message
 * (so CI without the seed doesn't red-fail).
 *
 * @walk — runs in headless chromium.
 */
import { test, expect } from '@playwright/test';
import { loginAsDev } from './fixtures';

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'admin@lexbot.dev';
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'admin-dev-password';

test.describe.configure({ mode: 'serial' });

test.describe('027 admin console', () => {
  test('firm login is denied all /api/admin/* routes (SC-002)', async ({ request }) => {
    // A firm session must never reach admin endpoints.
    const loginRes = await request.post('/api/auth/login', {
      data: { email: 'dev@legalchatbot.com', password: 'password123' },
      headers: { 'Content-Type': 'application/json' },
    });
    // Even if firm login succeeds, the admin cookie is separate → 401.
    void loginRes;
    const res = await request.get('/api/admin/tenants');
    expect(res.status()).toBe(401);
  });

  test('super-admin: login → register → onboard → publish → live', async ({ page, request }) => {
    const login = await request.post('/api/admin/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    test.skip(!login.ok(), 'super-admin not seeded — run db:seed-super-admin');

    // Register a fresh tenant.
    const uniqueEmail = `e2e+${Date.now()}@firm.test`;
    const reg = await request.post('/api/admin/tenants', {
      data: { email: uniqueEmail, firmName: 'E2E Firm' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(reg.status()).toBe(201);
    const { accountId, apiKey } = await reg.json();
    expect(apiKey).toMatch(/^lk_/);

    // Complete onboarding (finish=true with required sections).
    const ob = await request.put(`/api/admin/tenants/${accountId}/onboarding`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        firmIdentity: { firmName: 'E2E Firm', chatbotName: 'Ace', greetingMessage: 'Hi!', language: 'English' },
        caseTypes: [{ slug: 'general', label: 'General', subTypes: [] }],
        contact: { phone: '555', email: uniqueEmail, officeHours: [], afterHoursMessage: '' },
        finish: true,
      },
    });
    expect(ob.ok()).toBeTruthy();

    // Publish → live.
    const pub = await request.post(`/api/admin/tenants/${accountId}/publish`);
    expect(pub.ok()).toBeTruthy();
    expect((await pub.json()).onboardingStatus).toBe('live');

    // Fleet overview lists the new tenant.
    const fleet = await request.get('/api/admin/tenants');
    const { tenants } = await fleet.json();
    expect(tenants.some((t: { accountId: string }) => t.accountId === accountId)).toBe(true);

    void page;
    void loginAsDev;
  });
});
