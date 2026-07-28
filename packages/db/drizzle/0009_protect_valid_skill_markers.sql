DROP TRIGGER IF EXISTS employee_current_skills_valid_assessment ON employee_current_skills;--> statement-breakpoint
DROP TRIGGER IF EXISTS skill_assessments_protect_current ON skill_assessments;--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_valid_current_skill_assessment();--> statement-breakpoint
DROP FUNCTION IF EXISTS protect_current_skill_assessment();--> statement-breakpoint
CREATE FUNCTION enforce_valid_skill_assessment_marker() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM skill_assessments a
  WHERE a.id = NEW.assessment_id
    AND a.employee_id = NEW.employee_id
    AND a.skill_id = NEW.skill_id
    AND a.status = 'archived'
    AND a.passed = true
    AND a.voided_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'valid skill marker requires a passed, archived, non-voided assessment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER valid_skill_assessments_enforce_source
BEFORE INSERT OR UPDATE ON valid_skill_assessments
FOR EACH ROW EXECUTE FUNCTION enforce_valid_skill_assessment_marker();
