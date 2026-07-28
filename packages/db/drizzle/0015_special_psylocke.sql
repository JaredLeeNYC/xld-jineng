ALTER TABLE "skill_assessments" DROP CONSTRAINT "skill_assessments_archived_status";--> statement-breakpoint
ALTER TABLE "skill_assessments" ALTER COLUMN "archived_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "method" varchar(20);--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "assessor_account_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "reason" varchar(500);--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "remediation" varchar(500);--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "evidence_storage_key" varchar(150);--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "evidence_original_filename" varchar(255);--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "evidence_mime_type" varchar(150);--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "evidence_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "evidence_checksum" char(64);--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "manager_confirmed_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "manager_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "returned_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "return_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "archived_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "voided_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "void_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD COLUMN "replaces_assessment_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_assessor_account_id_user_accounts_id_fk" FOREIGN KEY ("assessor_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_manager_confirmed_by_account_id_user_accounts_id_fk" FOREIGN KEY ("manager_confirmed_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_returned_by_account_id_user_accounts_id_fk" FOREIGN KEY ("returned_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_archived_by_account_id_user_accounts_id_fk" FOREIGN KEY ("archived_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_voided_by_account_id_user_accounts_id_fk" FOREIGN KEY ("voided_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_replaces_assessment_id_skill_assessments_id_fk" FOREIGN KEY ("replaces_assessment_id") REFERENCES "public"."skill_assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_status" CHECK ("skill_assessments"."status" in ('draft','pending_manager','pending_hr','archived','returned','voided'));--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_method" CHECK ("skill_assessments"."method" is null or "skill_assessments"."method" in ('written','practical','comprehensive'));
--> statement-breakpoint
ALTER TABLE "skill_assessments" ADD CONSTRAINT "skill_assessments_manual_complete" CHECK (
  source_type <> 'manual_assessment' OR
  (method is not null and assessor_account_id is not null and evidence_storage_key is not null
   and evidence_original_filename is not null and evidence_mime_type is not null
   and evidence_size_bytes > 0 and evidence_checksum is not null)
);
--> statement-breakpoint
CREATE FUNCTION enforce_skill_assessment_workflow() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_type = 'manual_assessment' AND NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'manual assessment must start as draft' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('archived','voided') THEN
    IF NOT (
      OLD.status = 'archived' AND NEW.status = 'voided'
      AND NEW.employee_id = OLD.employee_id AND NEW.skill_id = OLD.skill_id
      AND NEW.level = OLD.level AND NEW.passed = OLD.passed
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
    (OLD.status = 'draft' AND NEW.status = 'pending_manager') OR
    (OLD.status = 'returned' AND NEW.status IN ('draft','pending_manager')) OR
    (OLD.status = 'pending_manager' AND NEW.status IN ('pending_hr','returned')) OR
    (OLD.status = 'pending_hr' AND NEW.status IN ('archived','returned'))
  ) THEN
    RAISE EXCEPTION 'invalid skill assessment transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_type = 'manual_assessment' AND NEW.status = 'pending_hr'
    AND (NEW.manager_confirmed_by_account_id IS NULL OR NEW.manager_confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'manager confirmation is required' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_type = 'manual_assessment' AND NEW.status = 'archived'
    AND (NEW.archived_by_account_id IS NULL OR NEW.archived_at IS NULL) THEN
    RAISE EXCEPTION 'HR archive metadata is required' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'voided'
    AND (NEW.voided_by_account_id IS NULL OR NEW.voided_at IS NULL OR coalesce(trim(NEW.void_reason),'') = '') THEN
    RAISE EXCEPTION 'void metadata is required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER skill_assessments_enforce_workflow
BEFORE INSERT OR UPDATE ON skill_assessments
FOR EACH ROW EXECUTE FUNCTION enforce_skill_assessment_workflow();
--> statement-breakpoint
CREATE FUNCTION protect_formal_skill_assessment_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('archived','voided') THEN
    RAISE EXCEPTION 'formal skill assessment cannot be deleted' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER skill_assessments_protect_formal_delete
BEFORE DELETE ON skill_assessments
FOR EACH ROW EXECUTE FUNCTION protect_formal_skill_assessment_delete();
