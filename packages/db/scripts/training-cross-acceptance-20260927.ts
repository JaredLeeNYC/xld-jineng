import { createPostgresTrainingAnalyticsRepository } from "../src/training-analytics-repository";
import { createTrainingAnalyticsService } from "../../../apps/server/src/training-analytics-service";
import { createTrainingService } from "../../../apps/server/src/training-service";
import { createMemoryMaterialStorage } from "../../../apps/server/src/material-storage";
import { createApp } from "../../../apps/server/src/app";
import type { SessionView } from "../../../apps/server/src/auth-contract";
import { strict as assert } from "node:assert";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  migrationsFolder,
  createPostgresOrganizationRepository,
  createPostgresTrainingRepository,
} from "../src";
const adminUrl =
  process.env.POSTGRES_CONTRACT_ADMIN_URL ??
  "postgres://skill_matrix:skill_matrix_dev@localhost:5433/postgres";
const databaseName = `skill_matrix_training_cross_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: adminUrl });
let pool: Pool | undefined;
try {
  await admin.query(`create database "${databaseName}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  pool = new Pool({ connectionString: url.toString() });
  await migrate(drizzle(pool), { migrationsFolder });
  const d1 = (
    await pool.query(`insert into departments(code,name) values ('A','部门A') returning id`)
  ).rows[0].id;
  const d2 = (
    await pool.query(`insert into departments(code,name) values ('B','部门B') returning id`)
  ).rows[0].id;
  const p1 = (
    await pool.query(
      `insert into positions(code,name,department_id) values ('P1','岗位A',$1) returning id`,
      [d1],
    )
  ).rows[0].id;
  const e1 = (
    await pool.query(
      `insert into employees(employee_number,display_name,department_id) values ('E1','员工A',$1) returning id`,
      [d1],
    )
  ).rows[0].id;
  const e2 = (
    await pool.query(
      `insert into employees(employee_number,display_name,department_id) values ('E2','员工B',$1) returning id`,
      [d1],
    )
  ).rows[0].id;
  const actor = (
    await pool.query(
      `insert into user_accounts(employee_id,password_hash,role) values ($1,'hash','hr_admin') returning id`,
      [e1],
    )
  ).rows[0].id;
  await pool.query(
    `insert into user_accounts(employee_id,password_hash,role) values ($1,'hash','employee')`,
    [e2],
  );
  await pool.query(
    `insert into position_assignments(employee_id,department_id,position_id,started_at,reason) values ($1,$2,$3,'2026-01-01','初始'),($4,$2,$3,'2026-01-01','初始')`,
    [e1, d1, p1, e2],
  );
  const org = createPostgresOrganizationRepository(pool);
  const repo = createPostgresTrainingRepository(pool);
  const analytics = createPostgresTrainingAnalyticsRepository(pool);
  const service = createTrainingAnalyticsService(analytics);
  const managerEmployee = (
    await pool.query(
      `insert into employees(employee_number,display_name,department_id) values ('M1','主管A',$1) returning id`,
      [d1],
    )
  ).rows[0].id;
  const managerAccount = (
    await pool.query(
      `insert into user_accounts(employee_id,password_hash,role) values ($1,'hash','department_manager') returning id`,
      [managerEmployee],
    )
  ).rows[0].id;
  const e3 = (
    await pool.query(
      `insert into employees(employee_number,display_name,department_id) values ('E3','员工C',$1) returning id`,
      [d2],
    )
  ).rows[0].id;
  const hr: SessionView = {
    accountId: actor,
    employeeId: e1,
    employeeNumber: "E1",
    displayName: "HR",
    departmentId: d1,
    role: "hr_admin",
    mustChangePassword: false,
  };
  const manager: SessionView = {
    ...hr,
    accountId: managerAccount,
    employeeId: managerEmployee,
    role: "department_manager",
  };
  const material = (
    await pool.query(
      `insert into training_materials(title,category,kind,external_url,created_by_account_id) values ('资料','测试','link','https://example.com',$1) returning id`,
      [actor],
    )
  ).rows[0].id;
  const base = {
    title: "跨部门计划",
    materialId: material,
    ownerEmployeeId: managerEmployee,
    startAt: new Date("2026-01-04T00:00:00Z"),
    dueAt: new Date("2026-01-04T02:00:00Z"),
    location: "培训室",
    scopeType: "department" as const,
    scopeDepartmentId: d1,
    scopeDepartmentIds: [d1, d2],
    scopeEmployeeIds: [],
    plannedHours: 2.5,
    actor: { accountId: actor, role: "hr_admin" as const },
  };
  const draft = crypto.randomUUID();
  await repo.createDraft({ ...base, id: draft });
  assert.equal(
    (await repo.listPlans(base.actor)).find((p) => p.id === draft)?.plannedHours,
    2.5,
    "plannedHours create/read",
  );
  await repo.updateDraft(draft, { ...base, plannedHours: 3.75 });
  assert.equal(
    (await repo.listPlans(base.actor)).find((p) => p.id === draft)?.plannedHours,
    3.75,
    "plannedHours update/read",
  );
  assert.equal(
    (await analytics.loadFacts(2026)).plans.find((p) => p.id === draft)?.participantCount,
    4,
    "draft all-department target count",
  );
  assert.equal(
    (await analytics.loadFacts(2026, d1)).plans.find((p) => p.id === draft)?.participantCount,
    3,
    "draft scoped target count",
  );
  const published = crypto.randomUUID();
  await repo.createDraft({ ...base, id: published, title: "已发布计划" });
  await pool.query(`update training_plans set status='published',published_at=now() where id=$1`, [
    published,
  ]);
  const task = (
    await pool.query(
      `insert into training_tasks(plan_id,employee_id,status,actual_completed_at) values ($1,$2,'confirmed','2026-02-01') returning id`,
      [published, e2],
    )
  ).rows[0].id;
  const outsideTask = (
    await pool.query(
      `insert into training_tasks(plan_id,employee_id,status,actual_completed_at) values ($1,$2,'confirmed','2026-02-02') returning id`,
      [published, e3],
    )
  ).rows[0].id;
  const incomplete = (
    await pool.query(
      `insert into training_tasks(plan_id,employee_id,status) values ($1,$2,'assigned') returning id`,
      [published, e1],
    )
  ).rows[0].id;
  assert.equal(
    (await analytics.loadFacts(2026)).plans.find((p) => p.id === published)?.participantCount,
    3,
    "published count uses tasks",
  );
  assert.equal(
    (await analytics.loadFacts(2026, d1)).plans.find((p) => p.id === published)?.participantCount,
    2,
    "published scoped count",
  );
  assert.equal(
    (await service.registerHours(manager, task, 1.25)).ok,
    true,
    "owner manager register",
  );
  assert.equal(
    (await service.registerHours({ ...manager, factoryRead: true }, outsideTask, 2)).ok,
    false,
    "factory read must not expand write",
  );
  assert.equal(
    (await service.registerHours({ ...manager, employeeId: e2 }, task, 2)).ok,
    false,
    "nonowner manager denied",
  );
  assert.equal(
    (await service.registerHours(hr, incomplete, 2)).ok,
    false,
    "incomplete task denied",
  );
  assert.equal(
    (await service.registerHours(hr, outsideTask, 2.5)).ok,
    true,
    "HR cross-department write",
  );
  assert.equal((await service.registerHours(hr, task, 1.5)).ok, true, "HR correction");
  const logs = (
    await pool.query(
      `select summary from audit_logs where action='training_task.hours_registered' and object_id=$1 order by id`,
      [task],
    )
  ).rows;
  assert.equal(logs.length, 2, "audit count");
  assert.deepEqual(
    logs[1].summary,
    { previousHours: 1.25, actualHours: 1.5 },
    "audit before after",
  );
  const scoped = await service.dashboard(manager, { year: 2026, departmentId: d2 });
  assert(scoped.ok);
  assert.equal(scoped.data.departmentId, d1);
  assert.equal(scoped.data.employeeCount, 3);
  assert.equal(scoped.data.months[1]?.actualPersonHours, 1.5);
  const expanded = await service.dashboard(
    { ...manager, factoryRead: true },
    { year: 2026, departmentId: d2 },
  );
  assert(expanded.ok);
  assert.equal(expanded.data.employeeCount, 1);
  assert.equal(expanded.data.months[1]?.actualPersonHours, 2.5);
  const options = await org.listDepartments();
  assert.equal(options.length, 2, "HR department options");
  const training = createTrainingService({
    repository: repo,
    storage: createMemoryMaterialStorage(),
    idSource: () => crypto.randomUUID(),
    now: () => new Date("2026-09-27"),
  });
  let session = hr;
  const app = createApp({
    authService: { getSession: async () => ({ ok: true, data: session }) },
    trainingService: training,
    trainingAnalyticsService: service,
  } as never);
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { cookie: "skill_matrix_session=qa", "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  assert.equal(
    (await request("/api/reports/training-analytics?year=2026")).status,
    200,
    "analytics HTTP",
  );
  assert.equal(
    (await request("/api/reports/training-analytics?year=bad")).status,
    422,
    "year schema",
  );
  assert.equal(
    (await request(`/api/training-tasks/${task}/hours`, "PUT", { actualHours: 1.75 })).status,
    200,
    "hours HTTP",
  );
  assert.equal(
    (await request(`/api/training-tasks/${task}/hours`, "PUT", { actualHours: 1.111 })).status,
    400,
    "precision validation",
  );
  const planBody = {
    ...base,
    actor: undefined,
    startAt: base.startAt.toISOString(),
    dueAt: base.dueAt.toISOString(),
    plannedHours: 4.25,
  };
  const created = await request("/api/training-plans", "POST", planBody);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const newId = created.body.data.id;
  assert.equal(
    (await repo.listPlans(base.actor)).find((p) => p.id === newId)?.plannedHours,
    4.25,
    "HTTP create persists plannedHours",
  );
  assert.equal(
    (await request(`/api/training-plans/${newId}`, "PATCH", { ...planBody, plannedHours: null }))
      .status,
    200,
  );
  assert.equal(
    (await repo.listPlans(base.actor)).find((p) => p.id === newId)?.plannedHours,
    null,
    "HTTP clears plannedHours",
  );
  session = { ...hr, role: "employee" };
  assert.equal(
    (await request("/api/reports/training-analytics?year=2026")).status,
    403,
    "employee denied report",
  );
  assert.equal(
    (await request(`/api/training-tasks/${task}/hours`, "PUT", { actualHours: 2 })).status,
    403,
    "employee denied write",
  );
  console.log(
    "培训交叉验收通过：草稿/发布人数、部门权限、负责人登记、审计、计划时数往返、HTTP校验。",
  );
} finally {
  await pool?.end();
  await admin.query(`drop database if exists "${databaseName}"`);
  await admin.end();
}
