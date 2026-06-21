import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { getAttorneysForCaseType } from './attorneys';
import { sendEmail } from './email';
import { runAfterResponse } from './run-after-response';

export interface RoutingNotificationPayload {
  lead_id: string;
  account_id: string;
  attorney_id: string;
  attorney_name: string;
  attorney_email: string;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  lead_case_type: string;
  lead_description: string | null;
  captured_at: string;
}

/**
 * Enqueue attorney routing notifications for a HOT lead.
 * Inserts one notifications row per matching attorney (delivery_channel='email').
 * Then dispatches email sends via runAfterResponse() so they occur after
 * the HTTP response and do not block the chatbot.
 */
export async function enqueueAttorneyRoutingNotifications(input: {
  accountId: string;
  leadId: string;
  caseTypeSlug: string;
  leadName: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  leadDescription: string | null;
  capturedAt: string;
}): Promise<void> {
  if (!input.caseTypeSlug) return;

  const matchingAttorneys = await getAttorneysForCaseType(input.accountId, input.caseTypeSlug);
  if (matchingAttorneys.length === 0) return;

  const now = new Date().toISOString();
  const notificationIds: string[] = [];

  for (const attorney of matchingAttorneys) {
    const notifId = nanoid();
    const payload: RoutingNotificationPayload = {
      lead_id: input.leadId,
      account_id: input.accountId,
      attorney_id: attorney.id,
      attorney_name: attorney.name,
      attorney_email: attorney.email,
      lead_name: input.leadName,
      lead_email: input.leadEmail,
      lead_phone: input.leadPhone,
      lead_case_type: input.caseTypeSlug,
      lead_description: input.leadDescription,
      captured_at: input.capturedAt,
    };

    await db.insert(schema.notifications).values({
      id: notifId,
      account_id: input.accountId,
      type: 'attorney_lead_routing',
      title: `New HOT lead: ${input.caseTypeSlug}`,
      body: JSON.stringify(payload),
      lead_id: input.leadId,
      attorney_id: attorney.id,
      read: false,
      delivery_channel: 'email',
      delivered_at: null,
      created_at: now,
    });

    notificationIds.push(notifId);
  }

  // Dispatch emails after the HTTP response returns
  runAfterResponse(
    () => dispatchAttorneyRoutingEmails(notificationIds),
    (err) => console.error('[attorney-routing] email dispatch failed', {
      notificationIds,
      err: { name: (err as Error)?.name, message: (err as Error)?.message },
    }),
  );
}

/**
 * Consume pending attorney routing notification rows and send emails.
 * Called from runAfterResponse() — runs after the HTTP response is sent.
 */
export async function dispatchAttorneyRoutingEmails(notificationIds: string[]): Promise<void> {
  for (const id of notificationIds) {
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) continue;

    let payload: RoutingNotificationPayload;
    try {
      payload = JSON.parse(row.body) as RoutingNotificationPayload;
    } catch {
      console.error('[attorney-routing] failed to parse notification body', { id });
      continue;
    }

    const subject = `New HOT lead: ${payload.lead_case_type.toUpperCase()} — ${payload.lead_name ?? 'Anonymous'}`;

    const html = buildEmailHtml(payload);

    try {
      await sendEmail({ to: payload.attorney_email, subject, html });
      await db
        .update(schema.notifications)
        .set({ delivered_at: new Date().toISOString() })
        .where(eq(schema.notifications.id, id));
    } catch (err) {
      console.error('[attorney-routing] email send failed', {
        notificationId: id,
        to: payload.attorney_email,
        err: { name: (err as Error)?.name, message: (err as Error)?.message },
      });
      await db
        .update(schema.notifications)
        .set({ delivered_at: 'FAILED' })
        .where(eq(schema.notifications.id, id));
    }
  }
}

function buildEmailHtml(p: RoutingNotificationPayload): string {
  const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000/dashboard/leads';
  return `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #4338ca; margin-bottom: 4px;">New HOT Lead</h2>
  <p style="color: #6B7280; margin-top: 0;">Hi ${escHtml(p.attorney_name)}, a new qualified lead has been captured that matches your practice area.</p>

  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB; color: #6B7280; width: 140px;">Case type</td><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB; font-weight: 600;">${escHtml(p.lead_case_type.toUpperCase())}</td></tr>
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Name</td><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB;">${escHtml(p.lead_name ?? 'Not provided')}</td></tr>
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Email</td><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB;">${escHtml(p.lead_email ?? 'Not provided')}</td></tr>
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Phone</td><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB;">${escHtml(p.lead_phone ?? 'Not provided')}</td></tr>
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB; color: #6B7280;">Description</td><td style="padding: 8px 0; border-bottom: 1px solid #E5E7EB;">${escHtml(p.lead_description ?? 'Not provided')}</td></tr>
    <tr><td style="padding: 8px 0; color: #6B7280;">Captured</td><td style="padding: 8px 0;">${escHtml(new Date(p.captured_at).toLocaleString())}</td></tr>
  </table>

  <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 20px; background: #4338ca; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 500; margin-top: 8px;">View in Dashboard</a>

  <p style="color: #9CA3AF; font-size: 12px; margin-top: 24px;">This email was sent because you are listed as an attorney for ${escHtml(p.lead_case_type.toUpperCase())} matters. Manage your settings in the firm dashboard.</p>
</body>
</html>`.trim();
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
