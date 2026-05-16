'use client';

import { useState } from 'react';

export default function LoginPage() {
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
      const res = await fetch('/api/auth/login', {
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
    <div className="min-h-screen flex">
      {/* ── Left branded panel (desktop only) ── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] login-gradient-bg flex-col justify-between p-12 text-white relative">
        <div>
          {/* Logo / Brand */}
          <div className="flex items-center gap-3 mb-16">
            <div className="w-9 h-9 rounded-lg bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/10">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18l-1.5 9H4.5L3 6z" />
                <path d="M8 6V3h8v3" />
                <path d="M12 6v9" />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight">Legal Chatbot</span>
          </div>

          {/* Tagline */}
          <h2 className="text-3xl font-bold leading-snug tracking-tight mb-4" style={{ letterSpacing: '-0.025em' }}>
            Client intake,<br />
            on autopilot.
          </h2>
          <p className="text-base text-white/75 max-w-sm leading-relaxed">
            Your AI-powered assistant qualifies leads, collects case details, and routes them to your team — 24/7.
          </p>
        </div>

        {/* Subtle decorative grid pattern */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }} />

        <div className="text-xs text-white/30">
          &copy; {new Date().getFullYear()} Legal Chatbot &middot; All rights reserved
        </div>
      </div>

      {/* ── Right: login form ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12" style={{ backgroundColor: '#FAFAFA' }}>
        <div className="w-full max-w-[400px]">
          {/* Mobile brand header */}
          <div className="lg:hidden mb-10 text-center">
            <div className="inline-flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-accent)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18l-1.5 9H4.5L3 6z" />
                  <path d="M8 6V3h8v3" />
                  <path d="M12 6v9" />
                </svg>
              </div>
              <span className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>Legal Chatbot</span>
            </div>
          </div>

          {/* Form header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight mb-1.5" style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.025em' }}>
              Welcome back
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Sign in to your dashboard to manage leads and configuration.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Error message */}
            {error && (
              <div
                className="flex items-start gap-3 px-4 py-3 rounded-lg text-sm"
                style={{
                  backgroundColor: 'var(--color-badge-urgent-bg)',
                  borderLeft: '3px solid var(--color-danger)',
                  color: 'var(--color-badge-urgent-text)',
                }}
              >
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4.25a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0v-3zm.75 6a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Email field */}
            <div>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@yourfirm.com"
              />
            </div>

            {/* Password field */}
            <div>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Enter your password"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={pending}
              className="btn btn-primary w-full"
              style={{ padding: '0.75rem 1.25rem', fontSize: '0.9375rem', marginTop: '0.5rem' }}
            >
              {pending ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* Footer hint */}
          <p className="mt-8 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Contact your administrator if you need access.
          </p>
        </div>
      </div>
    </div>
  );
}
