import type { Pool } from "pg";
import type { AnnualTrainingPlan, TrainingHoursFact } from "../../shared/src/training-analytics";

export const createPostgresTrainingAnalyticsRepository = (pool: Pool) => ({
  async loadFacts(year: number, departmentId?: string) {
    const client = await pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      const params = [
        `${year}-01-01T00:00:00+08:00`,
        `${year + 1}-01-01T00:00:00+08:00`,
        departmentId ?? null,
      ];
      const employees = await client.query<{ count: number }>(
        "select count(*)::int as count from employees where active=true and ($1::uuid is null or department_id=$1)",
        [departmentId ?? null],
      );
      const plans = await client.query<AnnualTrainingPlan>(
        `select p.id,p.title,p.status,p.start_at as "startAt",p.due_at as "dueAt",p.planned_hours::float8 as "plannedHours",
        (select count(distinct e.id)::int from employees e where ($3::uuid is null or e.department_id=$3) and (
          (p.published_at is not null and exists (select 1 from training_tasks t where t.plan_id=p.id and t.employee_id=e.id and t.status<>'cancelled')) or
          (p.published_at is null and e.active=true and (
            (p.scope_type='department' and e.department_id=any(p.scope_department_ids)) or
            (p.scope_type='position' and exists (select 1 from position_assignments pa where pa.employee_id=e.id and pa.ended_at is null and pa.position_id=any(p.scope_position_ids))) or
            (p.scope_type='employees' and exists (select 1 from training_plan_scope_employees se where se.plan_id=p.id and se.employee_id=e.id and se.active=true))
          )))) as "participantCount"
        from training_plans p where p.deleted_at is null and p.status<>'cancelled' and p.start_at >= $1::timestamptz and p.start_at < $2::timestamptz
        and ($3::uuid is null or (p.scope_type='department' and $3::uuid=any(p.scope_department_ids))
          or (p.scope_type='position' and exists (select 1 from positions pos where pos.id=any(p.scope_position_ids) and pos.department_id=$3))
          or exists (select 1 from training_plan_scope_employees se join employees e on e.id=se.employee_id where se.plan_id=p.id and se.active=true and e.department_id=$3)
          or exists (select 1 from training_tasks t join employees e on e.id=t.employee_id where t.plan_id=p.id and t.status<>'cancelled' and e.department_id=$3))
        order by p.start_at,p.title`,
        params,
      );
      const tasks = await client.query<TrainingHoursFact>(
        `select t.employee_id as "employeeId",p.start_at as "startAt",coalesce(t.actual_completed_at,t.confirmed_at) as "completedAt",
        p.planned_hours::float8 as "plannedHours",t.actual_hours::float8 as "actualHours",t.status
        from training_tasks t join training_plans p on p.id=t.plan_id join employees e on e.id=t.employee_id
        where p.deleted_at is null and p.status<>'cancelled' and t.status='confirmed'
          and coalesce(t.actual_completed_at,t.confirmed_at) >= $1::timestamptz and coalesce(t.actual_completed_at,t.confirmed_at) < $2::timestamptz
          and ($3::uuid is null or e.department_id=$3)`,
        params,
      );
      await client.query("commit");
      return {
        employeeCount: employees.rows[0]?.count ?? 0,
        plans: plans.rows.map((p) => ({
          ...p,
          startAt: new Date(p.startAt).toISOString(),
          dueAt: new Date(p.dueAt).toISOString(),
        })),
        tasks: tasks.rows.map((t) => ({
          ...t,
          startAt: new Date(t.startAt).toISOString(),
          completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
        })),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },
  async registerHours(input: {
    taskId: string;
    hours: number;
    accountId: string;
    employeeId: string;
    role: string;
    departmentId?: string;
  }) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const prior = await client.query<{ actualHours: number | null }>(
        `select t.actual_hours::float8 as "actualHours" from training_tasks t
        join training_plans p on p.id=t.plan_id join employees e on e.id=t.employee_id
        where t.id=$1 and t.status='confirmed' and p.deleted_at is null and p.status<>'cancelled'
        and ($2='hr_admin' or ($2='department_manager' and e.department_id=$3::uuid and $4::uuid=any(p.owner_employee_ids))) for update of t`,
        [input.taskId, input.role, input.departmentId ?? null, input.employeeId],
      );
      if (!prior.rows.length) {
        await client.query("rollback");
        return false;
      }
      await client.query("update training_tasks set actual_hours=$2,updated_at=now() where id=$1", [
        input.taskId,
        input.hours,
      ]);
      await client.query(
        `insert into audit_logs (actor_account_id,action,object_type,object_id,summary) values ($1,'training_task.hours_registered','training_task',$2,$3)`,
        [
          input.accountId,
          input.taskId,
          { previousHours: prior.rows[0]!.actualHours, actualHours: input.hours },
        ],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },
});
export type TrainingAnalyticsRepository = ReturnType<
  typeof createPostgresTrainingAnalyticsRepository
>;
