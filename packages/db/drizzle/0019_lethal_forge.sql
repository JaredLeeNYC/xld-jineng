CREATE TABLE "training_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"method" varchar(20) NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"passed" boolean NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"remarks" varchar(500),
	"created_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_exams_method" CHECK ("training_exams"."method" in ('written','practical','written_practical')),
	CONSTRAINT "training_exams_score" CHECK ("training_exams"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "training_plans" DROP CONSTRAINT "training_plans_status";--> statement-breakpoint
ALTER TABLE "training_plans" DROP CONSTRAINT "training_plans_type";--> statement-breakpoint
ALTER TABLE "training_tasks" DROP CONSTRAINT "training_tasks_status";--> statement-breakpoint
ALTER TABLE "position_skill_requirements" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "training_exam_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "score" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "training_type" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "training_name" text;--> statement-breakpoint
ALTER TABLE "training_materials" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "material_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "owner_employee_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "scope_department_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "scope_position_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "approval_comment" varchar(500);--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "approved_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_tasks" ADD COLUMN "actual_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_tasks" ADD COLUMN "actual_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "factory_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "training_exams" ADD CONSTRAINT "training_exams_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exams" ADD CONSTRAINT "training_exams_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exams" ADD CONSTRAINT "training_exams_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exams" ADD CONSTRAINT "training_exams_created_by_account_id_user_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_exams" ADD CONSTRAINT "training_exams_plan_employee_fk" FOREIGN KEY ("plan_id","employee_id") REFERENCES "public"."training_tasks"("plan_id","employee_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_exams_identity_unique" ON "training_exams" USING btree ("id","employee_id","skill_id");--> statement-breakpoint
CREATE INDEX "training_exams_employee_skill_completed_idx" ON "training_exams" USING btree ("employee_id","skill_id","completed_at");--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_exam_identity_fk" FOREIGN KEY ("training_exam_id","employee_id","skill_id") REFERENCES "public"."training_exams"("id","employee_id","skill_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_approved_by_account_id_user_accounts_id_fk" FOREIGN KEY ("approved_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_score" CHECK ("skill_assessments"."score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "training_materials" ADD CONSTRAINT "training_materials_training_type" CHECK ("training_materials"."training_type" in ('professional','general','safety','other'));--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_status" CHECK ("training_plans"."status" in ('draft','pending_approval','published','in_progress','completed','cancelled'));--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_type" CHECK ("training_plans"."training_type" in ('professional','general','safety','other'));--> statement-breakpoint
ALTER TABLE "training_tasks" ADD CONSTRAINT "training_tasks_status" CHECK ("training_tasks"."status" in ('assigned','in_progress','submitted','returned','confirmed','cancelled'));
--> statement-breakpoint
UPDATE training_plans SET material_ids=ARRAY[material_id], owner_employee_ids=ARRAY[owner_employee_id], scope_department_ids=CASE WHEN scope_department_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[scope_department_id] END, scope_position_ids=CASE WHEN scope_position_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[scope_position_id] END;
--> statement-breakpoint
UPDATE training_materials SET training_type=CASE WHEN category LIKE '%安全%' THEN 'safety' WHEN category LIKE '%内部%' THEN 'general' WHEN category LIKE '%技能%' THEN 'professional' ELSE 'other' END;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_skill_assessment_workflow() RETURNS trigger AS $$
DECLARE
  assessor_role text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_type = 'manual_assessment' AND NEW.status NOT IN ('draft','pending_hr') THEN
      RAISE EXCEPTION 'manual assessment must start awaiting HR archive' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('archived','voided') THEN
    IF NOT (
      OLD.status = 'archived' AND NEW.status = 'voided'
      AND NEW.employee_id = OLD.employee_id AND NEW.skill_id = OLD.skill_id
      AND NEW.level = OLD.level AND NEW.passed = OLD.passed
      AND NEW.training_exam_id IS NOT DISTINCT FROM OLD.training_exam_id
      AND NEW.score IS NOT DISTINCT FROM OLD.score
      AND NEW.method IS NOT DISTINCT FROM OLD.method
      AND NEW.assessor_account_id IS NOT DISTINCT FROM OLD.assessor_account_id
      AND NEW.reason IS NOT DISTINCT FROM OLD.reason
      AND NEW.remediation IS NOT DISTINCT FROM OLD.remediation
      AND NEW.source_type = OLD.source_type
      AND NEW.source_reference = OLD.source_reference
      AND NEW.assessed_at = OLD.assessed_at
      AND NEW.valid_until IS NOT DISTINCT FROM OLD.valid_until
      AND NEW.evidence_storage_key IS NOT DISTINCT FROM OLD.evidence_storage_key
      AND NEW.evidence_original_filename IS NOT DISTINCT FROM OLD.evidence_original_filename
      AND NEW.evidence_mime_type IS NOT DISTINCT FROM OLD.evidence_mime_type
      AND NEW.evidence_size_bytes IS NOT DISTINCT FROM OLD.evidence_size_bytes
      AND NEW.evidence_checksum IS NOT DISTINCT FROM OLD.evidence_checksum
      AND NEW.manager_confirmed_by_account_id IS NOT DISTINCT FROM OLD.manager_confirmed_by_account_id
      AND NEW.manager_confirmed_at IS NOT DISTINCT FROM OLD.manager_confirmed_at
      AND NEW.returned_by_account_id IS NOT DISTINCT FROM OLD.returned_by_account_id
      AND NEW.return_reason IS NOT DISTINCT FROM OLD.return_reason
      AND NEW.archived_by_account_id IS NOT DISTINCT FROM OLD.archived_by_account_id
      AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
      AND NEW.replaces_assessment_id IS NOT DISTINCT FROM OLD.replaces_assessment_id
    ) THEN
      RAISE EXCEPTION 'archived or voided assessment is immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('pending_manager','pending_hr')) OR
    (OLD.status = 'returned' AND NEW.status IN ('draft','pending_manager','pending_hr')) OR
    (OLD.status = 'pending_manager' AND NEW.status IN ('pending_hr','returned')) OR
    (OLD.status = 'pending_hr' AND NEW.status IN ('archived','returned'))
  ) THEN
    RAISE EXCEPTION 'invalid skill assessment transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_type = 'manual_assessment' AND NEW.status = 'archived' THEN
    IF NEW.archived_by_account_id IS NULL OR NEW.archived_at IS NULL THEN
      RAISE EXCEPTION 'HR archive metadata is required' USING ERRCODE = '23514';
    END IF;
    IF NEW.archived_by_account_id = NEW.assessor_account_id
      AND (NEW.manager_confirmed_by_account_id IS NULL
        OR NEW.manager_confirmed_by_account_id = NEW.assessor_account_id) THEN
      RAISE EXCEPTION 'an independent reviewer is required' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'voided'
    AND (NEW.voided_by_account_id IS NULL OR NEW.voided_at IS NULL OR coalesce(trim(NEW.void_reason),'') = '') THEN
    RAISE EXCEPTION 'void metadata is required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
ALTER TABLE skill_assessments DROP CONSTRAINT skill_assessments_manual_complete;
--> statement-breakpoint
ALTER TABLE skill_assessments ADD CONSTRAINT skill_assessments_manual_complete CHECK (
 source_type <> 'manual_assessment' OR (
 method IS NOT NULL AND assessor_account_id IS NOT NULL AND (
 (evidence_storage_key IS NULL AND evidence_original_filename IS NULL AND evidence_mime_type IS NULL AND evidence_size_bytes IS NULL AND evidence_checksum IS NULL)
 OR (evidence_storage_key IS NOT NULL AND evidence_original_filename IS NOT NULL AND evidence_mime_type IS NOT NULL AND evidence_size_bytes > 0 AND evidence_checksum IS NOT NULL)
 )));
