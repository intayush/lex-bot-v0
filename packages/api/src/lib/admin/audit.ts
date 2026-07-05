/**
 * 027-platform-admin-console — admin action attribution (Constitution VIII).
 *
 * Every mutating `/api/admin/*` handler MUST call `recordAdminAction` so each
 * change is attributable to a super-admin with a timestamp (SC-007). Never put
 * PII in `metadata`.
 */
import { nanoid } from 'nanoid';
import { db, schema } from '../../db/index';

export type AdminAction =
  | 'tenant.create'
  | 'tenant.onboard'
  | 'tenant.publish'
  | 'tenant.suspend'
  | 'tenant.reactivate'
  | 'tenant.rotate_key'
  | 'tenant.delete'
  | 'llm_config.update';

export async function recordAdminAction(
  adminId: string,
  action: AdminAction,
  targetAccountId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.adminAuditLog).values({
    id: nanoid(),
    super_admin_id: adminId,
    action,
    target_account_id: targetAccountId ?? null,
    metadata_json: metadata ? JSON.stringify(metadata) : null,
    created_at: new Date().toISOString(),
  });
}
