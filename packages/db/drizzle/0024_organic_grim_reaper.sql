ALTER TABLE "employees" ADD COLUMN "photo_bytes" "bytea";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "photo_mime" varchar(30);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "photo_revision" uuid;