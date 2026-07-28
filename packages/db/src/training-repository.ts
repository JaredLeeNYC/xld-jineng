import type {
  TrainingPlanStatus,
  TrainingPlanView,
  TrainingScopeType,
  TrainingTaskView,
} from "@jineng/skill-matrix-shared";
import type { Pool, PoolClient } from "pg";

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
  title: string;
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

const planSelect = `select p.id,p.title,p.status,p.material_id as "materialId",m.title as "materialTitle",
  p.owner_employee_id as "ownerEmployeeId",owner.display_name as "ownerName",
  p.start_at as "startAt",p.due_at as "dueAt",p.location,p.scope_type as "scopeType",
  p.scope_department_id as "scopeDepartmentId",p.scope_position_id as "scopePositionId",
  coalesce(array_agg(distinct pse.employee_id) filter (where pse.active=true),'{}') as "scopeEmployeeIds",
  count(distinct t.id)::int as "taskCount",
  count(distinct r.id)::int as "confirmedCount",p.created_at as "createdAt"
 from training_plans p join training_materials m on m.id=p.material_id
 join employees owner on owner.id=p.owner_employee_id
 left join training_plan_scope_employees pse on pse.plan_id=p.id
 left join training_tasks t on t.plan_id=p.id and t.status <> 'cancelled'
 left join training_records r on r.task_id=t.id`;

