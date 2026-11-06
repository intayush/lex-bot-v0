#!/usr/bin/env bash
# =============================================================================
# handoff.sh — Package current work for teammate to resume
# =============================================================================
# Run this at the end of your session. It:
#   1. Detects current branch (creates WIP branch if on main)
#   2. Commits all changes to WIP branch
#   3. Pushes to origin
#   4. Copies the latest pi session transcript to docs/herdr/
#   5. Creates a handoff note (or uses one you provide)
#   6. Pushes docs/herdr/ to origin
#
# Usage:
#   bash scripts/agent/handoff.sh "Brief summary of what was done, what's next, blockers"
# =============================================================================
set -euo pipefail

HANDOFF_MSG="${1:-}"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

# Ensure docs/herdr/ exists
mkdir -p docs/herdr

# ---- 1. Detect branch ----
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "main" ]; then
  WIP_BRANCH="wip/$(date +%Y%m%d-%H%M)"
  echo "→ On main — creating WIP branch: $WIP_BRANCH"
  git checkout -b "$WIP_BRANCH"
else
  WIP_BRANCH="$CURRENT_BRANCH"
  echo "→ On branch: $WIP_BRANCH"
fi

# ---- 2. Commit all local changes ----
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "handoff: $(date -u +%Y-%m-%dT%H:%M:%SZ)
  
${HANDOFF_MSG:-No message provided}"
  echo "✓ Committed changes"
else
  echo "→ No uncommitted changes to commit"
fi

# ---- 3. Push ----
git push -u origin "$WIP_BRANCH" 2>&1 && echo "✓ Pushed branch" || echo "⚠ Push failed — check remote"

# ---- 4. Copy latest pi session transcript ----
LATEST_SESSION=$(ls -t ~/.pi/sessions/ 2>/dev/null | head -1)
if [ -n "$LATEST_SESSION" ]; then
  cp ~/.pi/sessions/"$LATEST_SESSION" docs/herdr/last-session.jsonl
  echo "✓ Copied session transcript (${LATEST_SESSION})"
else
  echo "→ No pi session found"
  touch docs/herdr/last-session.jsonl
fi

# ---- 5. Write handoff note ----
cat > docs/herdr/handoff.md << MDEOF
# Handoff — $(date -u +%Y-%m-%dT%H:%M:%SZ)

**Branch:** \`$WIP_BRANCH\`
**Commits:** $(git log --oneline "$WIP_BRANCH" | head -5 | sed 's/^/  /')

## What was done
_HANDOFF_MSG_GOES_HERE_

## Next steps
_What the next developer should do_

## Blocker / open questions
_Any blocked issues or pending decisions_

## Transcript
\`docs/herdr/last-session.jsonl\` — the last pi session.
An agent can read it for context, but it's a raw transcript.
Write a summary if the session was long.
MDEOF

if [ -n "$HANDOFF_MSG" ]; then
  # Replace placeholder with actual message (using sed to avoid shell escape issues)
  python3 -c "
import sys
with open('docs/herdr/handoff.md', 'r') as f:
  content = f.read()
content = content.replace('_HANDOFF_MSG_GOES_HERE_', sys.argv[1])
with open('docs/herdr/handoff.md', 'w') as f:
  f.write(content)
" "$HANDOFF_MSG"
fi

git add docs/herdr/ && git commit -m "handoff: session artifacts" --no-verify 2>/dev/null || true
git push origin "$WIP_BRANCH" 2>&1 || true

echo ""
echo "=== HANDOFF COMPLETE ==="
echo "Branch: $WIP_BRANCH"
echo "Tell your teammate:"
echo ""
echo "  1. git pull && git checkout $WIP_BRANCH"
echo "  2. bash scripts/agent/restore.sh"
echo "  3. cd $PROJECT_DIR && herdr agent start coder --kind pi --pane <pane-id>"
echo "  4. Prompt: 'Read docs/herdr/handoff.md and docs/herdr/last-session.jsonl, then continue'"
echo ""