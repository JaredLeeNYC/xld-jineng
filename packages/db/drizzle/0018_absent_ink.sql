ALTER TABLE "skill_assessments" DROP CONSTRAINT "skill_assessments_method";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "gender" varchar(10);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "age" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "identity_number" varchar(30);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "tenure_years" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "education" varchar(100);--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "training_type" varchar(20) DEFAULT 'professional' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_method" CHECK ("skill_assessments"."method" is null or "skill_assessments"."method" in ('written','practical','comprehensive','written_practical'));--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_type" CHECK ("training_plans"."training_type" in ('professional','general','other'));