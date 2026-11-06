import Link from 'next/link';
import { getFleetSummary } from '../../../lib/admin/fleet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

const statusVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  active: 'default',
  suspended: 'destructive',
  draft: 'secondary',
  live: 'default',
};

const onboardingVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  live: 'default',
  draft: 'secondary',
  completed: 'outline',
};

/**
 * 028-admin-ui-rework — fleet overview with shadcn/ui table.
 */
export default async function FleetOverviewPage() {
  const tenants = await getFleetSummary();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tenants.length} firm{tenants.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        <Link href="/admin/tenants/new">
          <Button>
            <Plus className="size-4 mr-2" />
            Register Tenant
          </Button>
        </Link>
      </div>

      {tenants.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No tenants yet. Register your first firm.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Firm</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Onboarding</TableHead>
                <TableHead className="text-right">Leads (30d)</TableHead>
                <TableHead className="text-right">Est. spend (30d)</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((t) => (
                <TableRow key={t.accountId}>
                  <TableCell>
                    <Link
                      href={`/admin/tenants/${t.accountId}`}
                      className="font-medium hover:underline"
                    >
                      {t.firmName || t.email}
                    </Link>
                    <div className="text-xs text-muted-foreground">{t.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[t.status] ?? 'outline'}>{t.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={onboardingVariant[t.onboardingStatus] ?? 'outline'}
                    >
                      {t.onboardingStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {t.leadCount30d}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    ${t.estimatedSpend30d.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {t.lastActivityAt
                      ? new Date(t.lastActivityAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
