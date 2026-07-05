DROP INDEX "attorney_assignment_unique";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "attorney_case_type_assignments" ADD COLUMN "sub_type_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "attorney_assignment_unique" ON "attorney_case_type_assignments" USING btree ("attorney_id","case_type_slug","sub_type_slug");