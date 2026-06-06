-- Spec 015 (Lead Classification Revamp) migration.
--
-- Phase A: schema additions (7 nullable columns, no defaults).
-- Phase B: legacy classification value migration (3 UPDATEs that
-- rewrite pre-015 lead rows into the new 4-value vocabulary).
--
-- Per spec 015 data-model.md §Migration order. All 10 statements
-- are idempotent: running twice on a fresh Neon branch is a no-op
-- the second time. Recovery from partial failure: drop the new
-- columns manually OR run pnpm db:reset && db:seed && db:migrate
-- (the neon-http driver does not support transactions, per the
-- existing pattern documented in case-types/route.ts).

-- Phase A — schema additions
ALTER TABLE "leads" ADD COLUMN "lead_score" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_reasons_json" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "request_type" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "geographic_qualification" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "geographic_qualification_details_json" text;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD COLUMN "applies_when_sub_type_slug" text;--> statement-breakpoint
ALTER TABLE "sub_types" ADD COLUMN "scoring_config_json" text;--> statement-breakpoint

-- Phase B — legacy classification value migration (FR-031).
-- Maps urgent → HOT, normal → WARM, unqualified → SPAM.
-- No legacy row maps to COLD (net-new bucket; no analog).
-- Idempotent: zero rows match on second run.
UPDATE "leads" SET "classification" = 'HOT'  WHERE "classification" = 'urgent';--> statement-breakpoint
UPDATE "leads" SET "classification" = 'WARM' WHERE "classification" = 'normal';--> statement-breakpoint
UPDATE "leads" SET "classification" = 'SPAM' WHERE "classification" = 'unqualified';
