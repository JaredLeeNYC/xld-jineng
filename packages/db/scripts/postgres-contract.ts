import { createApp } from "../../../apps/server/src/app";
import { createAuthService } from "../../../apps/server/src/auth-service";
import { createOrganizationService } from "../../../apps/server/src/organization-service";
import { createEmployeeImportWorkbook } from "../../../apps/server/src/organization-excel";
import { createSkillBaselineWorkbook } from "../../../apps/server/src/skill-excel";
import { createSkillService } from "../../../apps/server/src/skill-service";
import { createMaterialService } from "../../../apps/server/src/material-service";
import { createMemoryMaterialStorage } from "../../../apps/server/src/material-storage";
import {
  createDatabaseReadinessProbe,
  createPostgresAuthRepository,
  createPostgresOrganizationRepository,
  createPostgresSkillRepository,
  createPostgresMaterialRepository,
  migrationsFolder,
} from "../src";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client, Pool } from "pg";

const docker = (args: string[]) =>
  Bun.spawnSync({
    cmd: ["docker", "compose", ...args],
    stderr: "pipe",
    stdout: "pipe",
  });

const runningServices = docker(["ps", "--status", "running", "--services"]);
const postgresWasRunning =
  runningServices.success && runningServices.stdout.toString().split(/\r?\n/).includes("postgres");

if (!postgresWasRunning) {
  const started = docker(["up", "-d", "postgres"]);
  if (!started.success) {
    throw new Error(`无法启动 PostgreSQL 合同测试容器：${started.stderr.toString()}`);
  }
}

const adminUrl =
  process.env.POSTGRES_CONTRACT_ADMIN_URL ??
  "postgres://skill_matrix:skill_matrix_dev@localhost:5433/postgres";
const databaseName = `skill_matrix_contract_${process.pid}_${Date.now()}`;
let admin: Client | undefined;
let contractPool: Pool | undefined;

