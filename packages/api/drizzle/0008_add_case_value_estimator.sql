ALTER TABLE "branch_versions" ADD COLUMN "case_value_config_json" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "is_case_value_enabled" boolean DEFAULT false NOT NULL;