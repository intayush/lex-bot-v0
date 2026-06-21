ALTER TABLE "configurations" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "sop_configurations" ADD COLUMN "label" text;--> statement-breakpoint
CREATE UNIQUE INDEX "configurations_account_version_unique" ON "configurations" USING btree ("account_id","version");