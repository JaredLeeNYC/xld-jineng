CREATE OR REPLACE FUNCTION enforce_skill_assessment_workflow() RETURNS trigger AS $$
DECLARE
  assessor_role text;
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
    (OLD.status = 'draft' AND NEW.status IN ('pending_manager','pending_hr')) OR
    (OLD.status = 'returned' AND NEW.status IN ('draft','pending_manager','pending_hr')) OR
    (OLD.status = 'pending_manager' AND NEW.status IN ('pending_hr','returned')) OR
    (OLD.status = 'pending_hr' AND NEW.status IN ('archived','returned'))
  ) THEN
    RAISE EXCEPTION 'invalid skill assessment transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_type = 'manual_assessment' AND NEW.status = 'pending_hr'
    AND (NEW.manager_confirmed_by_account_id IS NULL OR NEW.manager_confirmed_at IS NULL) THEN
    SELECT role::text INTO assessor_role FROM user_accounts WHERE id = NEW.assessor_account_id;
    IF assessor_role IS DISTINCT FROM 'department_manager' THEN
      RAISE EXCEPTION 'manager confirmation is required' USING ERRCODE = '23514';
    END IF;
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
WITH migrated AS (
  UPDATE skill_assessments a
  SET status='pending_hr',updated_at=now()
  FROM user_accounts assessor
  WHERE assessor.id=a.assessor_account_id
    AND assessor.role='department_manager'
    AND a.status='pending_manager'
  RETURNING a.id
)
INSERT INTO audit_logs (action,object_type,object_id,summary)
SELECT 'skill_assessment.workflow_migrated','skill_assessment',id,
  jsonb_build_object('from','pending_manager','to','pending_hr','reason','manager_assessor')
FROM migrated;
