CREATE FUNCTION enforce_confirmed_training_record() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM training_tasks t
  WHERE t.id = NEW.task_id
    AND t.status = 'confirmed'
    AND t.cancelled_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'training record requires a confirmed, non-cancelled task'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER training_records_enforce_confirmed_task
BEFORE INSERT OR UPDATE ON training_records
FOR EACH ROW EXECUTE FUNCTION enforce_confirmed_training_record();--> statement-breakpoint
CREATE FUNCTION protect_recorded_training_task() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'confirmed'
    AND EXISTS (SELECT 1 FROM training_records r WHERE r.task_id = OLD.id)
  THEN
    RAISE EXCEPTION 'a task with a formal training record must remain confirmed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER training_tasks_protect_formal_record
BEFORE UPDATE OF status ON training_tasks
FOR EACH ROW EXECUTE FUNCTION protect_recorded_training_task();
