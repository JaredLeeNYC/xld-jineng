import type {
  TrainingPlanStatus,
  TrainingType,
  TrainingPlanView,
  TrainingScopeType,
  TrainingTaskView,
} from "@jineng/skill-matrix-shared";
import type { Pool, PoolClient } from "pg";
import { emitInAppNotification, enqueueManagementWebhook } from "./notification-repository";

const transaction = async <T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await operation(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

const audit = async (
  client: Pool | PoolClient,
  actorAccountId: string,
  action: string,
  objectType: string,
  objectId: string,
  summary: unknown = {},
) => {
  await client.query(
    `insert into audit_logs (actor_account_id,action,object_type,object_id,summary)
     values ($1,$2,$3,$4,$5)`,
    [actorAccountId, action, objectType, objectId, summary],
  );
};

type PlanInput = {
  trainingType?: TrainingType;
  title: string;
  materialIds?: string[];
  ownerEmployeeIds?: string[];
  scopeDepartmentIds?: string[];
  scopePositionIds?: string[];
  materialId: string;
  ownerEmployeeId: string;
  startAt: Date;
  dueAt: Date;
  location: string;
  scopeType: TrainingScopeType;
  scopeDepartmentId?: string;
  scopePositionId?: string;
  scopeEmployeeIds: string[];
};

type ActorScope = {
  accountId: string;
  role: "hr_admin" | "department_manager";
  departmentId?: string;
};

const planSelect = `select p.id,p.title,p.training_type as "trainingType",p.status,p.material_ids as "materialIds",p.owner_employee_ids as "ownerEmployeeIds",
 p.scope_department_ids as "scopeDepartmentIds",p.scope_position_ids as "scopePositionIds",
 p.created_by_account_id as "createdByAccountId",p.approval_comment as "approvalComment",
 (select jsonb_agg(jsonb_build_object('id',mm.id,'title',mm.title,'skillIds',(select coalesce(array_agg(ms.skill_id),'{}') from training_material_skills ms where ms.material_id=mm.id and ms.active=true))) from training_materials mm where mm.id=any(p.material_ids)) as materials,
 (select array_agg(oo.display_name) from employees oo where oo.id=any(p.owner_employee_ids)) as "ownerNames",p.material_id as "materialId",m.title as "materialTitle",
  p.owner_employee_id as "ownerEmployeeId",owner.display_name as "ownerName",
  p.start_at as "startAt",p.due_at as "dueAt",p.location,p.scope_type as "scopeType",
  p.scope_department_id as "scopeDepartmentId",p.scope_position_id as "scopePositionId",
  (select coalesce(jsonb_agg(distinct jsonb_build_object('id',d.id,'name',d.name)),'[]') from departments d
    where d.id=any(p.scope_department_ids) or d.id in (select department_id from positions where id=any(p.scope_position_ids))
    or exists (select 1 from training_plan_scope_employees se join employees e on e.id=se.employee_id where se.plan_id=p.id and se.active=true and e.department_id=d.id)) as departments,
  (select coalesce(jsonb_agg(distinct jsonb_build_object('id',pos.id,'name',pos.name)),'[]') from positions pos
    where pos.id=any(p.scope_position_ids) or (p.scope_type='department' and pos.department_id=any(p.scope_department_ids))
    or exists (select 1 from training_plan_scope_employees se join position_assignments pa on pa.employee_id=se.employee_id and pa.ended_at is null where se.plan_id=p.id and se.active=true and pa.position_id=pos.id)) as positions,
  (select coalesce(jsonb_agg(e.display_name order by e.employee_number),'[]') from training_plan_scope_employees se join employees e on e.id=se.employee_id where se.plan_id=p.id and se.active=true) as "scopeEmployeeNames",
  coalesce(array_agg(distinct pse.employee_id) filter (where pse.active=true),'{}') as "scopeEmployeeIds",
  count(distinct t.id)::int as "taskCount",
  count(distinct r.id)::int as "confirmedCount",p.created_at as "createdAt"
 from training_plans p join training_materials m on m.id=p.material_id
 join employees owner on owner.id=p.owner_employee_id
 left join training_plan_scope_employees pse on pse.plan_id=p.id
 left join training_tasks t on t.plan_id=p.id and t.status <> 'cancelled'
 left join training_records r on r.task_id=t.id`;

const taskSelect = `select t.id,t.plan_id as "planId",p.title as "planTitle",t.employee_id as "employeeId",
  p.material_ids as "materialIds",p.owner_employee_ids as "ownerEmployeeIds",
 (select jsonb_agg(jsonb_build_object('id',mm.id,'title',mm.title,'skillIds',(select coalesce(array_agg(ms.skill_id),'{}') from training_material_skills ms where ms.material_id=mm.id and ms.active=true))) from training_materials mm where mm.id=any(p.material_ids)) as materials,
 (select array_agg(oo.display_name) from employees oo where oo.id=any(p.owner_employee_ids)) as "ownerNames",
 t.actual_start_at as "actualStartAt",t.actual_completed_at as "actualCompletedAt",
 p.training_type as "trainingType",e.department_id as "departmentId",d.name as "departmentName",
  pa.position_id as "positionId",pos.name as "positionName",e.display_name as "employeeName",e.employee_number as "employeeNumber",p.material_id as "materialId",
  m.title as "materialTitle",p.owner_employee_id as "ownerEmployeeId",owner.display_name as "ownerName",
  p.start_at as "startAt",p.due_at as "dueAt",p.location,t.status,t.submitted_at as "submittedAt",
  t.confirmed_at as "confirmedAt",t.return_reason as "returnReason",
  (p.due_at < $1 and t.status not in ('confirmed','cancelled')) as overdue,
  count(distinct et.evidence_id)::int as "evidenceCount",
  coalesce(jsonb_agg(distinct jsonb_build_object('id',ev.id,'filename',ev.original_filename))
    filter (where ev.id is not null),'[]') as evidence
 from training_tasks t join training_plans p on p.id=t.plan_id
 join training_materials m on m.id=p.material_id join employees e on e.id=t.employee_id
 join employees owner on owner.id=p.owner_employee_id
 join departments d on d.id=e.department_id
 left join position_assignments pa on pa.employee_id=e.id and pa.ended_at is null
 left join positions pos on pos.id=pa.position_id
 left join training_evidence_tasks et on et.task_id=t.id
 left join training_evidence ev on ev.id=et.evidence_id`;

const normalizePlan = (row: any): TrainingPlanView => ({
  ...row,
  startAt: new Date(row.startAt).toISOString(),
  dueAt: new Date(row.dueAt).toISOString(),
  createdAt: new Date(row.createdAt).toISOString(),
  ...(row.scopeDepartmentId ? { scopeDepartmentId: row.scopeDepartmentId } : {}),
  ...(row.scopePositionId ? { scopePositionId: row.scopePositionId } : {}),
});
const normalizeTask = (row: any): TrainingTaskView => ({
  ...row,
  startAt: new Date(row.startAt).toISOString(),
  dueAt: new Date(row.dueAt).toISOString(),
  ...(row.actualStartAt ? { actualStartAt: new Date(row.actualStartAt).toISOString() } : {}),
  ...(row.actualCompletedAt
    ? { actualCompletedAt: new Date(row.actualCompletedAt).toISOString() }
    : {}),
  ...(row.submittedAt ? { submittedAt: new Date(row.submittedAt).toISOString() } : {}),
  ...(row.confirmedAt ? { confirmedAt: new Date(row.confirmedAt).toISOString() } : {}),
  ...(row.returnReason ? { returnReason: row.returnReason } : {}),
});

export const createPostgresTrainingRepository = (pool: Pool) => ({
  async advanceStatuses(now: Date) {
    await transaction(pool, async (client) => {
      await client.query(
        `update training_plans p set status='completed',completed_at=$1,updated_at=$1
         where p.status='in_progress' and exists (select 1 from training_tasks t where t.plan_id=p.id)
           and not exists (select 1 from training_tasks t where t.plan_id=p.id and t.status not in ('confirmed','cancelled'))`,
        [now],
      );
    });
  },

  async listPlans(actor: ActorScope): Promise<TrainingPlanView[]> {
    const result = await pool.query(
      `${planSelect}
       where p.deleted_at is null and ($1='hr_admin' or p.created_by_account_id=$2
         or (p.scope_type='department' and $3::uuid=any(p.scope_department_ids))
         or exists (select 1 from positions sp where sp.id=any(p.scope_position_ids) and sp.department_id=$3::uuid)
         or exists (select 1 from training_plan_scope_employees se join employees ee on ee.id=se.employee_id where se.plan_id=p.id and se.active=true and ee.department_id=$3::uuid)
         or exists (select 1 from training_tasks visible_t join employees visible_e on visible_e.id=visible_t.employee_id
           where visible_t.plan_id=p.id and visible_e.department_id=$3::uuid))
       group by p.id,m.title,owner.display_name order by p.start_at desc,p.created_at desc`,
      [actor.role, actor.accountId, actor.departmentId ?? null],
    );
    return result.rows.map(normalizePlan);
  },

  async validateDraft(input: PlanInput, actor: ActorScope) {
    if (actor.role === "department_manager" && !actor.departmentId) return false;
    const materialIds = input.materialIds ?? [input.materialId];
    const ownerIds = input.ownerEmployeeIds ?? [input.ownerEmployeeId];
    const materials = await pool.query(
      "select id from training_materials where id=any($1::uuid[]) and active=true",
      [materialIds],
    );
    if (materials.rowCount !== new Set(materialIds).size || !materials.rowCount) return false;
    const owners = await pool.query(
      "select e.id from employees e where e.id=any($1::uuid[]) and e.active=true and ($2::uuid is null or e.department_id=$2) and exists (select 1 from user_accounts ua where ua.employee_id=e.id and ua.active=true and ua.role in ('hr_admin','department_manager'))",
      [ownerIds, actor.role === "department_manager" ? actor.departmentId : null],
    );
    if (owners.rowCount !== new Set(ownerIds).size || !owners.rowCount) return false;
    const ids =
      input.scopeType === "department"
        ? (input.scopeDepartmentIds ?? [input.scopeDepartmentId!])
        : input.scopeType === "position"
          ? (input.scopePositionIds ?? [input.scopePositionId!])
          : input.scopeEmployeeIds;
    const table =
      input.scopeType === "department"
        ? "departments"
        : input.scopeType === "position"
          ? "positions"
          : "employees";
    const department = input.scopeType === "department" ? "id" : "department_id";
    const scope = await pool.query(
      `select id from ${table} where id=any($1::uuid[]) and active=true and ($2::uuid is null or ${department}=$2)`,
      [ids, actor.role === "department_manager" ? actor.departmentId : null],
    );
    if (!scope.rowCount || scope.rowCount !== new Set(ids).size) return false;
    return true;
  },

  async createDraft(input: PlanInput & { id: string; actor: ActorScope }) {
    return transaction(pool, async (client) => {
      await client.query(
        `insert into training_plans (id,title,material_id,owner_employee_id,start_at,due_at,location,
          scope_type,scope_department_id,scope_position_id,created_by_account_id,training_type)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          input.id,
          input.title,
          input.materialId,
          input.ownerEmployeeId,
          input.startAt,
          input.dueAt,
          input.location,
          input.scopeType,
          input.scopeDepartmentId ?? null,
          input.scopePositionId ?? null,
          input.actor.accountId,
          input.trainingType ?? "professional",
        ],
      );
      await client.query(
        "update training_plans set material_ids=$2,owner_employee_ids=$3,scope_department_ids=$4,scope_position_ids=$5 where id=$1",
        [
          input.id,
          input.materialIds ?? [input.materialId],
          input.ownerEmployeeIds ?? [input.ownerEmployeeId],
          input.scopeDepartmentIds ?? (input.scopeDepartmentId ? [input.scopeDepartmentId] : []),
          input.scopePositionIds ?? (input.scopePositionId ? [input.scopePositionId] : []),
        ],
      );
      for (const employeeId of new Set(input.scopeEmployeeIds))
        await client.query(
          "insert into training_plan_scope_employees (plan_id,employee_id) values ($1,$2)",
          [input.id, employeeId],
        );
      await audit(
        client,
        input.actor.accountId,
        "training_plan.created",
        "training_plan",
        input.id,
      );
      return input.id;
    });
  },

  async updateDraft(id: string, input: PlanInput & { actor: ActorScope }) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        `update training_plans set title=$2,material_id=$3,owner_employee_id=$4,start_at=$5,due_at=$6,
          location=$7,scope_type=$8,scope_department_id=$9,scope_position_id=$10,training_type=$13,updated_at=now()
         where id=$1 and deleted_at is null and status='draft' and ($11='hr_admin' or created_by_account_id=$12) returning id`,
        [
          id,
          input.title,
          input.materialId,
          input.ownerEmployeeId,
          input.startAt,
          input.dueAt,
          input.location,
          input.scopeType,
          input.scopeDepartmentId ?? null,
          input.scopePositionId ?? null,
          input.actor.role,
          input.actor.accountId,
          input.trainingType ?? "professional",
        ],
      );
      if (!result.rowCount) return false;
      await client.query(
        "update training_plan_scope_employees set active=false,updated_at=now() where plan_id=$1 and active=true",
        [id],
      );
      await client.query(
        "update training_plans set material_ids=$2,owner_employee_ids=$3,scope_department_ids=$4,scope_position_ids=$5 where id=$1",
        [
          id,
          input.materialIds ?? [input.materialId],
          input.ownerEmployeeIds ?? [input.ownerEmployeeId],
          input.scopeDepartmentIds ?? (input.scopeDepartmentId ? [input.scopeDepartmentId] : []),
          input.scopePositionIds ?? (input.scopePositionId ? [input.scopePositionId] : []),
        ],
      );
      for (const employeeId of new Set(input.scopeEmployeeIds))
        await client.query(
          `insert into training_plan_scope_employees (plan_id,employee_id) values ($1,$2)
          on conflict (plan_id,employee_id) do update set active=true,updated_at=now()`,
          [id, employeeId],
        );
      await audit(client, input.actor.accountId, "training_plan.updated", "training_plan", id);
      return true;
    });
  },

  async submitPlan(id: string, actor: ActorScope, now: Date) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        "update training_plans set status='pending_approval',submitted_at=$4,approval_comment=null,updated_at=$4 where id=$1 and deleted_at is null and status='draft' and ($2='hr_admin' or created_by_account_id=$3) returning id",
        [id, actor.role, actor.accountId, now],
      );
      if (!result.rowCount) return false;
      await audit(client, actor.accountId, "training_plan.submitted", "training_plan", id);
      return true;
    });
  },
  async rejectPlan(id: string, actor: ActorScope, reason: string, now: Date) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        `update training_plans p set status='draft',approval_comment=$4,updated_at=$5
       where p.id=$1 and p.deleted_at is null and p.status='pending_approval' and p.created_by_account_id<>$3
       and ($2='hr_admin' or ($2='department_manager' and $6::uuid is not null
         and not exists (select 1 from employees e where e.id=any(p.owner_employee_ids) and e.department_id<>$6)
         and (p.scope_type<>'department' or p.scope_department_ids <@ array[$6::uuid])
         and not exists (select 1 from positions pos where pos.id=any(p.scope_position_ids) and pos.department_id<>$6)
         and not exists (select 1 from training_plan_scope_employees se join employees e on e.id=se.employee_id where se.plan_id=p.id and se.active=true and e.department_id<>$6))) returning id`,
        [id, actor.role, actor.accountId, reason, now, actor.departmentId ?? null],
      );
      if (!result.rowCount) return false;
      await audit(client, actor.accountId, "training_plan.rejected", "training_plan", id, {
        reason,
      });
      return true;
    });
  },
  async deletePlan(id: string, actor: ActorScope, now: Date) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        "update training_plans set deleted_at=$4,updated_at=$4 where id=$1 and deleted_at is null and status in ('draft','cancelled') and ($2='hr_admin' or created_by_account_id=$3) returning id",
        [id, actor.role, actor.accountId, now],
      );
      if (!result.rowCount) return false;
      await audit(client, actor.accountId, "training_plan.deleted", "training_plan", id);
      return true;
    });
  },
  async executeTask(
    id: string,
    employeeId: string,
    accountId: string,
    now: Date,
    complete: boolean,
  ) {
    return transaction(pool, async (client) => {
      const plan = await client.query<{ id: string }>(
        `select p.id from training_plans p join training_tasks t on t.plan_id=p.id
        where t.id=$1 and p.deleted_at is null and $2::uuid=any(p.owner_employee_ids) and p.status in ('published','in_progress') and exists (select 1 from user_accounts ua where ua.employee_id=$2 and ua.active=true and ua.role in ('hr_admin','department_manager')) for update of p`,
        [id, employeeId],
      );
      if (!plan.rowCount) return false;
      const result = await client.query(
        `update training_tasks set status=$3,actual_start_at=case when $4 then actual_start_at else $2 end,
         actual_completed_at=case when $4 then $2 else null end,confirmed_at=case when $4 then $2 else null end,updated_at=$2
         where id=$1 and status=any($5::varchar[]) returning id`,
        [
          id,
          now,
          complete ? "confirmed" : "in_progress",
          complete,
          complete ? ["in_progress"] : ["assigned", "returned"],
        ],
      );
      if (!result.rowCount) return false;
      if (complete)
        await client.query(
          "insert into training_records (task_id,confirmed_by_account_id,confirmed_at) values ($1,$2,$3)",
          [id, accountId, now],
        );
      await client.query(
        `update training_plans p set status=case when not exists (select 1 from training_tasks t where t.plan_id=p.id and t.status not in ('confirmed','cancelled')) then 'completed' else 'in_progress' end,
        completed_at=case when not exists (select 1 from training_tasks t where t.plan_id=p.id and t.status not in ('confirmed','cancelled')) then $2::timestamptz else null end,updated_at=$2 where p.id=$1`,
        [plan.rows[0]!.id, now],
      );
      await audit(
        client,
        accountId,
        complete ? "training_task.completed" : "training_task.started",
        "training_task",
        id,
      );
      return true;
    });
  },

  async publish(id: string, actor: ActorScope, now: Date) {
    return transaction(pool, async (client) => {
      const plan = await client.query<any>(
        `select * from training_plans where id=$1 and deleted_at is null and status='pending_approval' and created_by_account_id<>$3 and $2 in ('hr_admin','department_manager') for update`,
        [id, actor.role, actor.accountId],
      );
      const row = plan.rows[0];
      if (!row) return { ok: false as const, reason: "state" as const };
      if (actor.role === "department_manager" && !actor.departmentId)
        return { ok: false as const, reason: "scope" as const };
      const material = await client.query(
        "select id from training_materials where id=any($1::uuid[]) and active=true",
        [row.material_ids],
      );
      if (material.rowCount !== row.material_ids.length || !material.rowCount)
        return { ok: false as const, reason: "material" as const };
      const owners = await client.query(
        "select e.id from employees e where e.id=any($1::uuid[]) and e.active=true and ($2::uuid is null or e.department_id=$2) and exists (select 1 from user_accounts ua where ua.employee_id=e.id and ua.active=true and ua.role in ('hr_admin','department_manager'))",
        [row.owner_employee_ids, actor.role === "department_manager" ? actor.departmentId : null],
      );
      if (owners.rowCount !== row.owner_employee_ids.length || !owners.rowCount)
        return { ok: false as const, reason: "scope" as const };
      const scopeIds =
        row.scope_type === "department"
          ? row.scope_department_ids
          : row.scope_type === "position"
            ? row.scope_position_ids
            : null;
      if (scopeIds) {
        const scopeTable = row.scope_type === "department" ? "departments" : "positions";
        const scopeDepartment = row.scope_type === "department" ? "id" : "department_id";
        const scope = await client.query(
          `select id from ${scopeTable} where id=any($1::uuid[]) and active=true and ($2::uuid is null or ${scopeDepartment}=$2)`,
          [scopeIds, actor.role === "department_manager" ? actor.departmentId : null],
        );
        if (!scope.rowCount || scope.rowCount !== scopeIds.length)
          return { ok: false as const, reason: "scope" as const };
      }
      let employees;
      if (row.scope_type === "department")
        employees = await client.query<{ id: string; departmentId: string }>(
          'select id,department_id as "departmentId" from employees where active=true and department_id=any($1::uuid[])',
          [row.scope_department_ids],
        );
      else if (row.scope_type === "position")
        employees = await client.query<{ id: string; departmentId: string }>(
          `select e.id,e.department_id as "departmentId" from employees e join position_assignments pa on pa.employee_id=e.id and pa.ended_at is null where e.active=true and pa.position_id=any($1::uuid[])`,
          [row.scope_position_ids],
        );
      else
        employees = await client.query<{ id: string; departmentId: string }>(
          `select e.id,e.department_id as "departmentId" from employees e join training_plan_scope_employees pse on pse.employee_id=e.id and pse.plan_id=$1 and pse.active=true where e.active=true`,
          [id],
        );
      if (
        !employees.rowCount ||
        (actor.role === "department_manager" &&
          employees.rows.some((employee) => employee.departmentId !== actor.departmentId))
      )
        return { ok: false as const, reason: "scope" as const };
      for (const employee of new Map(
        employees.rows.map((employee) => [employee.id, employee]),
      ).values()) {
        const task = await client.query<{ id: string }>(
          "insert into training_tasks (plan_id,employee_id) values ($1,$2) on conflict (plan_id,employee_id) do update set status='assigned',cancelled_at=null,updated_at=now() where training_tasks.status='cancelled' returning id",
          [id, employee.id],
        );
        for (const materialId of row.material_ids)
          await client.query(
            `insert into training_material_access_grants
          (material_id,employee_id,source_type,source_reference) values ($1,$2,'training_task',$3) on conflict do nothing`,
            [materialId, employee.id, task.rows[0]!.id],
          );
        await emitInAppNotification(client, {
          employeeId: employee.id,
          eventKey: `training_published:${task.rows[0]!.id}`,
          type: "training_published",
          title: "新的培训任务",
          message: `你有新的培训“${row.title}”待完成`,
          entityType: "training_task",
          entityId: task.rows[0]!.id,
        });
      }
      const status: TrainingPlanStatus = "published";
      await client.query(
        "update training_plans set status=$2,published_at=$3,updated_at=$3,approved_by_account_id=$4 where id=$1",
        [id, status, now, actor.accountId],
      );
      await audit(client, actor.accountId, "training_plan.published", "training_plan", id, {
        taskCount: employees.rowCount,
      });
      await enqueueManagementWebhook(client, {
        eventKey: `training_published:${id}`,
        eventType: "training_published",
        title: "新培训已发布",
        message: `“${row.title}”已发布，共 ${employees.rowCount} 人`,
      });
      return { ok: true as const, taskCount: employees.rowCount, status };
    });
  },

  async listTasks(input: {
    now: Date;
    actorRole: string;
    employeeId: string;
    departmentId?: string;
    accountId: string;
  }) {
    const result = await pool.query(
      `${taskSelect}
       where (t.employee_id=$3 or $3::uuid=any(p.owner_employee_ids) or $2='hr_admin'
         or ($2='department_manager' and (e.department_id=$4::uuid or p.owner_employee_id=$3)))
       group by t.id,p.id,m.title,e.id,d.name,pa.position_id,pos.name,owner.display_name
       order by p.start_at desc,t.created_at desc`,
      [input.now, input.actorRole, input.employeeId, input.departmentId ?? null],
    );
    return result.rows.map(normalizeTask);
  },

  async submitTask(taskId: string, employeeId: string, now: Date, actorAccountId: string) {
    return transaction(pool, async (client) => {
      const result = await client.query<{ planId: string }>(
        `update training_tasks t set status='submitted',submitted_at=$3,returned_at=null,return_reason=null,updated_at=$3
         from training_plans p where t.id=$1 and t.employee_id=$2 and p.id=t.plan_id
           and p.status in ('published','in_progress') and p.start_at <= $3
           and t.status in ('assigned','returned') returning t.plan_id as "planId"`,
        [taskId, employeeId, now],
      );
      if (!result.rowCount) return false;
      await audit(client, actorAccountId, "training_task.submitted", "training_task", taskId);
      const detail = await client.query<{ title: string; employeeName: string }>(
        `select p.title,e.display_name as "employeeName" from training_plans p
         join employees e on e.id=$2 where p.id=$1`,
        [result.rows[0]!.planId, employeeId],
      );
      await enqueueManagementWebhook(client, {
        eventKey: `training_pending_confirmation:${taskId}:${now.toISOString()}`,
        eventType: "training_pending_confirmation",
        title: "培训任务待确认",
        message: `${detail.rows[0]!.employeeName}已提交“${detail.rows[0]!.title}”`,
      });
      return true;
    });
  },

  async taskAuthorization(taskId: string, actor: ActorScope) {
    const result = await pool.query(
      `select t.status,t.employee_id as "employeeId",p.owner_employee_id as "ownerEmployeeId",e.department_id as "departmentId"
       from training_tasks t join training_plans p on p.id=t.plan_id join employees e on e.id=t.employee_id
       where t.id=$1 and ($2='hr_admin' or p.owner_employee_id=(select employee_id from user_accounts where id=$3)
         or e.department_id=$4::uuid)`,
      [taskId, actor.role, actor.accountId, actor.departmentId ?? null],
    );
    return result.rows[0] as { status: string; employeeId: string } | undefined;
  },

  async confirmTask(taskId: string, actorAccountId: string, now: Date) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        "update training_tasks set status='confirmed',confirmed_at=$2,updated_at=$2 where id=$1 and status='submitted' returning plan_id as \"planId\"",
        [taskId, now],
      );
      if (!result.rowCount) return false;
      await client.query(
        "insert into training_records (task_id,confirmed_by_account_id,confirmed_at) values ($1,$2,$3)",
        [taskId, actorAccountId, now],
      );
      await audit(client, actorAccountId, "training_task.confirmed", "training_task", taskId);
      return true;
    });
  },

  async returnTask(taskId: string, reason: string, actorAccountId: string, now: Date) {
    return transaction(pool, async (client) => {
      const result = await client.query<{ employeeId: string; planId: string }>(
        `update training_tasks set status='returned',returned_at=$2,return_reason=$3,updated_at=$2
         where id=$1 and status='submitted' returning employee_id as "employeeId",plan_id as "planId"`,
        [taskId, now, reason],
      );
      if (!result.rowCount) return false;
      await audit(client, actorAccountId, "training_task.returned", "training_task", taskId, {
        reason,
      });
      const plan = await client.query<{ title: string }>(
        "select title from training_plans where id=$1",
        [result.rows[0]!.planId],
      );
      await emitInAppNotification(client, {
        employeeId: result.rows[0]!.employeeId,
        eventKey: `training_returned:${taskId}:${now.toISOString()}`,
        type: "training_returned",
        title: "培训任务已退回",
        message: `“${plan.rows[0]!.title}”已退回：${reason}`.slice(0, 500),
        entityType: "training_task",
        entityId: taskId,
      });
      return true;
    });
  },

  async withdrawPlan(id: string, actor: ActorScope, now: Date) {
    return transaction(pool, async (client) => {
      const plan = await client.query(
        `select id from training_plans where id=$1 and deleted_at is null and status in ('pending_approval','published','in_progress')
         and ($2='hr_admin' or created_by_account_id=$3) for update`,
        [id, actor.role, actor.accountId],
      );
      if (!plan.rowCount) return false;
      const exams = await client.query("select 1 from training_exams where plan_id=$1 limit 1", [
        id,
      ]);
      if (exams.rowCount) return false;
      const tasks = await client.query<{ status: string; actualStartAt: Date | null }>(
        'select status,actual_start_at as "actualStartAt" from training_tasks where plan_id=$1 for update',
        [id],
      );
      if (
        tasks.rows.some(
          (task) => task.actualStartAt || !["assigned", "cancelled"].includes(task.status),
        )
      )
        return false;
      const evidence = await client.query(
        "select 1 from training_evidence where plan_id=$1 limit 1",
        [id],
      );
      if (evidence.rowCount) return false;
      await client.query(
        "update training_tasks set status='cancelled',cancelled_at=$2,updated_at=$2 where plan_id=$1 and status='assigned'",
        [id, now],
      );
      await client.query("update training_plans set status='draft',updated_at=$2 where id=$1", [
        id,
        now,
      ]);
      await audit(client, actor.accountId, "training_plan.withdrawn", "training_plan", id);
      return true;
    });
  },

  async cancelPlan(id: string, actor: ActorScope, now: Date) {
    return transaction(pool, async (client) => {
      const plan = await client.query(
        `select id from training_plans where id=$1 and deleted_at is null and status in ('draft','pending_approval','published','in_progress')
         and ($2='hr_admin' or created_by_account_id=$3) for update`,
        [id, actor.role, actor.accountId],
      );
      if (!plan.rowCount) return false;
      const confirmed = await client.query(
        "select 1 from training_tasks where plan_id=$1 and status='confirmed' limit 1",
        [id],
      );
      if (confirmed.rowCount) return false;
      await client.query(
        "update training_plans set status='cancelled',cancelled_at=$2,updated_at=$2 where id=$1",
        [id, now],
      );
      await client.query(
        "update training_tasks set status='cancelled',cancelled_at=$2,updated_at=$2 where plan_id=$1 and status<>'cancelled'",
        [id, now],
      );
      await audit(client, actor.accountId, "training_plan.cancelled", "training_plan", id);
      return true;
    });
  },

  async batchConfirm(input: {
    planId: string;
    taskIds: string[];
    evidence: {
      id: string;
      storageKey: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      checksum: string;
    };
    actorAccountId: string;
    actorRole: "hr_admin" | "department_manager";
    actorEmployeeId: string;
    actorDepartmentId?: string;
    now: Date;
  }) {
    return transaction(pool, async (client) => {
      const tasks = await client.query<{ id: string }>(
        `select t.id from training_tasks t join training_plans p on p.id=t.plan_id
         join employees e on e.id=t.employee_id
         where t.plan_id=$1 and t.id=any($2::uuid[]) and t.status='in_progress'
           and p.status in ('published','in_progress') and p.start_at <= $6
           and $4::uuid=any(p.owner_employee_ids) and ($3='hr_admin' or e.department_id=$5::uuid)
         for update`,
        [
          input.planId,
          input.taskIds,
          input.actorRole,
          input.actorEmployeeId,
          input.actorDepartmentId ?? null,
          input.now,
        ],
      );
      if (tasks.rowCount !== new Set(input.taskIds).size || !tasks.rowCount) return false;
      await client.query(
        `insert into training_evidence
        (id,plan_id,storage_key,original_filename,mime_type,size_bytes,checksum,uploaded_by_account_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.evidence.id,
          input.planId,
          input.evidence.storageKey,
          input.evidence.originalFilename,
          input.evidence.mimeType,
          input.evidence.sizeBytes,
          input.evidence.checksum,
          input.actorAccountId,
        ],
      );
      for (const task of tasks.rows) {
        await client.query(
          "update training_tasks set status='confirmed',actual_completed_at=$2,confirmed_at=$2,updated_at=$2 where id=$1",
          [task.id, input.now],
        );
        await client.query(
          "insert into training_records (task_id,confirmed_by_account_id,confirmed_at) values ($1,$2,$3)",
          [task.id, input.actorAccountId, input.now],
        );
        await client.query(
          "insert into training_evidence_tasks (evidence_id,task_id) values ($1,$2)",
          [input.evidence.id, task.id],
        );
      }
      await audit(
        client,
        input.actorAccountId,
        "training_tasks.batch_confirmed",
        "training_plan",
        input.planId,
        { taskCount: tasks.rowCount, evidenceId: input.evidence.id },
      );
      return true;
    });
  },

  async getEvidence(input: {
    evidenceId: string;
    actorRole: string;
    employeeId: string;
    departmentId?: string;
  }) {
    const result = await pool.query<{
      storageKey: string;
      originalFilename: string;
      mimeType: string;
      checksum: string;
    }>(
      `select distinct ev.storage_key::text as "storageKey",ev.original_filename as "originalFilename",
        ev.mime_type as "mimeType",ev.checksum
       from training_evidence ev join training_evidence_tasks et on et.evidence_id=ev.id
       join training_tasks t on t.id=et.task_id join training_plans p on p.id=t.plan_id
       join employees e on e.id=t.employee_id
       where ev.id=$1 and ($2='hr_admin' or ($2='employee' and t.employee_id=$3)
         or ($2='department_manager' and (e.department_id=$4::uuid or p.owner_employee_id=$3)))
       limit 1`,
      [input.evidenceId, input.actorRole, input.employeeId, input.departmentId ?? null],
    );
    return result.rows[0];
  },
});

export type TrainingRepository = ReturnType<typeof createPostgresTrainingRepository>;
