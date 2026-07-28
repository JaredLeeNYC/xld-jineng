CREATE TYPE "public"."skill_category" AS ENUM('general', 'professional', 'core');--> statement-breakpoint
CREATE TABLE "employee_current_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_skill_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"required_level" smallint NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_skill_requirements_level" CHECK ("position_skill_requirements"."required_level" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "skill_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"status" varchar(20) NOT NULL,
	"passed" boolean NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"source_reference" varchar(300) NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"archived_at" timestamp with time zone NOT NULL,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_assessments_level" CHECK ("skill_assessments"."level" between 0 and 4),
	CONSTRAINT "skill_assessments_archived_status" CHECK ("skill_assessments"."status" in ('archived', 'voided'))
);
--> statement-breakpoint
CREATE TABLE "skill_import_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"rows" jsonb NOT NULL,
	"errors" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" "skill_category" NOT NULL,
	"reassessment_required" boolean DEFAULT false NOT NULL,
	"validity_months" smallint,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_code_canonical" CHECK ("skills"."code" = upper(trim("skills"."code"))),
	CONSTRAINT "skills_validity_policy" CHECK (("skills"."reassessment_required" = false and "skills"."validity_months" is null) or ("skills"."reassessment_required" = true and "skills"."validity_months" between 1 and 120))
);
--> statement-breakpoint
ALTER TABLE "employee_current_skills" ADD CONSTRAINT "employee_current_skills_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_current_skills" ADD CONSTRAINT "employee_current_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_current_skills" ADD CONSTRAINT "employee_current_skills_assessment_id_skill_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."skill_assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_skill_requirements" ADD CONSTRAINT "position_skill_requirements_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_skill_requirements" ADD CONSTRAINT "position_skill_requirements_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_import_previews" ADD CONSTRAINT "skill_import_previews_actor_account_id_user_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_current_skills_employee_skill_unique" ON "employee_current_skills" USING btree ("employee_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_current_skills_assessment_unique" ON "employee_current_skills" USING btree ("assessment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "position_skill_requirements_current_unique" ON "position_skill_requirements" USING btree ("position_id","skill_id");--> statement-breakpoint
CREATE INDEX "skill_assessments_employee_skill_idx" ON "skill_assessments" USING btree ("employee_id","skill_id","assessed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_code_unique" ON "skills" USING btree ("code");