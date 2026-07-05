'use client';

import { useState } from 'react';

/** 027 US1 — super-admin login (mirrors /login, posts to /api/admin/login). */
export default function AdminLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        window.location.href = data.redirect;
      } else {
        setError(data.error || 'Login failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ backgroundColor: '#FAFAFA' }}>
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight mb-1.5" style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.025em' }}>
            Platform Admin
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Operator console — manage all law-firm tenants.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-badge-urgent-bg)', borderLeft: '3px solid var(--color-danger)', color: 'var(--color-badge-urgent-text)' }}>
              {error}
            </div>
          )}
          <div>
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" required autoComplete="email" placeholder="admin@lexbot.dev" />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" placeholder="Enter your password" />
          </div>
          <button type="submit" disabled={pending} className="btn btn-primary w-full" style={{ padding: '0.75rem 1.25rem', fontSize: '0.9375rem', marginTop: '0.5rem' }}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
