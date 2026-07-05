CREATE TABLE "account_llm_config" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"api_key_encrypted" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"super_admin_id" text NOT NULL,
	"action" text NOT NULL,
	"target_account_id" text,
	"metadata_json" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "super_admins" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"session_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "onboarding_status" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "account_llm_config" ADD CONSTRAINT "account_llm_config_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_super_admin_id_super_admins_id_fk" FOREIGN KEY ("super_admin_id") REFERENCES "public"."super_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_llm_config_account_unique" ON "account_llm_config" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "super_admins_email_unique" ON "super_admins" USING btree ("email");--> statement-breakpoint
CREATE INDEX "usage_events_account_idx" ON "usage_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "usage_events_created_idx" ON "usage_events" USING btree ("created_at");