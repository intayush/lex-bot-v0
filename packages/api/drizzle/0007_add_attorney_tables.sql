CREATE TABLE "attorney_case_type_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"attorney_id" text NOT NULL,
	"account_id" text NOT NULL,
	"case_type_slug" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attorneys" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"mobile" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "attorney_id" text;--> statement-breakpoint
ALTER TABLE "attorney_case_type_assignments" ADD CONSTRAINT "attorney_case_type_assignments_attorney_id_attorneys_id_fk" FOREIGN KEY ("attorney_id") REFERENCES "public"."attorneys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attorney_case_type_assignments" ADD CONSTRAINT "attorney_case_type_assignments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attorneys" ADD CONSTRAINT "attorneys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attorney_assignment_unique" ON "attorney_case_type_assignments" USING btree ("attorney_id","case_type_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "attorneys_account_email_unique" ON "attorneys" USING btree ("account_id","email");