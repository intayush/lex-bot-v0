const windowMs = 60_000;
const maxRequests = 20;

const store = new Map<string, { count: number; resetAt: number }>();

/**
 * Allow callers to opt out of rate limiting via an environment
 * variable. Only honoured when the env file says so explicitly —
 * lets dev fixtures + test harnesses run without tripping the
 * 20-req/min/account ceiling. Production deploys must NEVER set this
 * (the default is to enforce).
 */
function rateLimitDisabled(): boolean {
  const v = (process.env.RATE_LIMIT_DISABLED ?? '').toLowerCase();
  return v === '1' || v === 'true';
}

export function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetIn: number } {
  if (rateLimitDisabled()) {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetIn: 0 };
  }
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetIn: entry.resetAt - now };
}
