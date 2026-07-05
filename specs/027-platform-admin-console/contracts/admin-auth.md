# Contract: Admin Authentication

All `/api/admin/*` handlers (except login) require a valid super-admin session
(cookie `legal_chatbot_admin`). Missing/invalid → **401**. A valid *firm*
session (`legal_chatbot_session`) is NOT accepted → **401** (§VIII, SC-002).

## POST /api/admin/login
Request (JSON): `{ email: string, password: string }`
- 200: `{ success: true, redirect: "/admin" }` — sets admin session cookie.
- 401: `{ error: "Invalid credentials" }`
- 400: Zod validation error on body.

Behavior: look up `super_admins` by email, `bcrypt.compare(password, hash)`, set
`session.adminId` + `session.email`, `session.save()`. No lockout in MVP
(rate-limited by the existing per-IP limits if present).

## POST /api/admin/logout
- 200: `{ success: true }` — destroys admin session.

## Guard contract (`requireSuperAdmin`)
Every mutating handler:
1. Resolve admin session; if no `adminId` → 401.
2. On success, expose `adminId` for `recordAdminAction(...)`.
