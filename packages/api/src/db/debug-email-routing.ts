/**
 * Debug script — check why attorney routing emails may not have fired.
 * Run: DATABASE_URL=... pnpm --filter @legal-chatbot/api exec tsx src/db/debug-email-routing.ts
 */
import { desc, eq } from 'drizzle-orm';
import { db, schema } from './index.js';

async function main() {
  // 1. Latest HOT lead
  const hotLeads = await db
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      case_type: schema.leads.case_type,
      classification: schema.leads.classification,
      lead_score: schema.leads.lead_score,
      contact_email: schema.leads.contact_email,
      created_at: schema.leads.created_at,
    })
    .from(schema.leads)
    .where(eq(schema.leads.classification, 'HOT'))
    .orderBy(desc(schema.leads.created_at))
    .limit(3);

  console.log('Latest HOT leads:');
  for (const l of hotLeads) {
    console.log(`  id=${l.id} name="${l.name}" case_type="${l.case_type}" score=${l.lead_score} created=${l.created_at}`);
  }

  if (!hotLeads[0]) {
    console.log('No HOT leads found.');
    return;
  }

  const latestHot = hotLeads[0];
  console.log(`\nChecking routing for lead: ${latestHot.id}`);

  // 2. Check notifications for this lead
  const notifications = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.lead_id, latestHot.id));

  console.log(`\nNotifications for lead ${latestHot.id}: ${notifications.length}`);
  for (const n of notifications) {
    console.log(`  type=${n.type} channel=${n.delivery_channel} attorney_id=${n.attorney_id ?? 'null'} delivered_at=${n.delivered_at ?? 'null'}`);
  }

  const routingNotifs = notifications.filter((n) => n.type === 'attorney_lead_routing');
  if (routingNotifs.length === 0) {
    console.log('\n⚠️  No attorney_lead_routing notifications found for this lead.');
    console.log('Possible reasons:');

    // Check if any attorneys exist
    const attorneys = await db.select({ id: schema.attorneys.id, name: schema.attorneys.name, email: schema.attorneys.email }).from(schema.attorneys);
    console.log(`  - Attorneys in DB: ${attorneys.length}`);
    if (attorneys.length === 0) {
      console.log('    → No attorneys configured. Add attorneys in Configuration → Attorneys tab.');
    } else {
      console.log('    Attorneys:', attorneys.map((a) => `${a.name} <${a.email}>`).join(', '));
    }

    // Check if attorneys are assigned to this case type
    if (latestHot.case_type) {
      const caseTypeSlug = latestHot.case_type.toLowerCase().replace(/[\s-]+/g, '_');
      const assignments = await db
        .select()
        .from(schema.attorneyCaseTypeAssignments)
        .where(eq(schema.attorneyCaseTypeAssignments.case_type_slug, caseTypeSlug));
      console.log(`  - Assignments for case_type_slug "${caseTypeSlug}": ${assignments.length}`);
      if (assignments.length === 0) {
        console.log(`    → No attorney is assigned to case type "${caseTypeSlug}".`);
        console.log('      Go to Configuration → Attorneys and assign attorneys to this case type.');
      }
    }

    // Check RESEND_API_KEY
    const hasKey = !!process.env.RESEND_API_KEY;
    console.log(`  - RESEND_API_KEY set: ${hasKey}`);
    if (!hasKey) {
      console.log('    → RESEND_API_KEY is not set. Email sends are silently skipped.');
      console.log('      Add it to Netlify environment variables.');
    }
  } else {
    for (const n of routingNotifs) {
      const deliveredAt = n.delivered_at;
      if (!deliveredAt) {
        console.log(`\n⚠️  Routing notification ${n.id} has delivered_at=null — email was enqueued but not sent.`);
        console.log('  This means runAfterResponse() fired but sendEmail() was never called or the function died before it could complete.');
        console.log('  On Netlify, this can happen if after() is not supported or times out.');
      } else if (deliveredAt === 'FAILED') {
        console.log(`\n❌ Routing notification ${n.id} has delivered_at=FAILED — Resend returned an error.`);
        try {
          const body = JSON.parse(n.body);
          console.log('  Attorney email:', body.attorney_email);
        } catch { /* ignore */ }
        console.log('  Check: (1) RESEND_API_KEY is valid, (2) EMAIL_FROM is a verified sender domain.');
      } else {
        console.log(`\n✅ Routing notification ${n.id} delivered at ${deliveredAt}`);
        try {
          const body = JSON.parse(n.body);
          console.log('  Sent to:', body.attorney_email);
        } catch { /* ignore */ }
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
