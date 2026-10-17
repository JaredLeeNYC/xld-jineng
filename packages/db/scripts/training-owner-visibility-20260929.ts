import { strict as assert } from "node:assert";
import { Pool, type QueryResult } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  migrationsFolder,
  createPostgresTrainingRepository,
  createPostgresMaterialRepository,
  createPostgresOrganizationRepository,
} from "../src";
import { createTrainingService } from "../../../apps/server/src/training-service";
import { createOrganizationService } from "../../../apps/server/src/organization-service";
import { createApp } from "../../../apps/server/src/app";
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
  const coOwner = await employee("CO-OWNER", otherDepartment, "department_manager");
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
  let session: SessionView = owner;
  const app = createApp({
    authService: { getSession: async () => ({ ok: true, data: session }) },
    trainingService: service,
    organizationService: createOrganizationService({
      repository: createPostgresOrganizationRepository(pool),
      passwordHash: async () => "fixture",
      temporaryPassword: () => "fixture",
      idSource: () => crypto.randomUUID(),
      now: () => new Date(),
    }),
  } as never);
  const request = (path: string, method = "GET", body?: unknown) =>
    app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { cookie: "skill_matrix_session=qa", "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const review = async (id: string, action: "approve" | "reject", reason = "请补充培训安排") =>
    app.handle(
      new Request(`http://localhost/api/training-plans/${id}/${action}`, {
        method: "POST",
        headers: { cookie: "skill_matrix_session=qa", "content-type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      }),
    );
  const ids: string[] = [];
  for (const historicalCompleted of [false, true]) {
    const created = await service.createPlan(hr, {
      title: historicalCompleted ? "8月历史补录" : "10月未来计划",
      materialIds: [materialId],
      ownerEmployeeIds: [coOwner.employeeId, owner.employeeId],
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
    listed.data.find((p) => p.id === ids[0])?.estimatedParticipantCount,
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
  session = { ...stranger, factoryRead: true };
  for (const action of ["approve", "reject"] as const)
    assert.equal(
      (await review(ids[0]!, action)).status,
      409,
      "factory read is not approval permission",
    );
  session = { ...owner, role: "employee" };
  assert.equal((await review(ids[0]!, "approve")).status, 403, "ordinary employee cannot approve");
  session = owner;
  assert.equal(
    (await review(ids[0]!, "reject")).status,
    200,
    "designated owner can return a cross-department plan",
  );
  const returned = await pool.query(
    "select status,approval_comment from training_plans where id=$1",
    [ids[0]],
  );
  assert.equal(returned.rows[0].status, "draft");
  assert.equal(returned.rows[0].approval_comment, "请补充培训安排");
  assert((await service.submitPlan(hr, ids[0]!)).ok);
  // Existing pending plans use designation at review time; no recreation or migration.
  for (const id of ids) {
    const response = await review(id, "approve");
    assert.equal(response.status, 200, await response.text());
    assert.equal((await review(id, "approve")).status, 409, "repeat approval denied");
    const stored: QueryResult<{ status: string; approved_by_account_id: string }> =
      await pool.query("select status,approved_by_account_id from training_plans where id=$1", [
        id,
      ]);
    assert.equal(stored.rows[0].approved_by_account_id, owner.accountId);
    assert.equal(stored.rows[0].status, id === ids[0] ? "published" : "completed");
    assert.equal(
      (await pool.query("select count(*)::int as n from training_tasks where plan_id=$1", [id]))
        .rows[0].n,
      1,
    );
  }
  const targetPosition = (
    await pool.query<{ id: string }>(
      "insert into positions(code,name,department_id) values('TARGET-P','培训目标岗位',$1) returning id",
      [otherDepartment],
    )
  ).rows[0]!.id;
  await pool.query(
    "insert into position_assignments(employee_id,department_id,position_id,started_at,reason) values($1,$2,$3,'2026-01-01','验收任职')",
    [target.employeeId, otherDepartment, targetPosition],
  );
  const selectionResponse = await request("/training-plans/selection-options");
  assert.equal(selectionResponse.status, 200);
  const selection = (await selectionResponse.json()).data;
  assert(selection.departments.some((d: { id: string }) => d.id === otherDepartment));
  assert(selection.positions.some((p: { id: string }) => p.id === targetPosition));
  const selectedEmployee = selection.employees.find(
    (e: { id: string }) => e.id === target.employeeId,
  );
  assert.equal(selectedEmployee.departmentId, otherDepartment);
  assert.equal(selectedEmployee.positionId, targetPosition);
  assert.deepEqual(
    Object.keys(selectedEmployee).sort(),
    [
      "id",
      "displayName",
      "employeeNumber",
      "departmentId",
      "departmentName",
      "positionId",
      "role",
    ].sort(),
    "training options expose only selection metadata",
  );
  const organization = (await (await request("/organization/employees")).json()).data;
  assert(
    !organization.some((e: { id: string }) => e.id === target.employeeId),
    "training options must not expand general employee reads",
  );
  for (const role of ["employee", "executive_viewer", "system_admin"] as const) {
    session = { ...owner, role };
    assert.equal((await request("/training-plans/selection-options")).status, 403);
  }
  session = owner;
  for (const scopeType of ["employees", "department", "position"] as const) {
    const body = {
      title: `跨部门${scopeType}审批`,
      materialIds: [materialId],
      ownerEmployeeIds: [owner.employeeId, coOwner.employeeId],
      scopeType,
      scopeEmployeeIds: scopeType === "employees" ? [target.employeeId] : [],
      scopeDepartmentIds: scopeType === "department" ? [otherDepartment] : [],
      scopePositionIds: scopeType === "position" ? [targetPosition] : [],
      startAt: "2026-10-12T01:00:00Z",
      dueAt: "2026-10-12T03:00:00Z",
      location: "会议室",
    };
    const createdResponse = await request("/training-plans", "POST", body);
    assert.equal(createdResponse.status, 200, await createdResponse.clone().text());
    const created = await createdResponse.json();
    const edited = await request(`/training-plans/${created.data.id}`, "PATCH", {
      ...body,
      title: `${body.title}已修改`,
    });
    assert.equal(edited.status, 200, "manager can edit own cross-department draft");
    assert((await service.submitPlan(owner, created.data.id)).ok);
    for (const action of ["approve", "reject"] as const)
      assert.equal(
        (await review(created.data.id, action)).status,
        409,
        "creator/submitting owner cannot self review",
      );
    session = coOwner;
    assert.equal(
      (await review(created.data.id, "approve")).status,
      200,
      `${scopeType} scope owner approval`,
    );
    assert.equal(
      (
        await pool.query("select count(*)::int as n from training_tasks where plan_id=$1", [
          created.data.id,
        ])
      ).rows[0].n,
      scopeType === "department" ? 2 : 1,
    );
    session = owner;
  }
  const creatorPlan = crypto.randomUUID();
  await repo.createDraft({
    id: creatorPlan,
    actor: { ...owner, role: "department_manager" },
    title: "独立审批隔离",
    materialId,
    ownerEmployeeId: owner.employeeId,
    scopeType: "employees",
    scopeEmployeeIds: [target.employeeId],
    startAt: new Date("2026-10-12"),
    dueAt: new Date("2026-10-13"),
    location: "会议室",
  });
  assert((await service.submitPlan(hr, creatorPlan)).ok);
  for (const action of ["approve", "reject"] as const)
    assert.equal(
      (await review(creatorPlan, action)).status,
      409,
      "designated owner cannot review their own creation",
    );
  await pool.query(
    "update training_plans set created_by_account_id=$2,submitted_by_account_id=$3 where id=$1",
    [creatorPlan, hr.accountId, owner.accountId],
  );
  for (const action of ["approve", "reject"] as const)
    assert.equal(
      (await review(creatorPlan, action)).status,
      409,
      "designated owner cannot review their own submission",
    );
  session = hrReviewer;
  assert.equal(
    (await review(creatorPlan, "approve")).status,
    200,
    "independent HR remains available",
  );
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
    "PASS designated owner HTTP approval/return: existing future/history plans; non-first owner; unrelated factory reader and self-review denied; HR fallback; task scope unchanged",
  );
} finally {
  await pool?.end();
  await admin.query(`drop database if exists "${databaseName}"`);
  await admin.end();
}
