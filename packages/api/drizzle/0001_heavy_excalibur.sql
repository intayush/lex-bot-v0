CREATE TABLE "case_types" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"is_in_scope" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goodbye_phrases" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"phrase" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"version" integer NOT NULL,
	"qualified_lead_threshold" integer DEFAULT 5 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"derived_from_legacy" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"sop_configuration_id" text NOT NULL,
	"position" integer NOT NULL,
	"slug" text NOT NULL,
	"question_text" text NOT NULL,
	"chip_source" text,
	"inline_chips_json" text,
	"accepts_free_text" boolean DEFAULT true NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"counts_toward_threshold" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"skip_condition_json" text
);
--> statement-breakpoint
CREATE TABLE "sub_types" (
	"id" text PRIMARY KEY NOT NULL,
	"case_type_id" text NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sop_state_snapshot" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "sop_state_json" text;--> statement-breakpoint
ALTER TABLE "case_types" ADD CONSTRAINT "case_types_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goodbye_phrases" ADD CONSTRAINT "goodbye_phrases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_configurations" ADD CONSTRAINT "sop_configurations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_sop_configuration_id_sop_configurations_id_fk" FOREIGN KEY ("sop_configuration_id") REFERENCES "public"."sop_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_types" ADD CONSTRAINT "sub_types_case_type_id_case_types_id_fk" FOREIGN KEY ("case_type_id") REFERENCES "public"."case_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_types_account_slug_unique" ON "case_types" USING btree ("account_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "goodbye_phrases_account_phrase_unique" ON "goodbye_phrases" USING btree ("account_id","phrase");--> statement-breakpoint
CREATE UNIQUE INDEX "sop_configurations_account_version_unique" ON "sop_configurations" USING btree ("account_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "sop_steps_config_slug_unique" ON "sop_steps" USING btree ("sop_configuration_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_types_case_type_slug_unique" ON "sub_types" USING btree ("case_type_id","slug");