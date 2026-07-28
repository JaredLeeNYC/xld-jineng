import { createApp } from "../../../apps/server/src/app";
import { createAuthService } from "../../../apps/server/src/auth-service";
import { createOrganizationService } from "../../../apps/server/src/organization-service";
import { createEmployeeImportWorkbook } from "../../../apps/server/src/organization-excel";
import { createSkillBaselineWorkbook } from "../../../apps/server/src/skill-excel";
import { createSkillService } from "../../../apps/server/src/skill-service";
import { createMaterialService } from "../../../apps/server/src/material-service";
import { createMemoryMaterialStorage } from "../../../apps/server/src/material-storage";
import { createTrainingService } from "../../../apps/server/src/training-service";
import { createAssessmentService } from "../../../apps/server/src/assessment-service";
import { createNotificationService } from "../../../apps/server/src/notification-service";
import { createReportService } from "../../../apps/server/src/report-service";
import { readReportWorkbookSummary } from "../../../apps/server/src/report-excel";
import { createAuditService } from "../../../apps/server/src/audit-service";
import {
  createDatabaseReadinessProbe,
  createPostgresAuthRepository,
  createPostgresOrganizationRepository,
  createPostgresSkillRepository,
  createPostgresMaterialRepository,
  createPostgresTrainingRepository,
  createPostgresAssessmentRepository,
  createPostgresNotificationRepository,
  createPostgresReportRepository,
  createPostgresAuditRepository,
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
  const skillRepository = createPostgresSkillRepository(contractPool);
  const skillService = createSkillService({
    repository: skillRepository,
    idSource: () => randomUUID(),
    now: () => new Date(),
  });
  const materialRepository = createPostgresMaterialRepository(contractPool);
  const contractStorage = createMemoryMaterialStorage();
  const materialService = createMaterialService({
    repository: materialRepository,
    storage: contractStorage,
    idSource: () => randomUUID(),
  });
  const trainingService = createTrainingService({
    repository: createPostgresTrainingRepository(contractPool),
    storage: contractStorage,
    idSource: () => randomUUID(),
    now: () => new Date(),
  });
  const assessmentService = createAssessmentService({
    repository: createPostgresAssessmentRepository(contractPool),
    storage: contractStorage,
    idSource: () => randomUUID(),
    now: () => new Date(),
  });
  const notificationRepository = createPostgresNotificationRepository(contractPool);
  const wecomAttempts: Array<{ url: string; body: string }> = [];
  let wecomShouldFail = false;
  const notificationService = createNotificationService({
    repository: notificationRepository,
    fetcher: async (input, init) => {
      wecomAttempts.push({
        url: input,
        body: typeof init?.body === "string" ? init.body : "",
      });
      return new Response(
        JSON.stringify(
          wecomShouldFail ? { errcode: 40001, errmsg: "invalid key" } : { errcode: 0 },
        ),
        { status: 200 },
      );
    },
    now: () => new Date(),
    idSource: () => randomUUID(),
  });
  const reportService = createReportService({
    repository: createPostgresReportRepository(contractPool, skillRepository),
    now: () => new Date(),
  });
  const auditService = createAuditService(createPostgresAuditRepository(contractPool));
  const app = createApp({
    authService,
    organizationService,
    skillService,
    materialService,
    trainingService,
    assessmentService,
    notificationService,
    reportService,
    auditService,
    readinessProbe,
  });
  await contractPool.query(
    `insert into webhook_channels (name,webhook_url,active,created_by_account_id)
     values ('合同预置群','https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1234567890-preconfigured',true,$1)`,
    [accountIds.get("system_admin")!],
  );
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
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "23503" || error.code === "23514");
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
    const invalidation = invalidationClient
      .query(`update skill_assessments set status = 'voided', voided_at = now() where id = $1`, [
        concurrentAssessment.rows[0]!.id,
      ])
      .then(() => undefined)
      .catch((error: unknown) => error);
    await Bun.sleep(50);
    await pointerClient.query("commit");
    const invalidationError = await invalidation;
    if (
      typeof invalidationError !== "object" ||
      invalidationError === null ||
      !("code" in invalidationError) ||
      (invalidationError.code !== "23503" && invalidationError.code !== "23514")
    ) {
      throw new Error(`并发评定作废未被数据库正式记录约束阻止：${String(invalidationError)}`);
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
  const importedEmployee = await contractPool.query<{ id: string }>(
    "select id from employees where employee_number=$1",
    [firstCredential.employeeNumber],
  );
  const planPayload = {
    title: "点检培训计划",
    materialId: materialUploadBody.data.id,
    ownerEmployeeId: employeeIds.get("department_manager")!,
    startAt: new Date(Date.now() - 60_000).toISOString(),
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    location: "一号会议室",
    scopeType: "employees",
    scopeEmployeeIds: [importedEmployee.rows[0]!.id],
  };
  const unrelatedSkill = await contractPool.query<{ id: string }>(
    "insert into skills (code,name,category) values ('CROSS_SCOPE','跨部门资料技能','professional') returning id",
  );
  const unrelatedMaterialResponse = await app.handle(
    new Request("http://localhost/api/training-materials/link", {
      method: "POST",
      headers: {
        cookie: roleLogins.get("hr_admin")!.cookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "其他部门资料",
        category: "隔离测试",
        externalUrl: "https://example.com/cross-scope",
        skillIds: [unrelatedSkill.rows[0]!.id],
      }),
    }),
  );
  const unrelatedMaterialBody = (await unrelatedMaterialResponse.json()) as {
    data?: { id: string };
  };
  const managerCrossScopePlan = await app.handle(
    new Request("http://localhost/api/training-plans", {
      method: "POST",
      headers: { cookie: successfulConcurrentCookie, "content-type": "application/json" },
      body: JSON.stringify({
        ...planPayload,
        materialId: unrelatedMaterialBody.data!.id,
        scopeType: "department",
        scopeDepartmentId: department.rows[0]!.id,
        scopeEmployeeIds: undefined,
      }),
    }),
  );
  if (unrelatedMaterialResponse.status !== 200 || managerCrossScopePlan.status !== 409)
    throw new Error("部门主管可绕过资料业务范围创建培训计划");
  const employeeCreatePlan = await app.handle(
    new Request("http://localhost/api/training-plans", {
      method: "POST",
      headers: { cookie: importedCookie!, "content-type": "application/json" },
      body: JSON.stringify(planPayload),
    }),
  );
  const createPlanResponse = await app.handle(
    new Request("http://localhost/api/training-plans", {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie!, "content-type": "application/json" },
      body: JSON.stringify(planPayload),
    }),
  );
  const createPlanBody = (await createPlanResponse.json()) as { data?: { id: string } };
  if (
    employeeCreatePlan.status !== 403 ||
    createPlanResponse.status !== 200 ||
    !createPlanBody.data?.id
  )
    throw new Error(
      `培训计划创建权限或草稿创建失败：employee=${employeeCreatePlan.status}, hr=${createPlanResponse.status}, body=${JSON.stringify(createPlanBody)}`,
    );
  const updatePlanResponse = await app.handle(
    new Request(`http://localhost/api/training-plans/${createPlanBody.data.id}`, {
      method: "PATCH",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie!, "content-type": "application/json" },
      body: JSON.stringify({ ...planPayload, location: "二号会议室" }),
    }),
  );
  const publishPlanResponse = await app.handle(
    new Request(`http://localhost/api/training-plans/${createPlanBody.data.id}/publish`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const republishResponse = await app.handle(
    new Request(`http://localhost/api/training-plans/${createPlanBody.data.id}/publish`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const task = await contractPool.query<{ id: string }>(
    "select id from training_tasks where plan_id=$1 and employee_id=$2",
    [createPlanBody.data.id, importedEmployee.rows[0]!.id],
  );
  if (
    updatePlanResponse.status !== 200 ||
    publishPlanResponse.status !== 200 ||
    republishResponse.status !== 409 ||
    task.rowCount !== 1
  )
    throw new Error("培训草稿编辑、发布固化或非法状态跳转失败");
  const submit = () =>
    app.handle(
      new Request(`http://localhost/api/training-tasks/${task.rows[0]!.id}/submit`, {
        method: "POST",
        headers: { cookie: importedCookie! },
      }),
    );
  const firstSubmit = await submit();
  const returnResponse = await app.handle(
    new Request(`http://localhost/api/training-tasks/${task.rows[0]!.id}/return`, {
      method: "POST",
      headers: {
        cookie: successfulConcurrentCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "请重新阅读安全章节" }),
    }),
  );
  const secondSubmit = await submit();
  const trainingConfirmResponse = await app.handle(
    new Request(`http://localhost/api/training-tasks/${task.rows[0]!.id}/confirm`, {
      method: "POST",
      headers: { cookie: successfulConcurrentCookie },
    }),
  );
  const trainingRecord = await contractPool.query(
    "select 1 from training_records where task_id=$1",
    [task.rows[0]!.id],
  );
  const cancelConfirmed = await app.handle(
    new Request(`http://localhost/api/training-plans/${createPlanBody.data.id}/cancel`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  if (
    firstSubmit.status !== 200 ||
    returnResponse.status !== 200 ||
    secondSubmit.status !== 200 ||
    trainingConfirmResponse.status !== 200 ||
    trainingRecord.rowCount !== 1 ||
    cancelConfirmed.status !== 409
  )
    throw new Error(
      `员工提交、退回重提、双确认或正式履历规则失败：${firstSubmit.status}/${returnResponse.status}/${secondSubmit.status}/${trainingConfirmResponse.status}/records=${trainingRecord.rowCount}/cancel=${cancelConfirmed.status}`,
    );
  let confirmedTaskMutationRejected = false;
  try {
    await contractPool.query("update training_tasks set status='returned' where id=$1", [
      task.rows[0]!.id,
    ]);
  } catch (error) {
    confirmedTaskMutationRejected =
      typeof error === "object" && error !== null && "code" in error && error.code === "23514";
  }
  if (!confirmedTaskMutationRejected) throw new Error("数据库未保护已形成正式履历的确认任务");

  const batchPlanResponse = await app.handle(
    new Request("http://localhost/api/training-plans", {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie!, "content-type": "application/json" },
      body: JSON.stringify({
        ...planPayload,
        title: "集中点检培训",
        scopeEmployeeIds: [importedEmployee.rows[0]!.id, employeeIds.get("department_manager")!],
      }),
    }),
  );
  const batchPlanBody = (await batchPlanResponse.json()) as { data?: { id: string } };
  await app.handle(
    new Request(`http://localhost/api/training-plans/${batchPlanBody.data!.id}/publish`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const batchTasks = await contractPool.query<{ id: string; employeeId: string }>(
    'select id,employee_id as "employeeId" from training_tasks where plan_id=$1 order by id',
    [batchPlanBody.data!.id],
  );
  const managerTask = batchTasks.rows.find(
    (row) => row.employeeId === employeeIds.get("department_manager"),
  )!;
  const managerSelfSubmit = await app.handle(
    new Request(`http://localhost/api/training-tasks/${managerTask.id}/submit`, {
      method: "POST",
      headers: { cookie: successfulConcurrentCookie },
    }),
  );
  const managerSelfConfirm = await app.handle(
    new Request(`http://localhost/api/training-tasks/${managerTask.id}/confirm`, {
      method: "POST",
      headers: { cookie: successfulConcurrentCookie },
    }),
  );
  if (managerSelfSubmit.status !== 200 || managerSelfConfirm.status !== 403)
    throw new Error("主管不能提交本人任务或可自行完成双确认");
  const attendance = new FormData();
  attendance.set("taskIds", JSON.stringify(batchTasks.rows.map((row) => row.id)));
  attendance.set(
    "file",
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1])], "签到.pdf", {
      type: "application/pdf",
    }),
  );
  const batchConfirmResponse = await app.handle(
    new Request(`http://localhost/api/training-plans/${batchPlanBody.data!.id}/batch-confirm`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      body: attendance,
    }),
  );
  const batchRecords = await contractPool.query<{ count: number }>(
    "select count(*)::int as count from training_records r join training_tasks t on t.id=r.task_id where t.plan_id=$1",
    [batchPlanBody.data!.id],
  );
  if (batchConfirmResponse.status !== 200 || batchRecords.rows[0]?.count !== 2)
    throw new Error("集中培训证据上传与批量确认失败");
  const evidence = await contractPool.query<{ id: string }>(
    "select id from training_evidence where plan_id=$1",
    [batchPlanBody.data!.id],
  );
  const evidenceStorage = await contractPool.query<{ storageKey: string }>(
    'select storage_key::text as "storageKey" from training_evidence where id=$1',
    [evidence.rows[0]!.id],
  );
  if (!(await materialRepository.storageKeys()).includes(evidenceStorage.rows[0]!.storageKey))
    throw new Error("孤儿清理引用集合遗漏正式培训证据");
  const employeeEvidenceResponse = await app.handle(
    new Request(`http://localhost/api/training-evidence/${evidence.rows[0]!.id}/content`, {
      headers: { cookie: importedCookie! },
    }),
  );
  const systemEvidenceResponse = await app.handle(
    new Request(`http://localhost/api/training-evidence/${evidence.rows[0]!.id}/content`, {
      headers: { cookie: roleLogins.get("system_admin")!.cookie! },
    }),
  );
  if (employeeEvidenceResponse.status !== 200 || systemEvidenceResponse.status !== 403)
    throw new Error("培训证据查看权限失败");

  const futurePlanResponse = await app.handle(
    new Request("http://localhost/api/training-plans", {
      method: "POST",
      headers: {
        cookie: roleLogins.get("hr_admin")!.cookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...planPayload,
        title: "未来集中培训",
        startAt: new Date(Date.now() + 86_400_000).toISOString(),
        dueAt: new Date(Date.now() + 172_800_000).toISOString(),
      }),
    }),
  );
  const futurePlanBody = (await futurePlanResponse.json()) as { data?: { id: string } };
  await app.handle(
    new Request(`http://localhost/api/training-plans/${futurePlanBody.data!.id}/publish`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const futureTasks = await contractPool.query<{ id: string }>(
    "select id from training_tasks where plan_id=$1",
    [futurePlanBody.data!.id],
  );
  const futureAttendance = new FormData();
  futureAttendance.set("taskIds", JSON.stringify(futureTasks.rows.map((row) => row.id)));
  futureAttendance.set(
    "file",
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1])], "未来签到.pdf", {
      type: "application/pdf",
    }),
  );
  const prematureBatch = await app.handle(
    new Request(`http://localhost/api/training-plans/${futurePlanBody.data!.id}/batch-confirm`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      body: futureAttendance,
    }),
  );
  if (prematureBatch.status !== 409) throw new Error("集中培训可在计划开始前形成正式履历");
  await app.handle(
    new Request(`http://localhost/api/training-plans/${futurePlanBody.data!.id}/cancel`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );

  const overduePlanResponse = await app.handle(
    new Request("http://localhost/api/training-plans", {
      method: "POST",
      headers: {
        cookie: roleLogins.get("hr_admin")!.cookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...planPayload,
        title: "逾期取消培训",
        materialId: unrelatedMaterialBody.data!.id,
        startAt: new Date(Date.now() - 172_800_000).toISOString(),
        dueAt: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    }),
  );
  const overduePlanBody = (await overduePlanResponse.json()) as { data?: { id: string } };
  await app.handle(
    new Request(`http://localhost/api/training-plans/${overduePlanBody.data!.id}/publish`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const overdueTasksResponse = await app.handle(
    new Request("http://localhost/api/training-tasks", {
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const overdueTasksBody = (await overdueTasksResponse.json()) as {
    data?: Array<{ planId: string; overdue: boolean }>;
  };
  const overdueTask = await contractPool.query<{ id: string }>(
    "select id from training_tasks where plan_id=$1",
    [overduePlanBody.data!.id],
  );
  let prematureRecordRejected = false;
  try {
    await contractPool.query(
      "insert into training_records (task_id,confirmed_by_account_id,confirmed_at) values ($1,$2,now())",
      [overdueTask.rows[0]!.id, accountIds.get("hr_admin")!],
    );
  } catch (error) {
    prematureRecordRejected =
      typeof error === "object" && error !== null && "code" in error && error.code === "23514";
  }
  if (!prematureRecordRejected) throw new Error("数据库允许未确认任务进入正式培训履历");
  const cancelOverdueResponse = await app.handle(
    new Request(`http://localhost/api/training-plans/${overduePlanBody.data!.id}/cancel`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const cancelledTask = await contractPool.query<{ status: string }>(
    "select status from training_tasks where plan_id=$1",
    [overduePlanBody.data!.id],
  );
  if (
    !overdueTasksBody.data?.some(
      (item) => item.planId === overduePlanBody.data!.id && item.overdue,
    ) ||
    cancelOverdueResponse.status !== 200 ||
    cancelledTask.rows[0]?.status !== "cancelled"
  )
    throw new Error("培训逾期计算、取消保留或状态排除失败");
  await app.handle(
    new Request(
      `http://localhost/api/training-materials/${unrelatedMaterialBody.data!.id}/deactivate`,
      {
        method: "POST",
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      },
    ),
  );
  const cancelledGrantContent = await app.handle(
    new Request(
      `http://localhost/api/training-materials/${unrelatedMaterialBody.data!.id}/content`,
      {
        headers: { cookie: importedCookie! },
      },
    ),
  );
  if (cancelledGrantContent.status !== 404) throw new Error("已取消培训仍保留停用资料的历史访问权");
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
  const managerInactiveMaterialResponse = await app.handle(
    new Request(`http://localhost/api/training-materials/${materialUploadBody.data.id}/content`, {
      headers: { cookie: successfulConcurrentCookie },
    }),
  );
  if (
    deactivateMaterialResponse.status !== 200 ||
    inactiveMaterialResponse.status !== 200 ||
    managerInactiveMaterialResponse.status !== 200
  ) {
    throw new Error("真实培训任务未为员工或主管本人保留停用资料的历史读取能力");
  }
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
  if (
    await materialRepository.hasHistoricalAccess(
      materialUploadBody.data.id,
      otherEmployee.rows[0]!.id,
    )
  )
    throw new Error("未分配培训的员工被授予历史资料访问权");

  await contractPool.query(
    `insert into employees (employee_number,display_name,department_id)
     values ('H0002','评定专员',$1)`,
    [assignment.departmentId],
  );
  await contractPool.query(
    `insert into user_accounts (employee_id,password_hash,role,must_change_password)
     select id,$1,'hr_admin',false from employees where employee_number='H0002'`,
    [passwordHash],
  );
  const evaluatorLogin = await login("H0002");
  if (!evaluatorLogin.cookie) throw new Error("独立评定人账号登录失败");
  const evaluatorCookie = evaluatorLogin.cookie;
  let directArchivedManualRejected = false;
  try {
    await contractPool.query(
      `insert into skill_assessments
        (employee_id,skill_id,level,status,passed,method,assessor_account_id,source_type,
         source_reference,assessed_at,archived_by_account_id,archived_at,evidence_storage_key,
         evidence_original_filename,evidence_mime_type,evidence_size_bytes,evidence_checksum)
       values ($1,$2,2,'archived',true,'practical',
         (select a.id from user_accounts a join employees e on e.id=a.employee_id where e.employee_number='H0002'),
         'manual_assessment','绕过流程',now(),$3,now(),gen_random_uuid(),'证据.pdf','application/pdf',5,$4)`,
      [
        assignment.employeeId,
        createdSkills.get("S001")!,
        accountIds.get("hr_admin")!,
        "0".repeat(64),
      ],
    );
  } catch (error) {
    directArchivedManualRejected =
      typeof error === "object" && error !== null && "code" in error && error.code === "23514";
  }
  if (!directArchivedManualRejected) throw new Error("数据库允许线下评定绕过三级流程直接归档");

  const createAssessment = async (input: {
    skillId: string;
    level: number;
    passed: boolean;
    reason?: string;
    replacesAssessmentId?: string;
    cookie?: string;
  }) => {
    const data = new FormData();
    data.set("employeeId", assignment.employeeId);
    data.set("skillId", input.skillId);
    data.set("method", "practical");
    data.set("level", String(input.level));
    data.set("passed", String(input.passed));
    data.set("assessedAt", new Date(Date.now() - 60_000).toISOString());
    if (input.reason) data.set("reason", input.reason);
    if (input.replacesAssessmentId) data.set("replacesAssessmentId", input.replacesAssessmentId);
    data.set(
      "file",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1])], "实操评定.pdf", {
        type: "application/pdf",
      }),
    );
    const response = await app.handle(
      new Request("http://localhost/api/assessments", {
        method: "POST",
        headers: { cookie: input.cookie ?? evaluatorCookie },
        body: data,
      }),
    );
    const body = (await response.json()) as { data?: { id: string } };
    if (response.status !== 200 || !body.data) throw new Error("技能评定草稿创建失败");
    return body.data.id;
  };
  const transitionAssessment = (id: string, action: string, cookie: string, body?: unknown) =>
    app.handle(
      new Request(`http://localhost/api/assessments/${id}/${action}`, {
        method: "POST",
        headers: {
          cookie,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );

  const passedAssessmentId = await createAssessment({
    skillId: createdSkills.get("S001")!,
    level: 3,
    passed: true,
  });
  const assessmentEvidence = await contractPool.query<{ storageKey: string }>(
    'select evidence_storage_key as "storageKey" from skill_assessments where id=$1',
    [passedAssessmentId],
  );
  if (!(await materialRepository.storageKeys()).includes(assessmentEvidence.rows[0]!.storageKey))
    throw new Error("孤儿清理引用集合遗漏技能评定证据");
  const assessmentSubmit = await transitionAssessment(
    passedAssessmentId,
    "submit",
    evaluatorCookie,
  );
  const assessmentReturn = await transitionAssessment(
    passedAssessmentId,
    "return",
    successfulConcurrentCookie,
    { reason: "补充整改建议" },
  );
  const assessmentRevise = await app.handle(
    new Request(`http://localhost/api/assessments/${passedAssessmentId}`, {
      method: "PUT",
      headers: {
        cookie: evaluatorCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        employeeId: assignment.employeeId,
        skillId: createdSkills.get("S001")!,
        method: "comprehensive",
        level: 3,
        passed: true,
        reason: "复核通过",
        remediation: "持续按标准点检",
        assessedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    }),
  );
  const assessmentResubmit = await transitionAssessment(
    passedAssessmentId,
    "submit",
    evaluatorCookie,
  );
  const crossDepartmentConfirm = await transitionAssessment(
    passedAssessmentId,
    "manager-confirm",
    roleLogins.get("hr_admin")!.cookie!,
  );
  const assessmentManagerConfirm = await transitionAssessment(
    passedAssessmentId,
    "manager-confirm",
    successfulConcurrentCookie,
  );
  const assessmentHrReturn = await transitionAssessment(
    passedAssessmentId,
    "return",
    roleLogins.get("hr_admin")!.cookie!,
    { reason: "HR 要求补充复核记录" },
  );
  const assessmentSecondRevise = await app.handle(
    new Request(`http://localhost/api/assessments/${passedAssessmentId}`, {
      method: "PUT",
      headers: {
        cookie: evaluatorCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        employeeId: assignment.employeeId,
        skillId: createdSkills.get("S001")!,
        method: "comprehensive",
        level: 3,
        passed: true,
        reason: "已补充 HR 复核记录",
        remediation: "持续按标准点检",
        assessedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    }),
  );
  const assessmentSecondResubmit = await transitionAssessment(
    passedAssessmentId,
    "submit",
    evaluatorCookie,
  );
  const assessmentSecondManagerConfirm = await transitionAssessment(
    passedAssessmentId,
    "manager-confirm",
    successfulConcurrentCookie,
  );
  const assessmentReminderVersions = await contractPool.query<{
    pendingManager: number;
    pendingHr: number;
  }>(
    `select
       count(distinct event_key) filter (where event_type='assessment_pending_manager')::int as "pendingManager",
       count(distinct event_key) filter (where event_type='assessment_pending_hr')::int as "pendingHr"
     from notification_outbox where event_key like $1`,
    [`%:${passedAssessmentId}:%`],
  );
  const evaluatorSelfArchive = await transitionAssessment(
    passedAssessmentId,
    "archive",
    evaluatorCookie,
  );
  const assessmentArchive = await transitionAssessment(
    passedAssessmentId,
    "archive",
    roleLogins.get("hr_admin")!.cookie!,
  );
  const currentPassedAssessment = await contractPool.query<{
    assessmentId: string;
    level: number;
    validUntil: Date | null;
  }>(
    `select cs.assessment_id as "assessmentId",a.level,a.valid_until as "validUntil"
     from employee_current_skills cs join skill_assessments a on a.id=cs.assessment_id
     where cs.employee_id=$1 and cs.skill_id=$2`,
    [assignment.employeeId, createdSkills.get("S001")!],
  );
  if (
    assessmentSubmit.status !== 200 ||
    assessmentReturn.status !== 200 ||
    assessmentRevise.status !== 200 ||
    assessmentResubmit.status !== 200 ||
    crossDepartmentConfirm.status !== 403 ||
    assessmentManagerConfirm.status !== 200 ||
    assessmentHrReturn.status !== 200 ||
    assessmentSecondRevise.status !== 200 ||
    assessmentSecondResubmit.status !== 200 ||
    assessmentSecondManagerConfirm.status !== 200 ||
    assessmentReminderVersions.rows[0]?.pendingManager !== 3 ||
    assessmentReminderVersions.rows[0]?.pendingHr !== 2 ||
    evaluatorSelfArchive.status !== 403 ||
    assessmentArchive.status !== 200 ||
    currentPassedAssessment.rows[0]?.assessmentId !== passedAssessmentId ||
    currentPassedAssessment.rows[0]?.level !== 3 ||
    !currentPassedAssessment.rows[0]?.validUntil
  )
    throw new Error("评定退回重提、三级确认、有效期或矩阵事务更新失败");

  const failedAssessmentId = await createAssessment({
    skillId: createdSkills.get("S002")!,
    level: 1,
    passed: false,
    reason: "实操不合格",
  });
  await transitionAssessment(failedAssessmentId, "submit", evaluatorCookie);
  await transitionAssessment(failedAssessmentId, "manager-confirm", successfulConcurrentCookie);
  const failedArchive = await transitionAssessment(
    failedAssessmentId,
    "archive",
    roleLogins.get("hr_admin")!.cookie!,
  );
  const failedCurrent = await contractPool.query(
    "select 1 from employee_current_skills where employee_id=$1 and skill_id=$2 and assessment_id=$3",
    [assignment.employeeId, createdSkills.get("S002")!, failedAssessmentId],
  );
  if (failedArchive.status !== 200 || failedCurrent.rowCount)
    throw new Error("未通过评定归档后错误授予了当前技能");
  let archivedMutationRejected = false;
  try {
    await contractPool.query(
      `update skill_assessments set status='voided',voided_by_account_id=$2,voided_at=now(),
         void_reason='测试作废',source_reference='夹带篡改'
       where id=$1`,
      [failedAssessmentId, accountIds.get("hr_admin")!],
    );
  } catch (error) {
    archivedMutationRejected =
      typeof error === "object" && error !== null && "code" in error && error.code === "23514";
  }
  const failedVoid = await transitionAssessment(
    failedAssessmentId,
    "void",
    roleLogins.get("hr_admin")!.cookie!,
    { reason: "失败记录录入有误" },
  );
  if (!archivedMutationRejected || failedVoid.status !== 200)
    throw new Error("正式评定可在作废时被篡改，或作废非当前记录发生冲突");

  const assessmentVoid = await transitionAssessment(
    passedAssessmentId,
    "void",
    roleLogins.get("hr_admin")!.cookie!,
    { reason: "等级录入错误" },
  );
  const restoredCurrent = await contractPool.query<{ assessmentId: string }>(
    `select assessment_id as "assessmentId" from employee_current_skills
     where employee_id=$1 and skill_id=$2`,
    [assignment.employeeId, createdSkills.get("S001")!],
  );
  if (
    assessmentVoid.status !== 200 ||
    !restoredCurrent.rows[0] ||
    restoredCurrent.rows[0].assessmentId === passedAssessmentId
  )
    throw new Error("作废正式评定未保留历史或恢复上一有效技能快照");

  const reassessmentId = await createAssessment({
    skillId: createdSkills.get("S001")!,
    level: 4,
    passed: true,
    replacesAssessmentId: passedAssessmentId,
  });
  await transitionAssessment(reassessmentId, "submit", evaluatorCookie);
  await transitionAssessment(reassessmentId, "manager-confirm", successfulConcurrentCookie);
  const concurrentArchives = await Promise.all([
    transitionAssessment(reassessmentId, "archive", roleLogins.get("hr_admin")!.cookie!),
    transitionAssessment(reassessmentId, "archive", roleLogins.get("hr_admin")!.cookie!),
  ]);
  const reassessmentCurrent = await contractPool.query<{ assessmentId: string }>(
    `select assessment_id as "assessmentId" from employee_current_skills
     where employee_id=$1 and skill_id=$2`,
    [assignment.employeeId, createdSkills.get("S001")!],
  );
  const evidenceForEmployee = await app.handle(
    new Request(`http://localhost/api/assessments/${reassessmentId}/evidence`, {
      headers: { cookie: importedCookie! },
    }),
  );
  const assessmentForSystem = await app.handle(
    new Request("http://localhost/api/assessments", {
      headers: { cookie: roleLogins.get("system_admin")!.cookie! },
    }),
  );
  if (
    concurrentArchives
      .map((response) => response.status)
      .sort((left, right) => left - right)
      .join(",") !== "200,409" ||
    reassessmentCurrent.rows[0]?.assessmentId !== reassessmentId ||
    evidenceForEmployee.status !== 200 ||
    assessmentForSystem.status !== 403
  )
    throw new Error("复评替换、并发重复归档、证据读取或角色边界失败");

  const managerAuthoredAssessmentId = await createAssessment({
    skillId: createdSkills.get("S004")!,
    level: 2,
    passed: true,
    cookie: successfulConcurrentCookie,
  });
  await transitionAssessment(managerAuthoredAssessmentId, "submit", successfulConcurrentCookie);
  const managerAssessmentSelfConfirm = await transitionAssessment(
    managerAuthoredAssessmentId,
    "manager-confirm",
    successfulConcurrentCookie,
  );
  if (managerAssessmentSelfConfirm.status !== 403) throw new Error("评定人可确认本人录入的评定");
  let formalAssessmentDeleteRejected = false;
  try {
    await contractPool.query("delete from skill_assessments where id=$1", [failedAssessmentId]);
  } catch (error) {
    formalAssessmentDeleteRejected =
      typeof error === "object" && error !== null && "code" in error && error.code === "23514";
  }
  if (!formalAssessmentDeleteRejected) throw new Error("数据库允许物理删除已作废正式评定");

  const invalidWebhook = await app.handle(
    new Request("http://localhost/api/admin/webhook-channels", {
      method: "POST",
      headers: {
        cookie: roleLogins.get("system_admin")!.cookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "不安全地址",
        webhookUrl: "http://127.0.0.1/internal",
        active: true,
      }),
    }),
  );
  const hrWebhookAccess = await app.handle(
    new Request("http://localhost/api/admin/webhook-channels", {
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const channelResponse = await app.handle(
    new Request("http://localhost/api/admin/webhook-channels", {
      method: "POST",
      headers: {
        cookie: roleLogins.get("system_admin")!.cookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "管理群",
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1234567890-contract-key",
        active: true,
      }),
    }),
  );
  const channelBody = (await channelResponse.json()) as { data?: { id: string } };
  const channelList = await app.handle(
    new Request("http://localhost/api/admin/webhook-channels", {
      headers: { cookie: roleLogins.get("system_admin")!.cookie! },
    }),
  );
  const channelListBody = (await channelList.json()) as {
    data?: Array<{ maskedUrl: string; webhookUrl?: string }>;
  };
  const emptyWebhookUpdate = await app.handle(
    new Request(`http://localhost/api/admin/webhook-channels/${channelBody.data!.id}`, {
      method: "PATCH",
      headers: {
        cookie: roleLogins.get("system_admin")!.cookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ webhookUrl: "" }),
    }),
  );
  if (
    invalidWebhook.status !== 400 ||
    hrWebhookAccess.status !== 403 ||
    channelResponse.status !== 200 ||
    emptyWebhookUpdate.status !== 400 ||
    channelListBody.data?.[0]?.webhookUrl ||
    !channelListBody.data?.[0]?.maskedUrl.includes("***")
  )
    throw new Error("企业微信 Webhook 安全校验、掩码或系统管理员边界失败");

  wecomShouldFail = true;
  const webhookTest = await app.handle(
    new Request(`http://localhost/api/admin/webhook-channels/${channelBody.data!.id}/test`, {
      method: "POST",
      headers: { cookie: roleLogins.get("system_admin")!.cookie! },
    }),
  );
  const failedDelivery = await contractPool.query<{ id: string; attempts: number; status: string }>(
    `select id,attempts,status from notification_outbox where event_type='webhook_test'
     order by created_at desc limit 1`,
  );
  wecomShouldFail = false;
  const retryDelivery = await app.handle(
    new Request(
      `http://localhost/api/admin/notification-deliveries/${failedDelivery.rows[0]!.id}/retry`,
      {
        method: "POST",
        headers: { cookie: roleLogins.get("system_admin")!.cookie! },
      },
    ),
  );
  const retriedDelivery = await contractPool.query<{ attempts: number; status: string }>(
    "select attempts,status from notification_outbox where id=$1",
    [failedDelivery.rows[0]!.id],
  );
  if (
    webhookTest.status !== 409 ||
    failedDelivery.rows[0]?.status !== "failed" ||
    failedDelivery.rows[0]?.attempts !== 1 ||
    retryDelivery.status !== 200 ||
    retriedDelivery.rows[0]?.status !== "sent" ||
    retriedDelivery.rows[0]?.attempts !== 2
  )
    throw new Error("企业微信非零错误码、失败记录或人工重试失败");
  const claimProbeId = await notificationRepository.enqueueTest(
    channelBody.data!.id,
    `claim_probe:${randomUUID()}`,
  );
  if (!claimProbeId) throw new Error("无法创建并发领取探针");
  const firstClaim = await notificationRepository.claim(new Date(), claimProbeId);
  const duplicateClaim = await notificationRepository.claim(new Date(), claimProbeId);
  if (!firstClaim || duplicateClaim) throw new Error("通知 outbox 可被并发重复领取");
  const staleReclaim = await notificationRepository.claim(
    new Date(Date.now() + 6 * 60_000),
    claimProbeId,
  );
  if (!staleReclaim) throw new Error("过期通知租约无法恢复");
  await notificationRepository.complete(
    claimProbeId,
    staleReclaim.leaseToken,
    { success: true },
    new Date(),
  );
  await notificationRepository.complete(
    claimProbeId,
    firstClaim.leaseToken,
    { success: false, error: "旧 worker 延迟失败" },
    new Date(),
  );
  const leaseResult = await contractPool.query<{ status: string }>(
    "select status from notification_outbox where id=$1",
    [claimProbeId],
  );
  if (leaseResult.rows[0]?.status !== "sent") throw new Error("旧通知租约覆盖了新租约结果");
  let deliveryDeleteRejected = false;
  try {
    await contractPool.query("delete from notification_outbox where id=$1", [claimProbeId]);
  } catch (error) {
    deliveryDeleteRejected =
      typeof error === "object" && error !== null && "code" in error && error.code === "23514";
  }
  if (!deliveryDeleteRejected) throw new Error("数据库允许物理删除通知发送记录");
  const cappedId = await notificationRepository.enqueueTest(
    channelBody.data!.id,
    `retry_cap:${randomUUID()}`,
  );
  if (!cappedId) throw new Error("无法创建重试上限探针");
  await contractPool.query(
    "update notification_outbox set status='failed',attempts=5,next_attempt_at=now() where id=$1",
    [cappedId],
  );
  const automaticAfterCap = await notificationRepository.claim(new Date(), cappedId);
  const manualRetryAccepted = await notificationRepository.retry(
    cappedId,
    accountIds.get("system_admin")!,
  );
  const manualClaim = await notificationRepository.claim(new Date(), cappedId);
  if (automaticAfterCap || !manualRetryAccepted || !manualClaim)
    throw new Error("永久错误未停止自动重试，或人工重试无法恢复");
  await notificationRepository.complete(
    cappedId,
    manualClaim.leaseToken,
    { success: true },
    new Date(),
  );

  const notificationAssessmentId = await createAssessment({
    skillId: createdSkills.get("S003")!,
    level: 2,
    passed: true,
  });
  await transitionAssessment(notificationAssessmentId, "submit", evaluatorCookie);
  wecomShouldFail = true;
  await notificationService.runScheduled();
  const pendingAssessment = await contractPool.query<{ status: string }>(
    "select status from skill_assessments where id=$1",
    [notificationAssessmentId],
  );
  const firstOutboxCount = await contractPool.query<{ count: number }>(
    "select count(*)::int as count from notification_outbox",
  );
  await notificationService.runScheduled();
  const secondOutboxCount = await contractPool.query<{ count: number }>(
    "select count(*)::int as count from notification_outbox",
  );
  const employeeNotifications = await app.handle(
    new Request("http://localhost/api/notifications", { headers: { cookie: importedCookie! } }),
  );
  const employeeNotificationsBody = (await employeeNotifications.json()) as {
    data?: Array<{ type: string }>;
  };
  const trainingPendingOutbox = await contractPool.query(
    "select 1 from notification_outbox where event_type='training_pending_confirmation' limit 1",
  );
  if (
    pendingAssessment.rows[0]?.status !== "pending_manager" ||
    firstOutboxCount.rows[0]?.count !== secondOutboxCount.rows[0]?.count ||
    !employeeNotificationsBody.data?.some((item) => item.type === "assessment_archived") ||
    !trainingPendingOutbox.rowCount ||
    wecomAttempts.some((attempt) => attempt.url.includes("127.0.0.1"))
  )
    throw new Error("通知 outbox 故障隔离、扫描去重或站内通知失败");
  const maximumReasonReturn = await transitionAssessment(
    notificationAssessmentId,
    "return",
    successfulConcurrentCookie,
    { reason: "退".repeat(500) },
  );
  if (maximumReasonReturn.status !== 200) throw new Error("合法的 500 字退回原因被通知写入回滚");

  const reportQuery = "status=met&sortBy=skillCode&sortOrder=desc";
  const managerReportResponse = await app.handle(
    new Request(`http://localhost/api/reports/dashboard?${reportQuery}`, {
      headers: { cookie: successfulConcurrentCookie },
    }),
  );
  const managerReport = (await managerReportResponse.json()) as {
    data?: {
      metrics: {
        positionSkillCompliance: { numerator: number; denominator: number; rate: number | null };
      };
      rows: Array<{ departmentId: string; skillCode: string; status: string }>;
    };
  };
  const employeeReport = await app.handle(
    new Request("http://localhost/api/reports/dashboard", { headers: { cookie: importedCookie! } }),
  );
  const executiveReport = await app.handle(
    new Request("http://localhost/api/reports/dashboard", {
      headers: { cookie: roleLogins.get("executive_viewer")!.cookie! },
    }),
  );
  const reportExport = await app.handle(
    new Request(`http://localhost/api/reports/export.xlsx?${reportQuery}`, {
      headers: { cookie: successfulConcurrentCookie },
    }),
  );
  const reportWorkbook = await readReportWorkbookSummary(await reportExport.arrayBuffer());
  const rows = managerReport.data?.rows ?? [];
  const sortedSkillCodes = rows
    .map((row) => row.skillCode)
    .sort((a, b) => b.localeCompare(a, "zh-CN"));
  if (
    managerReportResponse.status !== 200 ||
    employeeReport.status !== 403 ||
    executiveReport.status !== 200 ||
    rows.some((row) => row.departmentId !== assignment.departmentId || row.status !== "met") ||
    JSON.stringify(rows.map((row) => row.skillCode)) !== JSON.stringify(sortedSkillCodes) ||
    reportExport.status !== 200 ||
    !reportExport.headers.get("content-type")?.includes("spreadsheetml") ||
    reportWorkbook.matrixRowCount !== rows.length ||
    reportWorkbook.positionSkillNumerator !==
      managerReport.data?.metrics.positionSkillCompliance.numerator ||
    reportWorkbook.positionSkillDenominator !==
      managerReport.data?.metrics.positionSkillCompliance.denominator
  )
    throw new Error(
      `Dashboard 权限、筛选排序或 Excel 同口径合同失败：${JSON.stringify({
        managerStatus: managerReportResponse.status,
        employeeStatus: employeeReport.status,
        executiveStatus: executiveReport.status,
        departments: [...new Set(rows.map((row) => row.departmentId))],
        expectedDepartment: assignment.departmentId,
        statuses: [...new Set(rows.map((row) => row.status))],
        skillCodes: rows.map((row) => row.skillCode),
        sortedSkillCodes,
        exportStatus: reportExport.status,
        exportType: reportExport.headers.get("content-type"),
        workbook: reportWorkbook,
        metric: managerReport.data?.metrics.positionSkillCompliance,
      })}`,
    );
  const reportAudit = await contractPool.query(
    "select 1 from audit_logs where action='reports.exported' limit 1",
  );
  if (!reportAudit.rowCount) throw new Error("报表导出未写入审计日志");

  await contractPool.query(
    `insert into audit_logs (actor_account_id,action,object_type,object_id,summary)
     values ($1,'contract.sensitive_probe','contract','probe',$2)`,
    [
      accountIds.get("system_admin")!,
      {
        password: "must-not-leak",
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=must-not-leak",
        safe: "visible",
      },
    ],
  );
  const auditResponse = await app.handle(
    new Request("http://localhost/api/admin/audit?limit=500", {
      headers: { cookie: roleLogins.get("system_admin")!.cookie! },
    }),
  );
  const auditBody = (await auditResponse.json()) as {
    data?: Array<{ action: string; summary: Record<string, unknown> }>;
  };
  const deniedAudit = await app.handle(
    new Request("http://localhost/api/admin/audit", {
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const auditActions = new Set(auditBody.data?.map((row) => row.action));
  const sensitiveProbe = auditBody.data?.find((row) => row.action === "contract.sensitive_probe");
  for (const expectedAction of [
    "employee.assignment_changed",
    "training_plan.published",
    "training_task.confirmed",
    "skill_assessment.archived",
    "skill_assessment.voided",
    "reports.exported",
    "notification_delivery.retried",
  ]) {
    if (!auditActions.has(expectedAction))
      throw new Error(`审计查询缺少关键动作：${expectedAction}`);
  }
  if (
    auditResponse.status !== 200 ||
    deniedAudit.status !== 403 ||
    sensitiveProbe?.summary.password !== "[已脱敏]" ||
    sensitiveProbe.summary.webhookUrl !== "[已脱敏]" ||
    sensitiveProbe.summary.safe !== "visible" ||
    JSON.stringify(auditBody).includes("must-not-leak")
  )
    throw new Error("审计权限或敏感摘要脱敏失败");

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
