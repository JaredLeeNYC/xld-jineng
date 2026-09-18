import type { TrainingExamInput, TrainingExamView } from "../../shared/src/training-exam";
import type { Pool } from "pg";
import type { AssessmentActor } from "./assessment-repository";

export const createPostgresTrainingExamRepository = (pool: Pool) => ({
  async list(actor: AssessmentActor): Promise<TrainingExamView[]> {
    const result = await pool.query(
      `select x.id,x.plan_id as "planId",p.title as "planTitle",
      x.employee_id as "employeeId",e.employee_number as "employeeNumber",e.display_name as "employeeName",
      e.department_id as "departmentId",d.name as "departmentName",x.skill_id as "skillId",s.name as "skillName",
      x.method,x.score,x.passed,x.completed_at as "completedAt",x.remarks,x.created_at as "createdAt"
      from training_exams x join employees e on e.id=x.employee_id join departments d on d.id=e.department_id
      join training_plans p on p.id=x.plan_id join skills s on s.id=x.skill_id
      where ($1 in ('hr_admin','executive_viewer') or ($1='department_manager' and e.department_id=$2::uuid)
        or ($1='employee' and e.id=$3::uuid)) order by x.completed_at desc,x.created_at desc`,
      [actor.role, actor.departmentId ?? null, actor.employeeId],
    );
    return result.rows.map((row) => ({
      ...row,
      score: Number(row.score),
      completedAt: new Date(row.completedAt).toISOString(),
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  },
  async create(actor: AssessmentActor, input: TrainingExamInput): Promise<string | undefined> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const target = await client.query(
        `select t.id from training_tasks t
        join employees e on e.id=t.employee_id join training_plans p on p.id=t.plan_id
        join skills s on s.id=$3 and s.active=true
        where t.plan_id=$1 and t.employee_id=$2 and t.status<>'cancelled' and e.active=true
          and p.status in ('published','in_progress','completed') and coalesce(t.actual_start_at,p.start_at)<=$6
          and (exists(select 1 from training_material_skills ms where ms.material_id=any(p.material_ids) and ms.skill_id=$3 and ms.active=true)
            or not exists(select 1 from training_material_skills ms where ms.material_id=any(p.material_ids) and ms.active=true))
          and ($4='hr_admin' or ($4='department_manager' and e.department_id=$5::uuid))
        for update of t,p`,
        [
          input.planId,
          input.employeeId,
          input.skillId,
          actor.role,
          actor.departmentId ?? null,
          input.completedAt,
        ],
      );
      if (!target.rowCount) {
        await client.query("rollback");
        return undefined;
      }
      const result = await client.query<{ id: string }>(
        `insert into training_exams
        (plan_id,employee_id,skill_id,method,score,passed,completed_at,remarks,created_by_account_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [
          input.planId,
          input.employeeId,
          input.skillId,
          input.method,
          input.score,
          input.passed,
          input.completedAt,
          input.remarks ?? null,
          actor.accountId,
        ],
      );
      const id = result.rows[0]!.id;
      await client.query(
        "insert into audit_logs(actor_account_id,action,object_type,object_id,summary) values($1,'training_exam.created','training_exam',$2,$3)",
        [actor.accountId, id, { planId: input.planId, employeeId: input.employeeId }],
      );
      await client.query("commit");
      return id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },
});
export type TrainingExamRepository = ReturnType<typeof createPostgresTrainingExamRepository>;
