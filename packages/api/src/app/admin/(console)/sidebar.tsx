'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  UserPlus,
  LogOut,
} from 'lucide-react';

const navItems = [
  { label: 'Fleet', href: '/admin', icon: LayoutDashboard },
  { label: 'Register Tenant', href: '/admin/tenants/new', icon: UserPlus },
];

/**
 * 028-admin-ui-rework — sidebar with nav, active state, and sign out.
 */
export function AdminSidebar({ email }: { email?: string }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-56 border-r bg-white">
      <div className="p-5 border-b">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-xs font-bold text-primary-foreground">LB</span>
          </div>
          <span className="font-semibold text-sm">Lex Bot Admin</span>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive(item.href)
                  ? 'bg-zinc-100 text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50'
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t space-y-2">
        <p className="text-xs text-zinc-400 truncate">{email}</p>
        <form action="/api/admin/logout" method="POST">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-xs text-zinc-500">
            <LogOut className="size-3.5 mr-2" />
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}