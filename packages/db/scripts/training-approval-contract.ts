import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createPostgresTrainingRepository } from "../src/training-repository";

export async function verifyTrainingApproval(
  pool: Pool,
  input: {
    hrAccountId: string;
    managerAccountId: string;
    managerEmployeeId: string;
    departmentId: string;
    otherEmployeeId: string;
  },
) {
  const repository = createPostgresTrainingRepository(pool);
  const hr = { accountId: input.hrAccountId, role: "hr_admin" as const };
  const manager = {
    accountId: input.managerAccountId,
    role: "department_manager" as const,
    departmentId: input.departmentId,
  };
  const material = await pool.query<{ id: string }>(
    `insert into training_materials (title,category,kind,external_url,created_by_account_id)
     values ('HR无技能关联审批资料','安全','link','https://example.com/approval',$1) returning id`,
    [input.hrAccountId],
  );
  const materialId = material.rows[0]!.id;
  const now = new Date();
  const plan = {
    title: "HR补录主管审批回归",
    trainingType: "general" as const,
    historicalCompleted: true,
    materialId,
    ownerEmployeeId: input.managerEmployeeId,
    startAt: new Date(now.getTime() - 2 * 86_400_000),
    dueAt: new Date(now.getTime() - 86_400_000),
    location: "测试会议室",
    scopeType: "employees" as const,
    scopeEmployeeIds: [input.managerEmployeeId],
  };
  const createPending = async (overrides: Partial<typeof plan> = {}) => {
    const id = randomUUID();
    await repository.createDraft({ ...plan, ...overrides, id, actor: hr });
    if (!(await repository.submitPlan(id, hr, now))) throw new Error("回归计划提交失败");
    return id;
  };
  const assertPending = async (id: string) => {
    const stored = await pool.query(
      `select status,(select count(*)::int from training_tasks where plan_id=p.id) as tasks
       from training_plans p where id=$1`,
      [id],
    );
    if (stored.rows[0]?.status !== "pending_approval" || stored.rows[0]?.tasks !== 0)
      throw new Error("拒绝审批后不得改变计划或创建任务");
  };
  if (await repository.validateDraft(plan, manager))
    throw new Error("审批修复不得扩大主管新建计划的资料选择权限");
  const id = await createPending();
  if ((await repository.publish(id, hr, now)).ok) throw new Error("禁止HR自审批");
  await assertPending(id);
  const crossId = await createPending({ scopeEmployeeIds: [input.otherEmployeeId] });
  if ((await repository.publish(crossId, manager, now)).ok) throw new Error("禁止跨部门审批");
  await assertPending(crossId);
  const inactiveId = await createPending();
  await pool.query("update training_materials set active=false where id=$1", [materialId]);
  const inactive = await repository.publish(inactiveId, manager, now);
  if (inactive.ok || inactive.reason !== "material") throw new Error("停用资料不得审批");
  await assertPending(inactiveId);
  await pool.query("update training_materials set active=true,archived_at=now() where id=$1", [
    materialId,
  ]);
  if ((await repository.publish(inactiveId, manager, now)).ok) throw new Error("归档资料不得审批");
  await assertPending(inactiveId);
  await pool.query("update training_materials set archived_at=null where id=$1", [materialId]);
  const approved = await repository.publish(id, manager, now);
  if (!approved.ok || approved.status !== "completed")
    throw new Error(`HR无技能关联资料的本部门补录计划应允许主管审批：${JSON.stringify(approved)}`);
  const records = await pool.query(
    `select t.status,t.actual_start_at,t.actual_completed_at,r.confirmed_by_account_id
     from training_tasks t join training_records r on r.task_id=t.id where t.plan_id=$1`,
    [id],
  );
  if (
    records.rowCount !== 1 ||
    records.rows[0].status !== "confirmed" ||
    records.rows[0].confirmed_by_account_id !== input.managerAccountId ||
    records.rows[0].actual_start_at.getTime() !== plan.startAt.getTime() ||
    records.rows[0].actual_completed_at.getTime() !== plan.dueAt.getTime()
  )
    throw new Error("补录审批必须生成完整履历与实际起止时间");
  if ((await repository.publish(id, manager, now)).ok) throw new Error("禁止重复审批");
  console.log("培训审批回归通过：HR资料、部门范围、失效资料、独立审批与补录履历");
}
