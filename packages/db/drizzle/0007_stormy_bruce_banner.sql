CREATE UNIQUE INDEX "skill_assessments_identity_unique" ON "skill_assessments" USING btree ("id","employee_id","skill_id");--> statement-breakpoint
ALTER TABLE "employee_current_skills" ADD CONSTRAINT "employee_current_skills_assessment_identity_fk" FOREIGN KEY ("assessment_id","employee_id","skill_id") REFERENCES "public"."skill_assessments"("id","employee_id","skill_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION enforce_valid_current_skill_assessment() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM skill_assessments a
    WHERE a.id = NEW.assessment_id
      AND a.employee_id = NEW.employee_id
      AND a.skill_id = NEW.skill_id
      AND a.status = 'archived'
      AND a.passed = true
      AND a.voided_at IS NULL
  ) THEN
    RAISE EXCEPTION 'current skill must reference a passed, archived, non-voided assessment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER employee_current_skills_valid_assessment
BEFORE INSERT OR UPDATE ON employee_current_skills
FOR EACH ROW EXECUTE FUNCTION enforce_valid_current_skill_assessment();
--> statement-breakpoint
CREATE FUNCTION protect_current_skill_assessment() RETURNS trigger AS $$
BEGIN
  IF (NEW.status <> 'archived' OR NEW.passed = false OR NEW.voided_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM employee_current_skills cs WHERE cs.assessment_id = NEW.id) THEN
    RAISE EXCEPTION 'remove current skill pointer before invalidating assessment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER skill_assessments_protect_current
BEFORE UPDATE OF status, passed, voided_at ON skill_assessments
FOR EACH ROW EXECUTE FUNCTION protect_current_skill_assessment();