const taskSelect = `select t.id,t.plan_id as "planId",p.title as "planTitle",t.employee_id as "employeeId",
  e.display_name as "employeeName",e.employee_number as "employeeNumber",p.material_id as "materialId",
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
  ...(row.submittedAt ? { submittedAt: new Date(row.submittedAt).toISOString() } : {}),
  ...(row.confirmedAt ? { confirmedAt: new Date(row.confirmedAt).toISOString() } : {}),
  ...(row.returnReason ? { returnReason: row.returnReason } : {}),
});

export const createPostgresTrainingRepository = (pool: Pool) => ({
  async advanceStatuses(now: Date) {
    await transaction(pool, async (client) => {
      await client.query(
        "update training_plans set status='in_progress',updated_at=$1 where status='published' and start_at <= $1",
        [now],
      );
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
       where ($1='hr_admin' or p.created_by_account_id=$2
         or exists (select 1 from training_tasks visible_t join employees visible_e on visible_e.id=visible_t.employee_id
           where visible_t.plan_id=p.id and visible_e.department_id=$3::uuid))
       group by p.id,m.title,owner.display_name order by p.created_at desc`,
      [actor.role, actor.accountId, actor.departmentId ?? null],
    );
    return result.rows.map(normalizePlan);
  },

  async validateDraft(input: PlanInput, actor: ActorScope) {
    const material = await pool.query(
      `select 1 from training_materials m where m.id=$1 and m.active=true and
       ($2='hr_admin' or exists (
         select 1 from training_material_skills ms
         join position_skill_requirements psr on psr.skill_id=ms.skill_id
         join position_assignments pa on pa.position_id=psr.position_id and pa.ended_at is null
         where ms.material_id=m.id and ms.active=true and pa.department_id=$3::uuid
       ))`,
      [input.materialId, actor.role, actor.departmentId ?? null],
    );
    const owner = await pool.query<{ departmentId?: string }>(
      'select department_id as "departmentId" from employees where id=$1 and active=true',
      [input.ownerEmployeeId],
    );
    if (!material.rowCount || !owner.rowCount) return false;
    if (actor.role === "department_manager" && owner.rows[0]?.departmentId !== actor.departmentId)
      return false;
    if (input.scopeType === "department") {
      const scope = await pool.query("select 1 from departments where id=$1 and active=true", [
        input.scopeDepartmentId,
      ]);
      if (
        !scope.rowCount ||
        (actor.role === "department_manager" && input.scopeDepartmentId !== actor.departmentId)
      )
        return false;
    }
    if (input.scopeType === "position") {
      const scope = await pool.query<{ departmentId: string }>(
        'select department_id as "departmentId" from positions where id=$1 and active=true',
        [input.scopePositionId],
      );
      if (
        !scope.rowCount ||
        (actor.role === "department_manager" && scope.rows[0]?.departmentId !== actor.departmentId)
      )
        return false;
    }
    if (input.scopeType === "employees") {
      const employees = await pool.query<{ count: number }>(
        `select count(*)::int as count from employees where id=any($1::uuid[]) and active=true
         and ($2::uuid is null or department_id=$2::uuid)`,
        [input.scopeEmployeeIds, actor.role === "department_manager" ? actor.departmentId : null],
      );
      if (
        input.scopeEmployeeIds.length === 0 ||
        employees.rows[0]?.count !== new Set(input.scopeEmployeeIds).size
      )
        return false;
    }
    return true;
  },

  async createDraft(input: PlanInput & { id: string; actor: ActorScope }) {
    return transaction(pool, async (client) => {
      await client.query(
        `insert into training_plans (id,title,material_id,owner_employee_id,start_at,due_at,location,
          scope_type,scope_department_id,scope_position_id,created_by_account_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
          location=$7,scope_type=$8,scope_department_id=$9,scope_position_id=$10,updated_at=now()
         where id=$1 and status='draft' and ($11='hr_admin' or created_by_account_id=$12) returning id`,
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
        ],
      );
      if (!result.rowCount) return false;
      await client.query(
        "update training_plan_scope_employees set active=false,updated_at=now() where plan_id=$1 and active=true",
        [id],
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

  async publish(id: string, actor: ActorScope, now: Date) {
    return transaction(pool, async (client) => {
      const plan = await client.query<any>(
        `select * from training_plans where id=$1 and status='draft'
         and ($2='hr_admin' or created_by_account_id=$3) for update`,
        [id, actor.role, actor.accountId],
      );
      const row = plan.rows[0];
      if (!row) return { ok: false as const, reason: "state" as const };
      const material = await client.query(
        `select 1 from training_materials m where m.id=$1 and m.active=true and
         ($2='hr_admin' or exists (
           select 1 from training_material_skills ms
           join position_skill_requirements psr on psr.skill_id=ms.skill_id
           join position_assignments pa on pa.position_id=psr.position_id and pa.ended_at is null
           where ms.material_id=m.id and ms.active=true and pa.department_id=$3::uuid
         ))`,
        [row.material_id, actor.role, actor.departmentId ?? null],
      );
      if (!material.rowCount) return { ok: false as const, reason: "material" as const };
      let employees;
      if (row.scope_type === "department")
        employees = await client.query<{ id: string; departmentId: string }>(
          'select id,department_id as "departmentId" from employees where active=true and department_id=$1',
          [row.scope_department_id],
        );
      else if (row.scope_type === "position")
        employees = await client.query<{ id: string; departmentId: string }>(
          `select e.id,e.department_id as "departmentId" from employees e join position_assignments pa on pa.employee_id=e.id and pa.ended_at is null where e.active=true and pa.position_id=$1`,
          [row.scope_position_id],
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
      for (const employee of employees.rows) {
        const task = await client.query<{ id: string }>(
          "insert into training_tasks (plan_id,employee_id) values ($1,$2) returning id",
          [id, employee.id],
        );
        await client.query(
          `insert into training_material_access_grants
          (material_id,employee_id,source_type,source_reference) values ($1,$2,'training_task',$3)`,
          [row.material_id, employee.id, task.rows[0]!.id],
        );
      }
      const status: TrainingPlanStatus =
        new Date(row.start_at) <= now ? "in_progress" : "published";
      await client.query(
        "update training_plans set status=$2,published_at=$3,updated_at=$3 where id=$1",
        [id, status, now],
      );
      await audit(client, actor.accountId, "training_plan.published", "training_plan", id, {
        taskCount: employees.rowCount,
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
       where ($2='hr_admin' or ($2='employee' and t.employee_id=$3)
         or ($2='department_manager' and (e.department_id=$4::uuid or p.owner_employee_id=$3)))
       group by t.id,p.id,m.title,e.display_name,e.employee_number,owner.display_name
       order by p.due_at,t.created_at`,
      [input.now, input.actorRole, input.employeeId, input.departmentId ?? null],
    );
    return result.rows.map(normalizeTask);
  },

  async submitTask(taskId: string, employeeId: string, now: Date, actorAccountId: string) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        `update training_tasks t set status='submitted',submitted_at=$3,returned_at=null,return_reason=null,updated_at=$3
         from training_plans p where t.id=$1 and t.employee_id=$2 and p.id=t.plan_id
           and p.status in ('published','in_progress') and p.start_at <= $3
           and t.status in ('assigned','returned') returning t.id`,
        [taskId, employeeId, now],
      );
      if (!result.rowCount) return false;
      await audit(client, actorAccountId, "training_task.submitted", "training_task", taskId);
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
      const result = await client.query(
        "update training_tasks set status='returned',returned_at=$2,return_reason=$3,updated_at=$2 where id=$1 and status='submitted' returning id",
        [taskId, now, reason],
      );
      if (!result.rowCount) return false;
      await audit(client, actorAccountId, "training_task.returned", "training_task", taskId, {
        reason,
      });
      return true;
    });
  },

  async cancelPlan(id: string, actor: ActorScope, now: Date) {
    return transaction(pool, async (client) => {
      const plan = await client.query(
        `select id from training_plans where id=$1 and status in ('draft','published','in_progress')
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
         where t.plan_id=$1 and t.id=any($2::uuid[]) and t.status in ('assigned','submitted','returned')
           and p.status in ('published','in_progress') and p.start_at <= $6
           and ($3='hr_admin' or p.owner_employee_id=$4::uuid or e.department_id=$5::uuid)
           and t.employee_id<>$4::uuid
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
          "update training_tasks set status='confirmed',confirmed_at=$2,updated_at=$2 where id=$1",
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
