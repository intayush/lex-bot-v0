import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

const FROM = process.env.EMAIL_FROM ?? 'noreply@legalchatbot.com';

/**
 * Send a transactional email via Resend.
 * If RESEND_API_KEY is not set, logs a warning and returns without throwing.
 * Resend errors are logged and rethrown so the caller can record failure state.
 */
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping email send', { to, subject });
    return;
  }

  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) {
    console.error('[email] Resend error', { to, subject, error });
    throw new Error(`Resend send failed: ${error.message}`);
  }
}
