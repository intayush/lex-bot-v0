'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { label: 'Fleet', href: '/admin' },
  { label: 'Register tenant', href: '/admin/tenants/new' },
];

/** 027 US1 — super-admin console sidebar. */
export function AdminSidebar({ email }: { email?: string }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-[240px] border-r" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="p-6">
        <span className="text-lg font-semibold tracking-tight">Lex Bot Admin</span>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block px-3 py-2 rounded-lg text-sm"
            style={{
              backgroundColor: isActive(item.href) ? 'var(--color-bg)' : 'transparent',
              color: isActive(item.href) ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: isActive(item.href) ? 600 : 400,
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>{email}</div>
        <form action="/api/admin/logout" method="POST">
          <button type="submit" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
