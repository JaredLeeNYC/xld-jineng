import { strict as assert } from "node:assert";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  migrationsFolder,
  createPostgresTrainingRepository,
  createPostgresMaterialRepository,
} from "../src";
import { createTrainingService } from "../../../apps/server/src/training-service";
import { createMemoryMaterialStorage } from "../../../apps/server/src/material-storage";
import type { SessionView } from "../../../apps/server/src/auth-contract";
const adminUrl =
  process.env.POSTGRES_CONTRACT_ADMIN_URL ??
  "postgres://skill_matrix:skill_matrix_dev@localhost:5433/postgres";
const databaseName = `skill_matrix_owner_visibility_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: adminUrl });
let pool: Pool | undefined;
try {
  await admin.query(`create database "${databaseName}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  pool = new Pool({ connectionString: url.toString() });
  await migrate(drizzle(pool), { migrationsFolder });
  const dept = async (code: string) =>
    (await pool!.query("insert into departments(code,name) values($1,$1) returning id", [code]))
      .rows[0].id as string;
  const ownDepartment = await dept("OWNER");
  const otherDepartment = await dept("TARGET");
  const employee = async <R extends SessionView["role"]>(
    number: string,
    departmentId: string,
    role: R,
  ): Promise<SessionView & { role: R }> => {
    const employeeId = (
      await pool!.query(
        "insert into employees(employee_number,display_name,department_id) values($1,$1,$2) returning id",
        [number, departmentId],
      )
    ).rows[0].id as string;
    const accountId = (
      await pool!.query(
        "insert into user_accounts(employee_id,password_hash,role) values($1,'fixture',$2) returning id",
        [employeeId, role],
      )
    ).rows[0].id as string;
    return {
      employeeId,
      accountId,
      departmentId,
      role,
      employeeNumber: number,
      displayName: number,
      mustChangePassword: false,
    };
  };
  const hr = await employee("HR", ownDepartment, "hr_admin");
  const hrReviewer = await employee("HR2", ownDepartment, "hr_admin");
  const owner = await employee("10001", ownDepartment, "department_manager");
  const stranger = await employee("OTHER-MGR", ownDepartment, "department_manager");
  const target = await employee("TARGET", otherDepartment, "employee");
  const materialId = (
    await pool.query(
      "insert into training_materials(title,category,kind,external_url,created_by_account_id) values('资料','测试','link','https://example.com',$1) returning id",
      [hr.accountId],
    )
  ).rows[0].id as string;
  const repo = createPostgresTrainingRepository(pool);
  const service = createTrainingService({
    repository: repo,
    storage: createMemoryMaterialStorage(),
    idSource: () => crypto.randomUUID(),
    now: () => new Date("2026-09-29T08:00:00Z"),
  });
  const ids: string[] = [];
  for (const historicalCompleted of [false, true]) {
    const created = await service.createPlan(hr, {
      title: historicalCompleted ? "8月历史补录" : "10月未来计划",
      materialIds: [materialId],
      ownerEmployeeIds: [owner.employeeId],
      scopeType: "employees",
      scopeEmployeeIds: [target.employeeId],
      location: "会议室",
      startAt: historicalCompleted ? "2026-08-20T01:00:00Z" : "2026-10-12T01:00:00Z",
      dueAt: historicalCompleted ? "2026-08-20T03:00:00Z" : "2026-10-12T03:00:00Z",
      historicalCompleted,
    });
    assert(created.ok);
    ids.push(created.data.id);
    assert((await service.submitPlan(hr, created.data.id)).ok);
  }
  const listed = await service.listPlans(owner);
  assert(listed.ok);
  for (const id of ids)
    assert(
      listed.data.some((p) => p.id === id && p.status === "pending_approval"),
      "designated owner must see HR submitted pending plan even when all targets are outside owner department",
    );
  assert.equal(
    (listed.data[0] as (typeof listed.data)[0] & { estimatedParticipantCount?: number })
      .estimatedParticipantCount,
    1,
    "owner sees full pre-publication participant count",
  );
  const materials = createPostgresMaterialRepository(pool);
  assert(
    await materials.canRead({ ...owner, materialId }),
    "pending owner can preview linked material",
  );
  assert(
    !(await materials.canRead({ ...stranger, materialId })),
    "owner material read does not leak to unrelated manager",
  );
  for (const id of ids) {
    assert.equal(
      await repo.cancelPlan(id, owner, new Date()),
      false,
      "owner read cannot cancel HR plan",
    );
    assert.equal(
      await repo.withdrawPlan(id, owner, new Date()),
      false,
      "owner read cannot withdraw HR plan",
    );
  }
  const hidden = await service.listPlans(stranger);
  assert(hidden.ok);
  assert(!hidden.data.some((p) => ids.includes(p.id)), "unrelated manager cannot see plan");
  for (const id of ids) {
    const approval = await service.approvePlan(owner, id);
    assert(!approval.ok, "owner read grant must not authorize cross-department approval");
    assert((await service.approvePlan(hrReviewer, id)).ok, "independent HR can approve");
  }
  const ownTasks = await service.listTasks(owner);
  assert(ownTasks.ok);
  assert(
    !ownTasks.data.some((t) => t.employeeId === target.employeeId),
    "cross-department tasks remain outside manager list",
  );
  const tasks = await service.listTasks(hr);
  assert(tasks.ok);
  const futureTask = tasks.data.find((t) => t.planId === ids[0])!;
  assert(futureTask);
  assert.equal(
    await repo.executeTask(futureTask.id, owner.employeeId, owner.accountId, new Date(), false),
    false,
    "direct task operation outside department denied",
  );
  console.log(
    "PASS owner pending visibility: future/history; unrelated manager denied; owner approval and task scope preserved; HR approval succeeds",
  );
} finally {
  await pool?.end();
  await admin.query(`drop database if exists "${databaseName}"`);
  await admin.end();
}
