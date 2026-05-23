# Contract: Deploy Invariants

**Owner**: Deployment & Release (`009-deployment-release`)
**Source of Truth**: §8.4 (no Server Actions), §9.7 (no native
binaries; CORS wildcard), Constitution Principle IV.

## What This Contract Enforces

Three deploy-time invariants enforced as a CI step in the PR
pipeline (R11). A regression on any of these is BLOCKED at PR
time, never reaching production.

## Invariant 1: No Next.js Server Actions

Server Actions are forbidden per §8.4 implementation note:

> "Server actions are not used — all mutations go through API
>  route handlers (`POST /api/*`) to avoid action ID mismatch
>  issues across Netlify deploys."

### Check

```bash
# scripts/verify-deploy-invariants.sh
if grep -r --include="*.ts" --include="*.tsx" "'use server'" packages/api/src 2>/dev/null; then
  echo "ERROR: 'use server' directive found in packages/api/src"
  exit 1
fi
```

Also check the dashboard package (currently empty placeholder
per Phase 6 R1; included for future-proofing):

```bash
if grep -r --include="*.ts" --include="*.tsx" "'use server'" packages/dashboard/src 2>/dev/null; then
  echo "ERROR: 'use server' directive found in packages/dashboard/src"
  exit 1
fi
```

## Invariant 2: No Native-Binary Production Dependencies

Native-binary deps are forbidden per §9.7:

> "`bcrypt` (native C++ addon) was replaced with `bcryptjs`
>  (pure JS) to eliminate native binary compilation on
>  Netlify's build environment."

The deferred Constitution principle generalizes this to ALL
production runtime deps.

### Check

```bash
# Production dependencies on the API package
NATIVE_FORBIDDEN_LIST=("bcrypt" "node-sass" "sharp")  # extensible

for pkg in "${NATIVE_FORBIDDEN_LIST[@]}"; do
  if jq -e ".dependencies[\"$pkg\"]" packages/api/package.json >/dev/null; then
    echo "ERROR: Native binary '$pkg' in packages/api production dependencies"
    exit 1
  fi
done
```

`better-sqlite3` is allowed in `devDependencies` only (it's
the test driver per Foundation contract). Check that:

```bash
if jq -e ".dependencies[\"better-sqlite3\"]" packages/api/package.json >/dev/null; then
  echo "ERROR: better-sqlite3 found in production dependencies; must be devDependencies only"
  exit 1
fi
```

## Invariant 3: CORS Wildcard

CORS for the chat endpoint is mandated by §9.7:

> "CORS is set to `Access-Control-Allow-Origin: *` since the
>  widget is designed to be embedded on any client's website."

### Check

```bash
if ! grep -q "'Access-Control-Allow-Origin': '\\*'" packages/api/src/app/api/chat/cors.ts; then
  echo "ERROR: CORS wildcard not set in /api/chat/cors.ts"
  exit 1
fi
```

A more robust check could parse the TS source via tooling, but
a simple grep on the known file is sufficient for MVP.

## Invariant 4 (extension): Privacy-Sensitive Fields Not Logged

Future invariant (out of scope for MVP — tracked here for
post-MVP extension): grep for top-level `console.log`,
`console.error`, etc. in production source files; require all
logging to go through `@legal-chatbot/shared`'s Foundation
logger (which redacts).

For MVP, ESLint flat config disallows `console.log` in
`packages/api/**` (Phase 1 Foundation R5). The deploy
invariant is a backstop.

## Where the Check Runs

In `.github/workflows/ci.yml` `pr-checks` job (R1), after
install but before typecheck:

```yaml
- name: Verify deploy invariants
  run: bash scripts/verify-deploy-invariants.sh
```

## Failure Behavior

Any invariant violation:

- `bash` script exits non-zero.
- CI step fails.
- Branch protection blocks merge.

The script's error output names the offending file + invariant
so engineers can locate and fix immediately.

## Tests

A negative test (in CI, gated to a separate non-blocking
workflow): adds a deliberate violation to a test branch and
verifies the script catches it. This ensures the script
doesn't false-pass.

## Constitution Compliance

- Constitution IV: this contract IS the enforcement mechanism
  for Constitution IV's binding rules at deploy time.

