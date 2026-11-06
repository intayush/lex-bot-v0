#!/usr/bin/env bash
# =============================================================================
# restore.sh — Resume work from a handoff (run after git checkout)
# =============================================================================
# Run this after pulling a handoff branch. It:
#   1. Copies the session transcript to ~/.pi/sessions/ for reference
#   2. Prints the handoff note
#   3. Installs deps if package.json changed
#
# Usage:
#   git pull && git checkout <handoff-branch>
#   bash scripts/agent/restore.sh
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

# ---- 1. Show handoff ----
if [ -f docs/herdr/handoff.md ]; then
  echo "=== HANDOFF NOTE ==="
  cat docs/herdr/handoff.md
  echo ""
  echo "===================="
else
  echo "→ No handoff note found at docs/herdr/handoff.md"
fi

# ---- 2. Copy session transcript ----
if [ -f docs/herdr/last-session.jsonl ]; then
  mkdir -p ~/.pi/sessions
  cp docs/herdr/last-session.jsonl ~/.pi/sessions/handoff-transcript.jsonl
  echo "→ Session transcript restored to ~/.pi/sessions/handoff-transcript.jsonl"
else
  echo "→ No session transcript found at docs/herdr/last-session.jsonl"
fi

# ---- 3. Check if deps changed ----
echo ""
echo "=== Checking dependencies ==="
if [ -f node_modules/.package-lock.json ]; then
  LOCK_HASH=$(md5 -q pnpm-lock.yaml 2>/dev/null || md5sum pnpm-lock.yaml 2>/dev/null | cut -d' ' -f1)
  OLD_HASH=$(cat node_modules/.package-lock-hash 2>/dev/null || echo "")
  if [ "$LOCK_HASH" != "$OLD_HASH" ]; then
    echo "→ pnpm-lock.yaml changed — installing..."
    pnpm install --frozen-lockfile || pnpm install
    echo "$LOCK_HASH" > node_modules/.package-lock-hash
    echo "✓ Dependencies installed"
  else
    echo "→ Dependencies up to date"
  fi
fi

# ---- 4. Check for migration changes ----
echo ""
echo "=== Database migrations ==="
MIGRATIONS_DIR=$(find . -path "*/drizzle/*" -name "migration_*" 2>/dev/null | head -5 || true)
if [ -n "$MIGRATIONS_DIR" ]; then
  echo "→ Migrations found — run manually if new: pnpm --filter @legal-chatbot/api db:migrate"
fi

echo ""
echo "=== RESTORE COMPLETE ==="
echo ""
echo "Launch your pi agent and prompt:"
echo ""
echo "  'Read docs/herdr/handoff.md and ~/.pi/sessions/handoff-transcript.jsonl for context, then continue working.'"
echo ""