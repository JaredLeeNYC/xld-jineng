CREATE TABLE "valid_skill_assessments" (
	"assessment_id" uuid PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "valid_skill_assessments" ADD CONSTRAINT "valid_skill_assessments_identity_fk" FOREIGN KEY ("assessment_id","employee_id","skill_id") REFERENCES "public"."skill_assessments"("id","employee_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valid_skill_assessments_identity_unique" ON "valid_skill_assessments" USING btree ("assessment_id","employee_id","skill_id");--> statement-breakpoint
INSERT INTO valid_skill_assessments (assessment_id, employee_id, skill_id)
SELECT id, employee_id, skill_id FROM skill_assessments
WHERE status = 'archived' AND passed = true AND voided_at IS NULL;--> statement-breakpoint
ALTER TABLE "employee_current_skills" ADD CONSTRAINT "employee_current_skills_valid_assessment_fk" FOREIGN KEY ("assessment_id","employee_id","skill_id") REFERENCES "public"."valid_skill_assessments"("assessment_id","employee_id","skill_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION sync_valid_skill_assessment() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'archived' AND NEW.passed = true AND NEW.voided_at IS NULL THEN
    INSERT INTO valid_skill_assessments (assessment_id, employee_id, skill_id)
    VALUES (NEW.id, NEW.employee_id, NEW.skill_id)
    ON CONFLICT (assessment_id) DO UPDATE
      SET employee_id = EXCLUDED.employee_id, skill_id = EXCLUDED.skill_id;
  ELSE
    DELETE FROM valid_skill_assessments WHERE assessment_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER skill_assessments_sync_valid_marker
AFTER INSERT OR UPDATE OF status, passed, voided_at ON skill_assessments
FOR EACH ROW EXECUTE FUNCTION sync_valid_skill_assessment();
