#!/usr/bin/env bash
# =============================================================================
# setup-layout-test.sh — Local test of herdr layout (adapted from vpc-setup/)
# =============================================================================
# Creates a test workspace 'lexbot-test' with the agent layout.
# Run: bash scripts/agent/setup-layout-test.sh
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
echo "Project: $PROJECT_DIR"

# Helper: extract key from herdr JSON (keys with dots = nested)
extract() {
  local json="$1" k1="$2" k2="${3:-}" k3="${4:-}"
  if [ -n "$k3" ]; then
    python3 -c "import json,sys; print(json.loads('$json').get('result',{}).get('$k1',{}).get('$k2',{}).get('$k3',''))"
  elif [ -n "$k2" ]; then
    python3 -c "import json,sys; print(json.loads('$json').get('result',{}).get('$k1',{}).get('$k2',''))"
  else
    python3 -c "import json,sys; print(json.loads('$json').get('result',{}).get('$k1',''))"
  fi
}

echo ""
echo "=== Creating workspace ==="
WS_OUT=$(herdr workspace create --cwd "$PROJECT_DIR" --label lexbot-test --no-focus 2>&1)
echo "$WS_OUT"
ROOT_PANE=$(extract "$WS_OUT" root_pane pane_id)
WS_ID=$(extract "$WS_OUT" workspace workspace_id)
TAB_ID=$(extract "$WS_OUT" tab tab_id)
echo "→ Workspace: $WS_ID  Tab: $TAB_ID  Root pane: $ROOT_PANE"

echo ""
echo "=== Splitting panes ==="

# Split right → p2 (top-right)
SPLIT1=$(herdr pane split "$ROOT_PANE" --direction right --ratio 0.35 --cwd "$PROJECT_DIR" --no-focus 2>&1)
echo "  right: $SPLIT1"
P2=$(extract "$SPLIT1" pane pane_id)

# Split down from p2 → p3 (mid-right)
SPLIT2=$(herdr pane split "$P2" --direction down --ratio 0.33 --cwd "$PROJECT_DIR" --no-focus 2>&1)
echo "  down:  $SPLIT2"
P3=$(extract "$SPLIT2" pane pane_id)

# Split down from p3 → p4 (bottom-right)
SPLIT3=$(herdr pane split "$P3" --direction down --ratio 0.50 --cwd "$PROJECT_DIR" --no-focus 2>&1)
echo "  down:  $SPLIT3"
P4=$(extract "$SPLIT3" pane pane_id)

# Split down from root → p5 (context below planner)
SPLIT4=$(herdr pane split "$ROOT_PANE" --direction down --ratio 0.25 --cwd "$PROJECT_DIR" --no-focus 2>&1)
echo "  down:  $SPLIT4"
P5=$(extract "$SPLIT4" pane pane_id)

echo ""
echo "=== Creating output-logs tab ==="
TAB2_OUT=$(herdr tab create --workspace "$WS_ID" --label "output-logs" --cwd "$PROJECT_DIR" 2>&1)
echo "  tab: $TAB2_OUT"
MONITOR_PANE=$(extract "$TAB2_OUT" root_pane pane_id)

echo ""
echo "=== LAYOUT CREATED ==="
echo ""
echo "Workspace: $WS_ID  (label: lexbot-test)"
echo ""
echo "Pane map:"
echo "  ┌────────────┬────────────┐"
echo "  │ planner    │ dev        │"
echo "  │ ($ROOT_PANE) │ ($P2)       │"
echo "  ├────────────┤ reviewer   │"
echo "  │ context    │ ($P3)       │"
echo "  │ ($P5)       ├────────────┤"
echo "  │            │ deployer   │"
echo "  │            │ ($P4)       │"
echo "  └────────────┴────────────┘"
echo ""
echo "Tab 2 (output-logs): monitor ($MONITOR_PANE)"
echo ""
echo "=== Next: start agents ==="
echo ""
MODEL="velona/deepseek/deepseek-v4-flash"
echo "Run these 4 commands (one at a time):"
echo ""
echo "  herdr agent start planner  --kind pi --pane \"$ROOT_PANE\" -- --model $MODEL"
echo "  herdr agent start dev      --kind pi --pane \"$P2\" -- --model $MODEL"
echo "  herdr agent start reviewer --kind pi --pane \"$P3\" -- --model $MODEL"
echo "  herdr agent start deployer --kind pi --pane \"$P4\" -- --model $MODEL"
echo ""
echo "Verify:"
echo "  herdr agent list"
echo ""