CREATE TABLE "branch_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"questions_json" text NOT NULL,
	"classification_thresholds_json" text NOT NULL,
	"hard_override_toggles_json" text NOT NULL,
	"published_at" text,
	"created_at" text NOT NULL,
	"created_by_user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"case_type_slug" text NOT NULL,
	"sub_type_slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"current_version_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "branch_snapshot_json" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "branch_incomplete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_versions" ADD CONSTRAINT "branch_versions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_versions_branch_version_unique" ON "branch_versions" USING btree ("branch_id","version_number");--> statement-breakpoint
CREATE INDEX "branch_versions_branch_idx" ON "branch_versions" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_account_pair_unique" ON "branches" USING btree ("account_id","case_type_slug","sub_type_slug");--> statement-breakpoint
CREATE INDEX "branches_account_idx" ON "branches" USING btree ("account_id");