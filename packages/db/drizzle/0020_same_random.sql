ALTER TABLE "training_plans" ADD COLUMN "submitted_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_submitted_by_account_id_user_accounts_id_fk" FOREIGN KEY ("submitted_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
UPDATE "training_plans" SET "submitted_by_account_id" = "created_by_account_id" WHERE "submitted_at" IS NOT NULL AND "submitted_by_account_id" IS NULL;
