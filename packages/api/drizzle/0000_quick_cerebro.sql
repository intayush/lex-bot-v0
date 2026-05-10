CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"firm_name" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"label" text,
	"context_store_url" text NOT NULL,
	"created_at" text NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
CREATE TABLE "archived_data" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"original_table" text NOT NULL,
	"original_id" text NOT NULL,
	"data_json" text NOT NULL,
	"deleted_by_user_at" text NOT NULL,
	"archived_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"version" integer NOT NULL,
	"config_json" text NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"session_id" text NOT NULL,
	"name" text,
	"contact_email" text,
	"contact_phone" text,
	"case_type" text,
	"incident_date" text,
	"brief_description" text,
	"classification" text NOT NULL,
	"classification_rationale" text,
	"urgency_factors_json" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"lead_id" text,
	"read" boolean DEFAULT false NOT NULL,
	"delivery_channel" text DEFAULT 'dashboard' NOT NULL,
	"delivered_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"messages_json" text DEFAULT '[]' NOT NULL,
	"is_preview" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_unique" ON "accounts" USING btree ("email");