try {
  let lastConnectionError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = new Client({ connectionString: adminUrl });
    try {
      await candidate.connect();
      admin = candidate;
      lastConnectionError = undefined;
      break;
    } catch (error) {
      await candidate.end().catch(() => undefined);
      lastConnectionError = error;
      await Bun.sleep(500);
    }
  }
  if (lastConnectionError) {
    throw lastConnectionError;
  }

  await admin!.query(`create database "${databaseName}"`);
  const contractUrl = new URL(adminUrl);
  contractUrl.pathname = `/${databaseName}`;
  contractPool = new Pool({ connectionString: contractUrl.toString() });
  const contractDatabase = drizzle(contractPool);

  await migrate(contractDatabase, { migrationsFolder });
  await migrate(contractDatabase, { migrationsFolder });

  const tableResult = await contractPool.query(
    "select to_regclass('public.system_metadata') as table_name",
  );
  if (tableResult.rows[0]?.table_name !== "system_metadata") {
    throw new Error("空库迁移后缺少 system_metadata 表");
  }

  const readinessProbe = createDatabaseReadinessProbe({
    query: async (sql) => contractPool!.query(sql),
  });
  const readyResult = await readinessProbe();
  if (!readyResult.ok) {
    throw new Error(`迁移完成后数据库未就绪：${readyResult.reason}`);
  }

  const department = await contractPool.query<{ id: string }>(
    `insert into departments (code, name)
     values ('D001', '合同测试部门')
     returning id`,
  );
  const otherDepartment = await contractPool.query<{ id: string }>(
    `insert into departments (code, name)
     values ('D002', '其他合同测试部门')
     returning id`,
  );
  const otherEmployee = await contractPool.query<{ id: string }>(
    `insert into employees (
       employee_number, display_name, department_id
     ) values ('E0099', '其他部门员工', $1)
     returning id`,
    [otherDepartment.rows[0]!.id],
  );
  const roles = [
    ["E0001", "员工", "employee", true],
    ["M0001", "部门主管", "department_manager", false],
    ["H0001", "HR管理员", "hr_admin", false],
    ["V0001", "高层查看者", "executive_viewer", false],
    ["A0001", "系统管理员", "system_admin", false],
  ] as const;
  for (const [code, name] of [
    ["P001", "装配工"],
    ["P002", "机加工"],
    ["P003", "质量检验"],
  ]) {
    await contractPool.query(
      `insert into positions (code, name, department_id) values ($1, $2, $3) returning id`,
      [code, name, department.rows[0]!.id],
    );
  }
  const contractPassword = "Contract-Password-123";
  const passwordHash = await Bun.password.hash(contractPassword, {
    algorithm: "argon2id",
    memoryCost: 4_096,
    timeCost: 1,
  });
  const accountIds = new Map<string, string>();
  const employeeIds = new Map<string, string>();
  for (const [employeeNumber, displayName, role, mustChangePassword] of roles) {
    const employee = await contractPool.query<{ id: string }>(
      `insert into employees (
         employee_number, display_name, department_id
       ) values ($1, $2, $3)
       returning id`,
      [employeeNumber, displayName, department.rows[0]!.id],
    );
    employeeIds.set(role, employee.rows[0]!.id);
    const account = await contractPool.query<{ id: string }>(
      `insert into user_accounts (
         employee_id, password_hash, role, must_change_password
       ) values ($1, $2, $3, $4)
       returning id`,
      [employee.rows[0]!.id, passwordHash, role, mustChangePassword],
    );
    accountIds.set(role, account.rows[0]!.id);
  }
  for (const invalidEmployeeNumber of ["e0001", "E0001 "]) {
    let invalidEmployeeNumberRejected = false;
    try {
      await contractPool.query(
        `insert into employees (employee_number, display_name, department_id)
         values ($1, '非规范工号', $2)`,
        [invalidEmployeeNumber, department.rows[0]!.id],
      );
    } catch (error) {
      invalidEmployeeNumberRejected =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ["23505", "23514"].includes(String(error.code));
    }
    if (!invalidEmployeeNumberRejected) {
      throw new Error(`数据库未阻止非规范工号：${JSON.stringify(invalidEmployeeNumber)}`);
    }
  }

  const authService = createAuthService({
    repository: createPostgresAuthRepository(contractPool),
    password: {
      hash: (value) =>
        Bun.password.hash(value, {
          algorithm: "argon2id",
          memoryCost: 4_096,
          timeCost: 1,
        }),
      verify: (value, hash) => Bun.password.verify(value, hash),
    },
    digest: (value) => createHash("sha256").update(value).digest("hex"),
    now: () => new Date(),
    idSource: () => randomUUID(),
    tokenSource: () => randomBytes(32).toString("base64url"),
    dummyPasswordHash: passwordHash,
  });
  let temporarySequence = 0;
  const organizationRepository = createPostgresOrganizationRepository(contractPool);
  const organizationService = createOrganizationService({
    repository: organizationRepository,
    passwordHash: (value) =>
      Bun.password.hash(value, {
        algorithm: "argon2id",
        memoryCost: 4_096,
        timeCost: 1,
      }),
    temporaryPassword: () => `Contract-Temporary-${++temporarySequence}-Password`,
    idSource: () => randomUUID(),
    now: () => new Date(),
  });
  const skillService = createSkillService({
    repository: createPostgresSkillRepository(contractPool),
    idSource: () => randomUUID(),
    now: () => new Date(),
  });
  const materialRepository = createPostgresMaterialRepository(contractPool);
  const materialService = createMaterialService({
    repository: materialRepository,
    storage: createMemoryMaterialStorage(),
    idSource: () => randomUUID(),
  });
  const app = createApp({
    authService,
    organizationService,
    skillService,
    materialService,
    readinessProbe,
  });
  try {
    await authService.login({
      employeeNumber: "DEBUG-UNKNOWN",
      password: "wrong-password",
    });
  } catch (error) {
    throw new Error(`认证仓储失败：${String(error)}`, { cause: error });
  }
  const login = async (employeeNumber: string, password = contractPassword) => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeNumber, password }),
      }),
    );
    return {
      response,
      body: (await response.json()) as {
        ok: boolean;
        data?: { role: string; mustChangePassword: boolean };
        error?: { code: string; message: string };
      },
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };

  const wrongKnown = await login("E0001", "wrong-password");
  const wrongUnknown = await login("UNKNOWN", "wrong-password");
  if (
    wrongKnown.response.status !== 401 ||
    JSON.stringify(wrongKnown.body) !== JSON.stringify(wrongUnknown.body)
  ) {
    throw new Error(
      `错误密码与未知工号响应不一致：known=${wrongKnown.response.status}/${JSON.stringify(wrongKnown.body)} unknown=${wrongUnknown.response.status}/${JSON.stringify(wrongUnknown.body)}`,
    );
  }

  const roleLogins = new Map<string, Awaited<ReturnType<typeof login>>>();
  for (const [employeeNumber, _displayName, role] of roles) {
    const result = await login(employeeNumber);
    if (result.response.status !== 200 || result.body.data?.role !== role) {
      throw new Error(`${role} 工号登录失败`);
    }
    roleLogins.set(role, result);
  }

  const employeeLogin = roleLogins.get("employee")!;
  const changeResponse = await app.handle(
    new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: employeeLogin.cookie!,
      },
      body: JSON.stringify({
        currentPassword: contractPassword,
        newPassword: "Changed-Contract-Password-456",
      }),
    }),
  );
  const changedCookie = changeResponse.headers.get("set-cookie")?.split(";")[0];
  if (changeResponse.status !== 200 || !changedCookie) {
    throw new Error("首次改密或会话轮换失败");
  }
  const oldSessionResponse = await app.handle(
    new Request("http://localhost/api/auth/session", {
      headers: { cookie: employeeLogin.cookie! },
    }),
  );
  if (oldSessionResponse.status !== 401) {
    throw new Error("首次改密后旧会话仍然有效");
  }

  const profileStatus = async (cookie: string, employeeId: string) =>
    (
      await app.handle(
        new Request(`http://localhost/api/employees/${employeeId}/profile`, {
          headers: { cookie },
        }),
      )
    ).status;
  const scopedChecks = [
    ["employee own", await profileStatus(changedCookie, employeeIds.get("employee")!), 200],
    [
      "employee other",
      await profileStatus(changedCookie, employeeIds.get("department_manager")!),
      403,
    ],
    [
      "manager same department",
      await profileStatus(
        roleLogins.get("department_manager")!.cookie!,
        employeeIds.get("hr_admin")!,
      ),
      200,
    ],
    [
      "manager other department",
      await profileStatus(roleLogins.get("department_manager")!.cookie!, otherEmployee.rows[0]!.id),
      403,
    ],
    [
      "HR factory",
      await profileStatus(roleLogins.get("hr_admin")!.cookie!, otherEmployee.rows[0]!.id),
      200,
    ],
    [
      "executive read-only",
      await profileStatus(roleLogins.get("executive_viewer")!.cookie!, otherEmployee.rows[0]!.id),
      200,
    ],
  ] as const;
  for (const [label, actual, expected] of scopedChecks) {
    if (actual !== expected) {
      throw new Error(`${label} 范围检查失败：expected=${expected} actual=${actual}`);
    }
  }

  const accountListResponse = await app.handle(
    new Request("http://localhost/api/admin/accounts", {
      headers: { cookie: roleLogins.get("system_admin")!.cookie! },
    }),
  );
  const forbiddenAccountListResponse = await app.handle(
    new Request("http://localhost/api/admin/accounts", {
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  if (accountListResponse.status !== 200 || forbiddenAccountListResponse.status !== 403) {
    throw new Error("系统管理员账号列表权限检查失败");
  }

  for (const role of ["employee", "department_manager", "hr_admin", "executive_viewer"]) {
    const cookie = role === "employee" ? changedCookie : roleLogins.get(role)!.cookie!;
    const response = await app.handle(
      new Request(
        `http://localhost/api/admin/accounts/${accountIds.get("employee")}/reset-password`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            temporaryPassword: "Temporary-Contract-Password-999",
          }),
        },
      ),
    );
    if (response.status !== 403) {
      throw new Error(`${role} 越权重置密码未被拒绝`);
    }
  }

  const managerCookie = roleLogins.get("department_manager")!.cookie!;
  const concurrentChanges = await Promise.all(
    ["Concurrent-Contract-Password-111", "Concurrent-Contract-Password-222"].map((newPassword) =>
      app.handle(
        new Request("http://localhost/api/auth/change-password", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: managerCookie,
          },
          body: JSON.stringify({
            currentPassword: contractPassword,
            newPassword,
          }),
        }),
      ),
    ),
  );
  const concurrentStatuses = concurrentChanges.map((response) => response.status);
  if (
    concurrentStatuses.filter((status) => status === 200).length !== 1 ||
    concurrentStatuses.some((status) => ![200, 401, 409].includes(status))
  ) {
    throw new Error(`并发改密应仅有一个成功：${concurrentStatuses.join(",")}`);
  }
  const successfulConcurrentResponse = concurrentChanges.find(
    (response) => response.status === 200,
  )!;
  const successfulConcurrentCookie = successfulConcurrentResponse.headers
    .get("set-cookie")
    ?.split(";")[0];
  if (
    !successfulConcurrentCookie ||
    (
      await app.handle(
        new Request("http://localhost/api/auth/session", {
          headers: { cookie: successfulConcurrentCookie },
        }),
      )
    ).status !== 200
  ) {
    throw new Error("并发改密成功方返回的轮换会话无效");
  }

  const adminResetResponse = await app.handle(
    new Request(
      `http://localhost/api/admin/accounts/${accountIds.get("employee")}/reset-password`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: roleLogins.get("system_admin")!.cookie!,
        },
        body: JSON.stringify({
          temporaryPassword: "Temporary-Contract-Password-999",
        }),
      },
    ),
  );
  if (adminResetResponse.status !== 200) {
    throw new Error("系统管理员重置密码失败");
  }
  const resetSessionResponse = await app.handle(
    new Request("http://localhost/api/auth/session", {
      headers: { cookie: changedCookie },
    }),
  );
  if (resetSessionResponse.status !== 401) {
    throw new Error("管理员重置密码后旧会话仍然有效");
  }

  let finalLockStatus = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    finalLockStatus = (await login("LOCK-ME", "wrong-password")).response.status;
  }
  if (finalLockStatus !== 423) {
    throw new Error("连续失败未触发临时锁定");
  }

  const forbiddenEvents = await contractPool.query<{ count: number }>(
    "select count(*)::integer as count from security_events where type = 'forbidden'",
  );
  if ((forbiddenEvents.rows[0]?.count ?? 0) < 4) {
    throw new Error("越权拒绝未完整记录安全事件");
  }

  const employeeWorkbook = async (invalidLastRow: boolean) => {
    const rows = [];
    for (let index = 1; index <= 50; index += 1) {
      rows.push({
        employeeNumber: `E${String(1000 + index)}`,
        displayName: `样例员工${index}`,
        departmentCode: invalidLastRow && index === 50 ? "D999" : "D001",
        positionCode: `P00${((index - 1) % 3) + 1}`,
        hireDate: "2026-07-01",
        phone: `1380000${String(index).padStart(4, "0")}`,
      });
    }
    return createEmployeeImportWorkbook(rows);
  };
  const uploadPreview = async (invalidLastRow: boolean) => {
    const form = new FormData();
    form.set(
      "file",
      new File([await employeeWorkbook(invalidLastRow)], "employees.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const response = await app.handle(
      new Request("http://localhost/api/organization/employees/import/dry-run", {
        method: "POST",
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
        body: form,
      }),
    );
    return {
      response,
      body: (await response.json()) as {
        ok: boolean;
        data?: {
          previewId: string;
          totalRows: number;
          validRows: number;
          errors: Array<{ rowNumber: number; code: string }>;
        };
      },
    };
  };

  const invalidPreview = await uploadPreview(true);
  if (
    invalidPreview.response.status !== 200 ||
    invalidPreview.body.data?.totalRows !== 50 ||
    invalidPreview.body.data.validRows !== 49 ||
    invalidPreview.body.data.errors[0]?.code !== "INVALID_DEPARTMENT"
  ) {
    throw new Error(`50 人 Excel 错误预检失败：${JSON.stringify(invalidPreview.body)}`);
  }
  const blockedImport = await app.handle(
    new Request(
      `http://localhost/api/organization/employees/import/${invalidPreview.body.data.previewId}/confirm`,
      {
        method: "POST",
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      },
    ),
  );
  if (blockedImport.status !== 409) {
    throw new Error("含错误的 Excel 预检仍被正式导入");
  }

  const validPreview = await uploadPreview(false);
  if (
    validPreview.response.status !== 200 ||
    validPreview.body.data?.validRows !== 50 ||
    validPreview.body.data.errors.length !== 0
  ) {
    throw new Error(`修正后的 50 人 Excel 预检失败：${JSON.stringify(validPreview.body)}`);
  }
  const confirmResponse = await app.handle(
    new Request(
      `http://localhost/api/organization/employees/import/${validPreview.body.data.previewId}/confirm`,
      {
        method: "POST",
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      },
    ),
  );
  const confirmBody = (await confirmResponse.json()) as {
    ok: boolean;
    data?: {
      imported: number;
      credentials: Array<{ employeeNumber: string; temporaryPassword: string }>;
    };
  };
  if (
    confirmResponse.status !== 200 ||
    confirmBody.data?.imported !== 50 ||
    confirmBody.data.credentials.length !== 50
  ) {
    throw new Error(`50 人事务性正式导入失败：${JSON.stringify(confirmBody)}`);
  }
  const importedCounts = await contractPool.query<{
    employees: number;
    accounts: number;
    assignments: number;
  }>(
    `select
       (select count(*)::integer from employees where employee_number like 'E1%') as employees,
       (select count(*)::integer from user_accounts a join employees e on e.id = a.employee_id where e.employee_number like 'E1%') as accounts,
       (select count(*)::integer from position_assignments pa join employees e on e.id = pa.employee_id where e.employee_number like 'E1%' and pa.ended_at is null) as assignments`,
  );
  if (
    importedCounts.rows[0]?.employees !== 50 ||
    importedCounts.rows[0]?.accounts !== 50 ||
    importedCounts.rows[0]?.assignments !== 50
  ) {
    throw new Error(`组织导入留下半成功数据：${JSON.stringify(importedCounts.rows[0])}`);
  }

  const assignmentTarget = await contractPool.query<{
    employeeId: string;
    departmentId: string;
    positionId: string;
  }>(
    `select e.id as "employeeId", d.id as "departmentId", p.id as "positionId"
     from employees e
     join departments d on d.code = 'D001'
     join positions p on p.department_id = d.id and p.code = 'P002'
     where e.employee_number = 'E1001'`,
  );
  const assignment = assignmentTarget.rows[0]!;
  const validEffectiveAt = new Date().toISOString();
  const changeAssignmentResponse = await app.handle(
    new Request(`http://localhost/api/organization/employees/${assignment.employeeId}/assignment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: roleLogins.get("hr_admin")!.cookie!,
      },
      body: JSON.stringify({
        departmentId: assignment.departmentId,
        positionId: assignment.positionId,
        reason: "合同测试调岗",
        effectiveAt: validEffectiveAt,
      }),
    }),
  );
  if (changeAssignmentResponse.status !== 200) {
    throw new Error(`有效岗位变更失败：${await changeAssignmentResponse.text()}`);
  }
  const backdatedResponse = await app.handle(
    new Request(`http://localhost/api/organization/employees/${assignment.employeeId}/assignment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: roleLogins.get("hr_admin")!.cookie!,
      },
      body: JSON.stringify({
        departmentId: assignment.departmentId,
        positionId: assignment.positionId,
        reason: "倒签应拒绝",
        effectiveAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    }),
  );
  const assignmentCounts = await contractPool.query<{ total: number; current: number }>(
    `select count(*)::integer as total,
            count(*) filter (where ended_at is null)::integer as current
     from position_assignments where employee_id = $1`,
    [assignment.employeeId],
  );
  if (
    backdatedResponse.status !== 409 ||
    assignmentCounts.rows[0]?.total !== 2 ||
    assignmentCounts.rows[0]?.current !== 1
  ) {
    throw new Error(
      `岗位履历时间边界或唯一当前岗位失效：status=${backdatedResponse.status} counts=${JSON.stringify(assignmentCounts.rows[0])}`,
    );
  }

  const originalEmployeeDetails = await contractPool.query<{ hireDate: string; phone: string }>(
    `select hire_date::text as "hireDate", phone from employees where id = $1`,
    [assignment.employeeId],
  );
  const partialUpdateResponse = await app.handle(
    new Request(`http://localhost/api/organization/employees/${assignment.employeeId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: roleLogins.get("hr_admin")!.cookie!,
      },
      body: JSON.stringify({ displayName: "只改姓名" }),
    }),
  );
  const updatedEmployeeDetails = await contractPool.query<{ hireDate: string; phone: string }>(
    `select hire_date::text as "hireDate", phone from employees where id = $1`,
    [assignment.employeeId],
  );
  if (
    partialUpdateResponse.status !== 200 ||
    updatedEmployeeDetails.rows[0]?.hireDate !== originalEmployeeDetails.rows[0]?.hireDate ||
    updatedEmployeeDetails.rows[0]?.phone !== originalEmployeeDetails.rows[0]?.phone
  ) {
    throw new Error("员工部分更新意外清空入职日期或手机号");
  }

  const alternateDepartment = await contractPool.query<{ id: string }>(
    `insert into departments (code, name) values ('D099', '备用部门') returning id`,
  );
  const movedReferencedPosition = await organizationRepository.updatePosition({
    id: assignment.positionId,
    name: "机加工",
    departmentId: alternateDepartment.rows[0]!.id,
    actorAccountId: accountIds.get("hr_admin")!,
  });
  if (movedReferencedPosition) {
    throw new Error("已被任职履历引用的岗位仍可跨部门移动");
  }

  const createdSkills = new Map<string, string>();
  for (const definition of [
    {
      code: "S001",
      name: "设备点检",
      category: "professional",
      reassessmentRequired: true,
      validityMonths: 12,
    },
    { code: "S002", name: "安全作业", category: "core", reassessmentRequired: false },
    {
      code: "S003",
      name: "旧设备操作",
      category: "professional",
      reassessmentRequired: true,
      validityMonths: 1,
    },
    { code: "S004", name: "质量自检", category: "general", reassessmentRequired: false },
    { code: "S099", name: "待停用技能", category: "general", reassessmentRequired: false },
  ] as const) {
    const response = await app.handle(
      new Request("http://localhost/api/skills", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: roleLogins.get("hr_admin")!.cookie!,
        },
        body: JSON.stringify(definition),
      }),
    );
    const body = (await response.json()) as { data?: { id: string; code: string } };
    if (response.status !== 200 || !body.data)
      throw new Error(`创建技能失败：${JSON.stringify(body)}`);
    createdSkills.set(body.data.code, body.data.id);
  }
  const updateSkillResponse = await app.handle(
    new Request(`http://localhost/api/skills/${createdSkills.get("S004")}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: roleLogins.get("hr_admin")!.cookie!,
      },
      body: JSON.stringify({
        name: "质量自主检查",
        category: "general",
        reassessmentRequired: false,
      }),
    }),
  );
  const deactivateSkillResponse = await app.handle(
    new Request(`http://localhost/api/skills/${createdSkills.get("S099")}/deactivate`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  if (updateSkillResponse.status !== 200 || deactivateSkillResponse.status !== 200) {
    throw new Error("技能编辑或停用合同失败");
  }
  for (const [code, level] of [
    ["S001", 3],
    ["S002", 2],
    ["S003", 1],
    ["S004", 2],
  ] as const) {
    const response = await app.handle(
      new Request("http://localhost/api/position-skill-requirements", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: roleLogins.get("hr_admin")!.cookie!,
        },
        body: JSON.stringify({
          positionId: assignment.positionId,
          skillId: createdSkills.get(code),
          requiredLevel: level,
          required: code !== "S004",
        }),
      }),
    );
    if (response.status !== 200) throw new Error(`保存岗位技能要求失败：${await response.text()}`);
  }
  const copyPosition = await contractPool.query<{ id: string }>(
    "select id from positions where code = 'P003'",
  );
  const copyResponse = await app.handle(
    new Request("http://localhost/api/position-skill-requirements/copy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: roleLogins.get("hr_admin")!.cookie! },
      body: JSON.stringify({
        sourcePositionId: assignment.positionId,
        targetPositionId: copyPosition.rows[0]!.id,
        levelDelta: -1,
      }),
    }),
  );
  const copyBody = (await copyResponse.json()) as { data?: { copied: number } };
  if (copyResponse.status !== 200 || copyBody.data?.copied !== 4)
    throw new Error(`复制岗位技能要求失败：${JSON.stringify(copyBody)}`);

  const baselinePreview = async (
    rows: Array<{
      employeeNumber: string;
      skillCode: string;
      level: number;
      assessedAt: string;
      sourceReference: string;
    }>,
  ) => {
    const form = new FormData();
    form.set(
      "file",
      new File([await createSkillBaselineWorkbook(rows)], "skill-baseline.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const response = await app.handle(
      new Request("http://localhost/api/skill-baselines/import/dry-run", {
        method: "POST",
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
        body: form,
      }),
    );
    return {
      response,
      body: (await response.json()) as {
        data?: { previewId: string; validRows: number; errors: Array<{ code: string }> };
      },
    };
  };
  const invalidBaseline = await baselinePreview([
    {
      employeeNumber: "E1001",
      skillCode: "UNKNOWN",
      level: 5,
      assessedAt: "2026-02-30",
      sourceReference: "",
    },
  ]);
  if (
    invalidBaseline.response.status !== 200 ||
    invalidBaseline.body.data?.validRows !== 0 ||
    (invalidBaseline.body.data.errors.length ?? 0) < 3
  )
    throw new Error(`初始技能错误预检失败：${JSON.stringify(invalidBaseline.body)}`);
  const today = new Date().toISOString().slice(0, 10);
  const validBaseline = await baselinePreview([
    {
      employeeNumber: "E1001",
      skillCode: "S001",
      level: 2,
      assessedAt: today,
      sourceReference: "纸质档案 A-1",
    },
    {
      employeeNumber: "E1001",
      skillCode: "S003",
      level: 1,
      assessedAt: "2020-01-01",
      sourceReference: "历史证书 B-1",
    },
    {
      employeeNumber: "E1001",
      skillCode: "S004",
      level: 3,
      assessedAt: today,
      sourceReference: "纸质档案 C-1",
    },
  ]);
  if (
    validBaseline.response.status !== 200 ||
    validBaseline.body.data?.validRows !== 3 ||
    validBaseline.body.data.errors.length !== 0
  )
    throw new Error(`初始技能有效预检失败：${JSON.stringify(validBaseline.body)}`);
  const baselineConfirm = await app.handle(
    new Request(
      `http://localhost/api/skill-baselines/import/${validBaseline.body.data.previewId}/confirm`,
      { method: "POST", headers: { cookie: roleLogins.get("hr_admin")!.cookie! } },
    ),
  );
  if (baselineConfirm.status !== 200)
    throw new Error(`初始技能归档失败：${await baselineConfirm.text()}`);
  const matrixResponse = await app.handle(
    new Request("http://localhost/api/skill-matrix", {
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const matrixBody = (await matrixResponse.json()) as {
    data?: Array<{ employeeNumber: string; skillCode: string; status: string }>;
  };
  const firstEmployeeStatuses = new Map(
    matrixBody.data
      ?.filter((row) => row.employeeNumber === "E1001")
      .map((row) => [row.skillCode, row.status]),
  );
  if (
    matrixResponse.status !== 200 ||
    firstEmployeeStatuses.get("S001") !== "gap" ||
    firstEmployeeStatuses.get("S002") !== "unassessed" ||
    firstEmployeeStatuses.get("S003") !== "expired" ||
    firstEmployeeStatuses.get("S004") !== "met"
  )
    throw new Error(`技能矩阵边界计算失败：${JSON.stringify([...firstEmployeeStatuses])}`);
  const baselineCounts = await contractPool.query<{ assessments: number; current: number }>(
    `select (select count(*)::integer from skill_assessments where employee_id = $1 and status = 'archived' and passed = true) as assessments, (select count(*)::integer from employee_current_skills where employee_id = $1) as current`,
    [assignment.employeeId],
  );
  if (baselineCounts.rows[0]?.assessments !== 3 || baselineCounts.rows[0]?.current !== 3)
    throw new Error(`基线评定来源指针不一致：${JSON.stringify(baselineCounts.rows[0])}`);
  const baselineAssessment = await contractPool.query<{ id: string }>(
    `select a.id from skill_assessments a join skills s on s.id = a.skill_id
     where a.employee_id = $1 and s.code = 'S001'`,
    [assignment.employeeId],
  );
  let currentAssessmentInvalidationRejected = false;
  try {
    await contractPool.query(
      `update skill_assessments set status = 'voided', voided_at = now()
       where id = $1`,
      [baselineAssessment.rows[0]!.id],
    );
  } catch (error) {
    currentAssessmentInvalidationRejected =
      typeof error === "object" && error !== null && "code" in error && error.code === "23503";
  }
  const invalidAssessment = await contractPool.query<{ id: string }>(
    `insert into skill_assessments (
       employee_id, skill_id, level, status, passed, source_type,
       source_reference, assessed_at, archived_at
     ) values ($1, $2, 1, 'archived', false, 'contract_invalid', '不得成为当前技能', now(), now())
     returning id`,
    [assignment.employeeId, createdSkills.get("S002")],
  );
  let forgedValidMarkerRejected = false;
  try {
    await contractPool.query(
      `insert into valid_skill_assessments (assessment_id, employee_id, skill_id)
       values ($1, $2, $3)`,
      [invalidAssessment.rows[0]!.id, assignment.employeeId, createdSkills.get("S002")],
    );
  } catch (error) {
    forgedValidMarkerRejected =
      typeof error === "object" && error !== null && "code" in error && error.code === "23514";
  }
  let invalidAssessmentPointerRejected = false;
  try {
    await contractPool.query(
      `insert into employee_current_skills (employee_id, skill_id, assessment_id)
       values ($1, $2, $3)`,
      [assignment.employeeId, createdSkills.get("S002"), invalidAssessment.rows[0]!.id],
    );
  } catch (error) {
    invalidAssessmentPointerRejected =
      typeof error === "object" && error !== null && "code" in error && error.code === "23503";
  }
  if (
    !currentAssessmentInvalidationRejected ||
    !forgedValidMarkerRejected ||
    !invalidAssessmentPointerRejected
  ) {
    throw new Error("数据库未强制当前技能指向通过、归档且未作废的评定");
  }
  const concurrentEmployee = await contractPool.query<{ id: string }>(
    "select id from employees where employee_number = 'E1002'",
  );
  const concurrentAssessment = await contractPool.query<{ id: string }>(
    `insert into skill_assessments (
       employee_id, skill_id, level, status, passed, source_type,
       source_reference, assessed_at, archived_at
     ) values ($1, $2, 2, 'archived', true, 'contract_concurrency', '并发合同', now(), now())
     returning id`,
    [concurrentEmployee.rows[0]!.id, createdSkills.get("S001")],
  );
  const pointerClient = await contractPool.connect();
  const invalidationClient = await contractPool.connect();
  try {
    await pointerClient.query("begin");
    await invalidationClient.query("begin");
    await pointerClient.query(
      `insert into employee_current_skills (employee_id, skill_id, assessment_id)
       values ($1, $2, $3)`,
      [concurrentEmployee.rows[0]!.id, createdSkills.get("S001"), concurrentAssessment.rows[0]!.id],
    );
    let invalidationSettled = false;
    const invalidation = invalidationClient
      .query(`update skill_assessments set status = 'voided', voided_at = now() where id = $1`, [
        concurrentAssessment.rows[0]!.id,
      ])
      .then(() => {
        invalidationSettled = true;
        return undefined;
      })
      .catch((error: unknown) => {
        invalidationSettled = true;
        return error;
      });
    await Bun.sleep(50);
    if (invalidationSettled) throw new Error("评定作废未等待并发中的当前技能指针事务");
    await pointerClient.query("commit");
    const invalidationError = await invalidation;
    if (
      typeof invalidationError !== "object" ||
      invalidationError === null ||
      !("code" in invalidationError) ||
      invalidationError.code !== "23503"
    ) {
      throw new Error(`并发评定作废未被有效技能标记外键阻止：${String(invalidationError)}`);
    }
    await invalidationClient.query("rollback");
  } finally {
    await pointerClient.query("rollback").catch(() => undefined);
    await invalidationClient.query("rollback").catch(() => undefined);
    pointerClient.release();
    invalidationClient.release();
  }
  let mismatchedPointerRejected = false;
  try {
    await contractPool.query(
      `insert into employee_current_skills (employee_id, skill_id, assessment_id)
       values ($1, $2, $3)`,
      [assignment.employeeId, createdSkills.get("S002"), baselineAssessment.rows[0]!.id],
    );
  } catch (error) {
    mismatchedPointerRejected =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ["23503", "23505", "23514"].includes(String(error.code));
  }
  if (!mismatchedPointerRejected) throw new Error("数据库未阻止当前技能指向其他员工或技能的评定");

  const managerEmployees = await app.handle(
    new Request("http://localhost/api/organization/employees", {
      headers: { cookie: successfulConcurrentCookie },
    }),
  );
  const managerEmployeesBody = (await managerEmployees.json()) as {
    data?: Array<{ departmentId?: string }>;
  };
  if (
    managerEmployees.status !== 200 ||
    managerEmployeesBody.data?.some((employee) => employee.departmentId !== department.rows[0]!.id)
  ) {
    throw new Error(
      `部门主管读取到其他部门员工或请求失败：status=${managerEmployees.status} body=${JSON.stringify(managerEmployeesBody)}`,
    );
  }
  const managerMatrixResponse = await app.handle(
    new Request("http://localhost/api/skill-matrix", {
      headers: { cookie: successfulConcurrentCookie },
    }),
  );
  const managerMatrixBody = (await managerMatrixResponse.json()) as {
    data?: Array<{ departmentId: string }>;
  };
  if (
    managerMatrixResponse.status !== 200 ||
    managerMatrixBody.data?.some((row) => row.departmentId !== department.rows[0]!.id)
  ) {
    throw new Error("部门主管技能矩阵越出本部门范围");
  }

  const firstCredential = confirmBody.data.credentials[0]!;
  const importedLogin = await login(
    firstCredential.employeeNumber,
    firstCredential.temporaryPassword,
  );
  const importedChange = await app.handle(
    new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: importedLogin.cookie! },
      body: JSON.stringify({
        currentPassword: firstCredential.temporaryPassword,
        newPassword: "Imported-Employee-Password-456",
      }),
    }),
  );
  const importedCookie = importedChange.headers.get("set-cookie")?.split(";")[0];
  const importedSelfResponse = await app.handle(
    new Request("http://localhost/api/organization/employees", {
      headers: { cookie: importedCookie! },
    }),
  );
  const importedSelfBody = (await importedSelfResponse.json()) as {
    data?: Array<{ employeeNumber: string }>;
  };
  if (
    importedSelfResponse.status !== 200 ||
    importedSelfBody.data?.length !== 1 ||
    importedSelfBody.data[0]?.employeeNumber !== firstCredential.employeeNumber
  ) {
    throw new Error("员工组织查询未限制为本人");
  }
  const employeeMatrixResponse = await app.handle(
    new Request("http://localhost/api/skill-matrix", { headers: { cookie: importedCookie! } }),
  );
  const employeeMatrixBody = (await employeeMatrixResponse.json()) as {
    data?: Array<{ employeeNumber: string }>;
  };
  if (
    employeeMatrixResponse.status !== 200 ||
    employeeMatrixBody.data?.length !== 4 ||
    employeeMatrixBody.data.some((row) => row.employeeNumber !== firstCredential.employeeNumber)
  ) {
    throw new Error("员工技能矩阵未限制为本人岗位要求");
  }

  const exportResponse = await app.handle(
    new Request(
      "http://localhost/api/organization/employees/export.xlsx?active=true&query=%E5%90%88%E5%90%8C%E6%B5%8B%E8%AF%95%E9%83%A8%E9%97%A8",
      {
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      },
    ),
  );
  const exportedBytes = new Uint8Array(await exportResponse.arrayBuffer());
  const exportedText = new TextDecoder().decode(exportedBytes);
  const filteredEmployeesResponse = await app.handle(
    new Request(
      "http://localhost/api/organization/employees?active=true&query=%E5%90%88%E5%90%8C%E6%B5%8B%E8%AF%95%E9%83%A8%E9%97%A8",
      { headers: { cookie: roleLogins.get("hr_admin")!.cookie! } },
    ),
  );
  const filteredEmployeesBody = (await filteredEmployeesResponse.json()) as {
    data?: Array<{ employeeNumber: string }>;
  };
  if (
    exportResponse.status !== 200 ||
    !exportResponse.headers.get("content-type")?.includes("spreadsheetml") ||
    exportedBytes.length < 1_000 ||
    filteredEmployeesResponse.status !== 200 ||
    (filteredEmployeesBody.data?.length ?? 0) < 50 ||
    exportedText.includes(firstCredential.temporaryPassword)
  ) {
    throw new Error("组织人员 Excel 导出失败或泄露初始凭证");
  }
  const organizationAudit = await contractPool.query<{ count: number }>(
    `select count(*)::integer as count from audit_logs
     where action in ('employees.imported', 'employees.exported')`,
  );
  if ((organizationAudit.rows[0]?.count ?? 0) < 2) {
    throw new Error("组织导入与导出未写入审计日志");
  }
  const skillAudit = await contractPool.query<{ count: number }>(
    `select count(*)::integer as count from audit_logs
     where action in ('skill.created', 'position_skill_requirement.saved',
       'position_skill_requirements.copied', 'skill_baselines.imported')`,
  );
  if ((skillAudit.rows[0]?.count ?? 0) < 10) {
    throw new Error("技能、岗位要求、复制与基线归档未完整写入审计日志");
  }

  const materialSkill = await contractPool.query<{ id: string }>(
    "select id from skills where active = true order by code limit 1",
  );
  const materialForm = new FormData();
  materialForm.set("title", "设备点检培训");
  materialForm.set("category", "设备");
  materialForm.set("description", "合同测试附件");
  materialForm.set("skillIds", JSON.stringify([materialSkill.rows[0]!.id]));
  materialForm.set(
    "file",
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "点检.pdf", {
      type: "application/pdf",
    }),
  );
  const materialUploadResponse = await app.handle(
    new Request("http://localhost/api/training-materials/upload", {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      body: materialForm,
    }),
  );
  const materialUploadBody = (await materialUploadResponse.json()) as {
    data?: { id: string };
    error?: { message: string };
  };
  if (materialUploadResponse.status !== 200 || !materialUploadBody.data?.id) {
    throw new Error(
      `HR 培训资料上传失败：HTTP ${materialUploadResponse.status} ${materialUploadBody.error?.message ?? "unknown"}`,
    );
  }
  const storedMaterial = await contractPool.query<{
    storageKey: string;
    originalFilename: string;
    checksum: string;
  }>(
    `select storage_key as "storageKey", original_filename as "originalFilename", checksum
     from training_materials where id = $1`,
    [materialUploadBody.data.id],
  );
  if (
    storedMaterial.rows[0]?.storageKey.includes("点检") ||
    storedMaterial.rows[0]?.storageKey.includes("/") ||
    storedMaterial.rows[0]?.originalFilename !== "点检.pdf" ||
    storedMaterial.rows[0]?.checksum.length !== 64
  ) {
    throw new Error("培训资料数据库元数据或随机存储键不符合约束");
  }
  const employeeMaterialResponse = await app.handle(
    new Request(`http://localhost/api/training-materials/${materialUploadBody.data.id}/content`, {
      headers: { cookie: importedCookie! },
    }),
  );
  const systemMaterialResponse = await app.handle(
    new Request("http://localhost/api/training-materials", {
      headers: { cookie: roleLogins.get("system_admin")!.cookie! },
    }),
  );
  if (
    employeeMaterialResponse.status !== 200 ||
    !employeeMaterialResponse.headers.get("content-disposition")?.includes("UTF-8") ||
    systemMaterialResponse.status !== 403
  ) {
    throw new Error(
      `培训资料授权下载或五角色边界失败：employee=${employeeMaterialResponse.status}, disposition=${employeeMaterialResponse.headers.get("content-disposition")}, system=${systemMaterialResponse.status}`,
    );
  }
  const deactivateMaterialResponse = await app.handle(
    new Request(
      `http://localhost/api/training-materials/${materialUploadBody.data.id}/deactivate`,
      {
        method: "POST",
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      },
    ),
  );
  const inactiveMaterialResponse = await app.handle(
    new Request(`http://localhost/api/training-materials/${materialUploadBody.data.id}/content`, {
      headers: { cookie: importedCookie! },
    }),
  );
  if (deactivateMaterialResponse.status !== 200 || inactiveMaterialResponse.status !== 404) {
    throw new Error("停用培训资料仍可用于员工新访问");
  }
  const importedEmployee = await contractPool.query<{ id: string }>(
    "select id from employees where employee_number=$1",
    [firstCredential.employeeNumber],
  );
  if (
    !(await materialRepository.canRead({
      materialId: materialUploadBody.data.id,
      role: "employee",
      employeeId: importedEmployee.rows[0]!.id,
    })) ||
    (await materialRepository.canRead({
      materialId: materialUploadBody.data.id,
      role: "employee",
      employeeId: otherEmployee.rows[0]!.id,
    }))
  ) {
    throw new Error("员工培训资料未按当前岗位技能范围授权");
  }
  await materialRepository.grantHistoricalAccess({
    materialId: materialUploadBody.data.id,
    employeeId: importedEmployee.rows[0]!.id,
    sourceType: "training_assignment",
    sourceReference: "contract-history-001",
  });
  const historicalMaterialResponse = await app.handle(
    new Request(`http://localhost/api/training-materials/${materialUploadBody.data.id}/content`, {
      headers: { cookie: importedCookie! },
    }),
  );
  if (historicalMaterialResponse.status !== 200) {
    throw new Error("历史培训授权未保留停用资料的受控读取能力");
  }

  await contractPool.query(
    "update drizzle.__drizzle_migrations set hash = 'tampered' where id = (select max(id) from drizzle.__drizzle_migrations)",
  );
  const tamperedResult = await readinessProbe();
  if (tamperedResult.ok || tamperedResult.reason !== "migration-mismatch") {
    throw new Error("就绪探针未识别迁移 hash 不一致");
  }

  console.log(
    "PostgreSQL 空库、认证事务、五角色越权、50 人组织导入、技能基线与矩阵及迁移 hash 合同测试通过",
  );
} finally {
  if (contractPool) {
    await contractPool.end();
  }
  if (admin) {
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1", [
      databaseName,
    ]);
    await admin.query(`drop database if exists "${databaseName}"`);
    await admin.end();
  }
  if (!postgresWasRunning) {
    docker(["stop", "postgres"]);
  }
}
