import { grantReviewedFactoryRead } from "../src/reviewed-factory-access";
import { verifyTrainingApproval } from "./training-approval-contract";
import { createApp } from "../../../apps/server/src/app";
import { createAuthService } from "../../../apps/server/src/auth-service";
import { createOrganizationService } from "../../../apps/server/src/organization-service";
import { createEmployeeImportWorkbook } from "../../../apps/server/src/organization-excel";
import { createSkillBaselineWorkbook } from "../../../apps/server/src/skill-excel";
import { createSkillService } from "../../../apps/server/src/skill-service";
import { createMaterialService } from "../../../apps/server/src/material-service";
import { createMemoryMaterialStorage } from "../../../apps/server/src/material-storage";
import { createTrainingService } from "../../../apps/server/src/training-service";
import { createTrainingExamService } from "../../../apps/server/src/training-exam-service";
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
  createPostgresTrainingExamRepository,
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
    trainingExamService: createTrainingExamService({
      repository: createPostgresTrainingExamRepository(contractPool),
      now: () => new Date(),
    }),
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

  const independentHrEmployee = await contractPool.query<{ id: string }>(
    "insert into employees(employee_number,display_name,department_id) values ('HRQA','独立审批HR',$1) returning id",
    [department.rows[0]!.id],
  );
  await contractPool.query(
    "insert into user_accounts(employee_id,password_hash,role,must_change_password) values ($1,$2,'hr_admin',false)",
    [independentHrEmployee.rows[0]!.id, passwordHash],
  );
  const independentHrCookie = (await login("HRQA")).cookie!;
  const approveTraining = async (id: string) => {
    const submitted = await app.handle(
      new Request(`http://localhost/api/training-plans/${id}/submit`, {
        method: "POST",
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      }),
    );
    if (submitted.status !== 200)
      throw new Error(`培训计划提交审批失败 ${submitted.status}: ${await submitted.text()}`);
    const selfApproved = await app.handle(
      new Request(`http://localhost/api/training-plans/${id}/approve`, {
        method: "POST",
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      }),
    );
    if (selfApproved.status !== 409) throw new Error("培训计划允许自审批");
    return app.handle(
      new Request(`http://localhost/api/training-plans/${id}/approve`, {
        method: "POST",
        headers: { cookie: independentHrCookie },
      }),
    );
  };
  const executeTraining = (id: string, action: "start" | "complete", cookie: string) =>
    app.handle(
      new Request(`http://localhost/api/training-tasks/${id}/${action}`, {
        method: "POST",
        headers: { cookie },
      }),
    );
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
    trainingType: "general",
    title: "点检培训计划",
    materialId: materialUploadBody.data.id,
    ownerEmployeeId: employeeIds.get("department_manager")!,
    // Historical plans must support the same approval and completion workflow.
    startAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    dueAt: new Date(Date.now() - 86_400_000).toISOString(),
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
    throw new Error("主管不应引用超出资料读取/使用范围的材料UUID");
  const ownUnlinkedMaterialResponse = await app.handle(
    new Request("http://localhost/api/training-materials/link", {
      method: "POST",
      headers: { cookie: successfulConcurrentCookie, "content-type": "application/json" },
      body: JSON.stringify({
        title: "主管创建无关联技能资料",
        trainingType: "safety",
        category: "安全",
        externalUrl: "https://example.com/own-safety",
        skillIds: [],
      }),
    }),
  );
  const ownUnlinkedMaterial = await ownUnlinkedMaterialResponse.json();
  const ownUnlinkedPlan = await app.handle(
    new Request("http://localhost/api/training-plans", {
      method: "POST",
      headers: { cookie: successfulConcurrentCookie, "content-type": "application/json" },
      body: JSON.stringify({ ...planPayload, materialId: ownUnlinkedMaterial.data.id }),
    }),
  );
  if (ownUnlinkedMaterialResponse.status !== 200 || ownUnlinkedPlan.status !== 200)
    throw new Error("主管创建的无关联技能资料应可用于培训计划");
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
  const publishPlanResponse = await approveTraining(createPlanBody.data.id);
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
  const withdrawRequest = () =>
    app.handle(
      new Request(`http://localhost/api/training-plans/${createPlanBody.data!.id}/withdraw`, {
        method: "POST",
        headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
      }),
    );
  const withdrawn = await withdrawRequest();
  const withdrawnTask = await contractPool.query("select status from training_tasks where id=$1", [
    task.rows[0]!.id,
  ]);
  if (withdrawn.status !== 200 || withdrawnTask.rows[0]?.status !== "cancelled")
    throw new Error("培训撤回未保留取消任务");
  const revised = await app.handle(
    new Request(`http://localhost/api/training-plans/${createPlanBody.data.id}`, {
      method: "PATCH",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie!, "content-type": "application/json" },
      body: JSON.stringify({ ...planPayload, trainingType: "other", location: "撤回修改会议室" }),
    }),
  );
  const publishedAgain = await approveTraining(createPlanBody.data.id);
  const reusedTasks = await contractPool.query(
    "select id,status from training_tasks where plan_id=$1",
    [createPlanBody.data.id],
  );
  if (
    revised.status !== 200 ||
    publishedAgain.status !== 200 ||
    reusedTasks.rowCount !== 1 ||
    reusedTasks.rows[0]?.id !== task.rows[0]!.id ||
    reusedTasks.rows[0]?.status !== "assigned"
  )
    throw new Error("撤回重发任务未正确复用");
  const plansList = await app.handle(
    new Request("http://localhost/api/training-plans", {
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const plansData = (await plansList.json()) as {
    data: Array<{
      id: string;
      trainingType: string;
      departments: unknown[];
      positions: unknown[];
      scopeEmployeeNames: string[];
    }>;
  };
  const revisedPlan = plansData.data.find((item) => item.id === createPlanBody.data!.id);
  if (
    revisedPlan?.trainingType !== "other" ||
    !revisedPlan.departments.length ||
    !revisedPlan.scopeEmployeeNames.length
  )
    throw new Error("培训类型或范围信息未往返");
  const tasksList = await app.handle(
    new Request("http://localhost/api/training-tasks", { headers: { cookie: importedCookie! } }),
  );
  const tasksData = (await tasksList.json()) as {
    data: Array<{ id: string; departmentName: string; trainingType: string }>;
  };
  if (
    !tasksData.data.some(
      (item) =>
        item.id === task.rows[0]!.id && item.departmentName && item.trainingType === "other",
    )
  )
    throw new Error("培训任务缺少部门或类型");
  const submit = () =>
    app.handle(
      new Request(`http://localhost/api/training-tasks/${task.rows[0]!.id}/submit`, {
        method: "POST",
        headers: { cookie: importedCookie! },
      }),
    );
  const firstSubmit = await submit();
  const unauthorizedStart = await executeTraining(task.rows[0]!.id, "start", importedCookie!);
  const prematureComplete = await executeTraining(
    task.rows[0]!.id,
    "complete",
    successfulConcurrentCookie,
  );
  const startedTask = await executeTraining(task.rows[0]!.id, "start", successfulConcurrentCookie);
  if ((await withdrawRequest()).status !== 409) throw new Error("已经开始的培训被错误撤回");
  const completeResponses = await Promise.all([
    executeTraining(task.rows[0]!.id, "complete", successfulConcurrentCookie),
    executeTraining(task.rows[0]!.id, "complete", successfulConcurrentCookie),
  ]);
  const trainingRecord = await contractPool.query(
    "select 1 from training_records where task_id=$1",
    [task.rows[0]!.id],
  );
  const actualTimes = await contractPool.query(
    "select actual_start_at,actual_completed_at from training_tasks where id=$1",
    [task.rows[0]!.id],
  );
  const cancelConfirmed = await app.handle(
    new Request(`http://localhost/api/training-plans/${createPlanBody.data.id}/cancel`, {
      method: "POST",
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  if (
    firstSubmit.status !== 403 ||
    unauthorizedStart.status !== 403 ||
    prematureComplete.status !== 409 ||
    startedTask.status !== 200 ||
    completeResponses
      .map((r) => r.status)
      .sort((a, b) => a - b)
      .join(",") !== "200,409" ||
    trainingRecord.rowCount !== 1 ||
    !actualTimes.rows[0]?.actual_start_at ||
    !actualTimes.rows[0]?.actual_completed_at ||
    cancelConfirmed.status !== 409
  )
    throw new Error("员工只读、负责人开始完成、实际时间或并发履历保护失败");
  const historicalPayload = {
    ...planPayload,
    title: "历史已完成培训补录",
    historicalCompleted: true,
    startAt: "2025-06-10T09:00:00+08:00",
    dueAt: "2025-06-10T17:00:00+08:00",
    scopeEmployeeIds: [importedEmployee.rows[0]!.id, employeeIds.get("department_manager")!],
  };
  const createHistorical = (body: unknown) =>
    app.handle(
      new Request("http://localhost/api/training-plans", {
        method: "POST",
        headers: {
          cookie: roleLogins.get("hr_admin")!.cookie!,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  const invalidHistorical = await createHistorical({
    ...historicalPayload,
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  if (invalidHistorical.status !== 400) throw new Error("未来培训被错误标为历史已完成");
  const historicalResponse = await createHistorical(historicalPayload);
  const historicalBody = (await historicalResponse.json()) as { data?: { id: string } };
  if (historicalResponse.status !== 200 || !historicalBody.data?.id)
    throw new Error("历史培训草稿保存失败");
  const historicalId = historicalBody.data.id;
  for (const historicalCompleted of [false, true]) {
    const editedHistory = await app.handle(
      new Request(`http://localhost/api/training-plans/${historicalId}`, {
        method: "PATCH",
        headers: {
          cookie: roleLogins.get("hr_admin")!.cookie!,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...historicalPayload, historicalCompleted }),
      }),
    );
    const savedMode = await contractPool.query(
      "select historical_completed from training_plans where id=$1",
      [historicalId],
    );
    if (
      editedHistory.status !== 200 ||
      savedMode.rows[0]?.historical_completed !== historicalCompleted
    )
      throw new Error("编辑草稿未保存历史补录完成方式");
  }
  const beforeApproval = await contractPool.query("select 1 from training_tasks where plan_id=$1", [
    historicalId,
  ]);
  if (beforeApproval.rowCount !== 0) throw new Error("历史补录在审批前生成了正式任务");
  const historicalPlans = await app.handle(
    new Request("http://localhost/api/training-plans", {
      headers: { cookie: roleLogins.get("hr_admin")!.cookie! },
    }),
  );
  const historicalPlanList = (await historicalPlans.json()) as {
    data: Array<{ id: string; historicalCompleted: boolean }>;
  };
  if (!historicalPlanList.data.find((p) => p.id === historicalId)?.historicalCompleted)
    throw new Error("历史补录标记未往返");
  const historicalApproval = await approveTraining(historicalId);
  if (historicalApproval.status !== 200)
    throw new Error(`历史培训审批失败：${await historicalApproval.text()}`);
  const completedHistory = await contractPool.query(
    `select p.status as plan_status,p.completed_at,t.id,t.status,t.actual_start_at,t.actual_completed_at,
     t.confirmed_at,r.id as record_id,r.confirmed_at as record_confirmed_at
     from training_plans p join training_tasks t on t.plan_id=p.id
     left join training_records r on r.task_id=t.id where p.id=$1`,
    [historicalId],
  );
  if (
    completedHistory.rowCount !== 2 ||
    completedHistory.rows.some(
      (r) =>
        r.plan_status !== "completed" ||
        r.status !== "confirmed" ||
        !r.record_id ||
        r.actual_start_at.toISOString() !== "2025-06-10T01:00:00.000Z" ||
        r.actual_completed_at.toISOString() !== "2025-06-10T09:00:00.000Z" ||
        r.completed_at.toISOString() !== "2025-06-10T09:00:00.000Z" ||
        r.confirmed_at <= r.actual_completed_at ||
        r.record_confirmed_at.getTime() !== r.confirmed_at.getTime(),
    )
  )
    throw new Error("历史补录未自动完成全体任务，或实际时间、审批时间、正式履历不正确");
  const repeatedHistoricalApproval = await app.handle(
    new Request(`http://localhost/api/training-plans/${historicalId}/approve`, {
      method: "POST",
      headers: { cookie: independentHrCookie },
    }),
  );
  const manualHistoricalComplete = await executeTraining(
    completedHistory.rows[0]!.id,
    "complete",
    successfulConcurrentCookie,
  );
  if (repeatedHistoricalApproval.status !== 409 || manualHistoricalComplete.status !== 409)
    throw new Error("已完成的历史培训允许重复审批或完成");
  const historicalTaskList = await app.handle(
    new Request("http://localhost/api/training-tasks", {
      headers: { cookie: importedCookie! },
    }),
  );
  const historicalTaskData = (await historicalTaskList.json()) as {
    data: Array<{
      planId: string;
      status: string;
      actualStartAt: string;
      actualCompletedAt: string;
      overdue: boolean;
    }>;
  };
  const historicalTaskView = historicalTaskData.data.find((t) => t.planId === historicalId);
  if (
    historicalTaskView?.status !== "confirmed" ||
    historicalTaskView.overdue ||
    historicalTaskView.actualStartAt !== "2025-06-10T01:00:00.000Z" ||
    historicalTaskView.actualCompletedAt !== "2025-06-10T09:00:00.000Z"
  )
    throw new Error("员工端历史培训实际时间、完成状态或逾期标记不正确");
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
  if ((await approveTraining(batchPlanBody.data!.id)).status !== 200)
    throw new Error("培训审批发布失败");
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
  if (managerSelfSubmit.status !== 403 || managerSelfConfirm.status !== 403)
    throw new Error("主管不能提交本人任务或可自行完成双确认");
  for (const batchTask of batchTasks.rows) {
    if ((await executeTraining(batchTask.id, "start", successfulConcurrentCookie)).status !== 200)
      throw new Error("负责人开始集中培训失败");
  }
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
      headers: { cookie: successfulConcurrentCookie },
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
  if ((await approveTraining(futurePlanBody.data!.id)).status !== 200)
    throw new Error("培训审批发布失败");
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
  if ((await approveTraining(overduePlanBody.data!.id)).status !== 200)
    throw new Error("培训审批发布失败");
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
    withoutEvidence?: boolean;
  }) => {
    const data = new FormData();
    data.set("employeeId", assignment.employeeId);
    data.set("skillId", input.skillId);
    data.set("method", "written_practical");
    data.set("level", String(input.level));
    data.set("passed", String(input.passed));
    data.set("assessedAt", new Date(Date.now() - 60_000).toISOString());
    if (input.reason) data.set("reason", input.reason);
    if (input.replacesAssessmentId) data.set("replacesAssessmentId", input.replacesAssessmentId);
    if (!input.withoutEvidence)
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
    const body = (await response.json()) as { data?: { id: string; status: string } };
    if (response.status !== 200 || !body.data || body.data.status !== "pending_hr")
      throw new Error(`技能评定应保存为待HR归档 ${response.status} ${JSON.stringify(body)}`);
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
  const assessmentMethod = await contractPool.query(
    "select method from skill_assessments where id=$1",
    [passedAssessmentId],
  );
  if (assessmentMethod.rows[0]?.method !== "written_practical")
    throw new Error("线下笔试+实操未保存");
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
  const unauthorizedManagerReturn = await transitionAssessment(
    passedAssessmentId,
    "return",
    successfulConcurrentCookie,
    { reason: "无权退回待HR归档记录" },
  );
  if (unauthorizedManagerReturn.status !== 409) throw new Error("主管可退回待HR归档记录");
  const assessmentReturn = await transitionAssessment(
    passedAssessmentId,
    "return",
    roleLogins.get("hr_admin")!.cookie!,
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
  const evaluatorArchiveAfterIndependentReview = await transitionAssessment(
    passedAssessmentId,
    "archive",
    evaluatorCookie,
  );
  const duplicateAssessmentArchive = await transitionAssessment(
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
    assessmentSubmit.status !== 409 ||
    assessmentReturn.status !== 200 ||
    assessmentRevise.status !== 200 ||
    assessmentResubmit.status !== 409 ||
    crossDepartmentConfirm.status !== 403 ||
    assessmentManagerConfirm.status !== 409 ||
    assessmentHrReturn.status !== 200 ||
    assessmentSecondRevise.status !== 200 ||
    assessmentSecondResubmit.status !== 409 ||
    assessmentSecondManagerConfirm.status !== 409 ||
    assessmentReminderVersions.rows[0]?.pendingManager !== 0 ||
    assessmentReminderVersions.rows[0]?.pendingHr !== 3 ||
    evaluatorArchiveAfterIndependentReview.status !== 409 ||
    duplicateAssessmentArchive.status !== 200 ||
    currentPassedAssessment.rows[0]?.assessmentId !== passedAssessmentId ||
    currentPassedAssessment.rows[0]?.level !== 3 ||
    !currentPassedAssessment.rows[0]?.validUntil
  )
    throw new Error("评定退回重提、独立复核、有效期或矩阵事务更新失败");

  const failedAssessmentId = await createAssessment({
    skillId: createdSkills.get("S002")!,
    level: 1,
    passed: false,
    reason: "实操不合格",
    withoutEvidence: true,
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
  const managerAssessmentSubmit = await transitionAssessment(
    managerAuthoredAssessmentId,
    "submit",
    successfulConcurrentCookie,
  );
  const managerAuthoredState = await contractPool.query<{ status: string }>(
    "select status from skill_assessments where id=$1",
    [managerAuthoredAssessmentId],
  );
  const managerAssessmentSelfConfirm = await transitionAssessment(
    managerAuthoredAssessmentId,
    "manager-confirm",
    successfulConcurrentCookie,
  );
  const managerAuthoredArchive = await transitionAssessment(
    managerAuthoredAssessmentId,
    "archive",
    roleLogins.get("hr_admin")!.cookie!,
  );
  if (
    managerAssessmentSubmit.status !== 409 ||
    managerAuthoredState.rows[0]?.status !== "pending_hr" ||
    managerAssessmentSelfConfirm.status !== 403 ||
    managerAuthoredArchive.status !== 200
  )
    throw new Error("主管录入评定未跳过重复自审，或 HR 无法独立归档");
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
    "select 1 from notification_outbox where event_type='training_published' limit 1",
  );
  if (
    pendingAssessment.rows[0]?.status !== "pending_hr" ||
    firstOutboxCount.rows[0]?.count !== secondOutboxCount.rows[0]?.count ||
    !employeeNotificationsBody.data?.some((item) => item.type === "assessment_archived") ||
    !trainingPendingOutbox.rowCount ||
    wecomAttempts.some((attempt) => attempt.url.includes("127.0.0.1"))
  )
    throw new Error("通知 outbox 故障隔离、扫描去重或站内通知失败");
  const maximumReasonReturn = await transitionAssessment(
    notificationAssessmentId,
    "return",
    roleLogins.get("hr_admin")!.cookie!,
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
    "training_task.completed",
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

  // Regression: exercise the actual HTTP schema, service and database write together.
  const createManagerResponse = await app.handle(
    new Request("http://localhost/api/organization/employees", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: roleLogins.get("hr_admin")!.cookie! },
      body: JSON.stringify({
        employeeNumber: "HTTP-MANAGER-REGRESSION",
        displayName: "HTTP主管回归",
        departmentCode: "D001",
        positionCode: "P001",
        role: "department_manager",
        gender: "女",
        age: 32,
        identityNumber: "110101199401010028",
        tenureYears: 3.5,
        education: "本科",
      }),
    }),
  );
  const createManagerBody = (await createManagerResponse.json()) as {
    ok: boolean;
    data?: { imported: number };
  };
  const persistedManager = await contractPool.query<{
    role: string;
    gender: string;
    age: number;
    tenureYears: string;
    education: string;
  }>(
    'select ua.role,e.gender,e.age,e.tenure_years as "tenureYears",e.education from employees e join user_accounts ua on ua.employee_id=e.id where e.employee_number=$1',
    ["HTTP-MANAGER-REGRESSION"],
  );
  if (
    createManagerResponse.status !== 200 ||
    !createManagerBody.ok ||
    createManagerBody.data?.imported !== 1 ||
    persistedManager.rows[0]?.role !== "department_manager" ||
    persistedManager.rows[0].gender !== "女" ||
    persistedManager.rows[0].age !== 32 ||
    Number(persistedManager.rows[0].tenureYears) !== 3.5 ||
    persistedManager.rows[0].education !== "本科"
  )
    throw new Error("HR经HTTP创建主管时角色或完整资料未持久化");

  // September 2026 requirements: run through HTTP contracts and durable rows.
  const qaRequest = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie = roleLogins.get("hr_admin")!.cookie!,
  ) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const departmentEdit = await qaRequest(
    `/api/organization/departments/${otherDepartment.rows[0]!.id}`,
    "PATCH",
    { name: "其他部门改名", code: "D002NEW" },
  );
  const departmentConflict = await qaRequest(
    `/api/organization/departments/${otherDepartment.rows[0]!.id}`,
    "PATCH",
    { name: "编码冲突", code: "D001" },
  );
  const editablePosition = await contractPool.query<{ id: string }>(
    "insert into positions(code,name,department_id) values ('QA-POS','可调整岗位',$1) returning id",
    [department.rows[0]!.id],
  );
  await contractPool.query(
    "insert into position_skill_requirements(position_id,skill_id,required_level,required) select $1,skill_id,required_level,required from position_skill_requirements where position_id=$2",
    [editablePosition.rows[0]!.id, copyPosition.rows[0]!.id],
  );
  const positionEdit = await qaRequest(
    `/api/organization/positions/${editablePosition.rows[0]!.id}`,
    "PATCH",
    { name: "改码岗位", code: "P003NEW", departmentId: otherDepartment.rows[0]!.id },
  );
  const positionConflict = await qaRequest(
    `/api/organization/positions/${editablePosition.rows[0]!.id}`,
    "PATCH",
    { name: "冲突岗位", code: "P001", departmentId: otherDepartment.rows[0]!.id },
  );
  const moved = await contractPool.query("select code,department_id from positions where id=$1", [
    editablePosition.rows[0]!.id,
  ]);
  if (
    departmentEdit.status !== 200 ||
    departmentConflict.status !== 409 ||
    positionEdit.status !== 200 ||
    positionConflict.status !== 409 ||
    moved.rows[0]?.code !== "P003NEW" ||
    moved.rows[0]?.department_id !== otherDepartment.rows[0]!.id
  )
    throw new Error(
      `部门/岗位编码编辑冲突或所属部门变更合同失败 department=${departmentEdit.status}/${await departmentEdit.text()} conflict=${departmentConflict.status}/${await departmentConflict.text()} position=${positionEdit.status}/${await positionEdit.text()} conflict=${positionConflict.status}/${await positionConflict.text()} moved=${JSON.stringify(moved.rows)}`,
    );
  const requirement = await contractPool.query<{ id: string }>(
    "select id from position_skill_requirements where position_id=$1 and skill_id=$2",
    [assignment.positionId, createdSkills.get("S004")!],
  );
  const deniedDeleteRequirement = await qaRequest(
    `/api/position-skill-requirements/${requirement.rows[0]!.id}`,
    "DELETE",
    undefined,
    successfulConcurrentCookie,
  );
  const beforeDelete = await (
    await qaRequest(`/api/skill-matrix?employeeId=${assignment.employeeId}`)
  ).json();
  const deletedRequirement = await qaRequest(
    `/api/position-skill-requirements/${requirement.rows[0]!.id}`,
    "DELETE",
  );
  const afterDelete = await (
    await qaRequest(`/api/skill-matrix?employeeId=${assignment.employeeId}`)
  ).json();
  const retainedRequirement = await contractPool.query(
    "select active from position_skill_requirements where id=$1",
    [requirement.rows[0]!.id],
  );
  if (
    deniedDeleteRequirement.status !== 403 ||
    deletedRequirement.status !== 200 ||
    !beforeDelete.data.some((r: { skillId: string }) => r.skillId === createdSkills.get("S004")) ||
    afterDelete.data.some((r: { skillId: string }) => r.skillId === createdSkills.get("S004")) ||
    retainedRequirement.rows[0]?.active !== false
  )
    throw new Error("岗位要求逻辑删除/权限/矩阵排除失败");
  const filteredRequirements = await (
    await qaRequest(`/api/position-skill-requirements?departmentId=${otherDepartment.rows[0]!.id}`)
  ).json();
  if (
    !filteredRequirements.data.length ||
    filteredRequirements.data.some(
      (r: { departmentId: string }) => r.departmentId !== otherDepartment.rows[0]!.id,
    )
  )
    throw new Error("岗位要求按部门筛选失败");
  await contractPool.query("update user_accounts set factory_read=true where id=$1", [
    accountIds.get("department_manager")!,
  ]);
  const readableDepartments = await (
    await qaRequest("/api/organization/departments", "GET", undefined, successfulConcurrentCookie)
  ).json();
  const readableCrossProfile = await qaRequest(
    `/api/employees/${otherEmployee.rows[0]!.id}/profile`,
    "GET",
    undefined,
    successfulConcurrentCookie,
  );
  const deniedOrganizationWrite = await qaRequest(
    `/api/organization/departments/${otherDepartment.rows[0]!.id}`,
    "PATCH",
    { name: "跨部门写入", code: "DENIED" },
    successfulConcurrentCookie,
  );
  const deniedScopeWrite = await qaRequest(
    "/api/training-plans",
    "POST",
    { ...planPayload, scopeEmployeeIds: [otherEmployee.rows[0]!.id] },
    successfulConcurrentCookie,
  );
  if (
    !readableDepartments.data.some((d: { id: string }) => d.id === otherDepartment.rows[0]!.id) ||
    readableCrossProfile.status !== 200 ||
    deniedOrganizationWrite.status !== 403 ||
    deniedScopeWrite.status !== 409
  )
    throw new Error("全厂只读授权错误扩大写入范围或未扩大读取范围");
  const extraMaterial = await (
    await qaRequest("/api/training-materials/link", "POST", {
      title: "多选验收资料",
      trainingType: "safety",
      trainingName: "安全宣导",
      category: "安全",
      externalUrl: "https://example.com/safety",
      skillIds: [unrelatedSkill.rows[0]!.id],
    })
  ).json();
  const multiPayload = {
    ...planPayload,
    trainingType: "safety",
    materialIds: [materialUploadBody.data.id, extraMaterial.data.id],
    ownerEmployeeIds: [employeeIds.get("department_manager")!, independentHrEmployee.rows[0]!.id],
    scopeType: "department",
    scopeDepartmentIds: [department.rows[0]!.id, otherDepartment.rows[0]!.id],
    scopeEmployeeIds: [],
  };
  // Original material has been deactivated to exercise history above: reactivate only this isolated fixture.
  await contractPool.query("update training_materials set active=true where id=$1", [
    materialUploadBody.data.id,
  ]);
  const multiResponse = await qaRequest("/api/training-plans", "POST", multiPayload);
  const multiBody = await multiResponse.json();
  if (multiResponse.status !== 200)
    throw new Error(`多选HTTP创建失败 ${JSON.stringify(multiBody)}`);
  const bypassResponse = await qaRequest(
    `/api/training-plans/${multiBody.data.id}/publish`,
    "POST",
  );
  const multiApproved = await approveTraining(multiBody.data.id);
  const multiStored = await contractPool.query(
    "select material_ids,owner_employee_ids,scope_department_ids from training_plans where id=$1",
    [multiBody.data.id],
  );
  const multiTargets = await contractPool.query(
    "select employee_id from training_tasks where plan_id=$1",
    [multiBody.data.id],
  );
  const multiGrants = await contractPool.query(
    "select distinct material_id from training_material_access_grants where employee_id=$1 and source_reference in (select id::text from training_tasks where plan_id=$2)",
    [otherEmployee.rows[0]!.id, multiBody.data.id],
  );
  if (
    bypassResponse.status !== 409 ||
    multiApproved.status !== 200 ||
    multiStored.rows[0]?.material_ids.length !== 2 ||
    multiStored.rows[0]?.owner_employee_ids.length !== 2 ||
    multiStored.rows[0]?.scope_department_ids.length !== 2 ||
    !multiTargets.rows.some((r) => r.employee_id === otherEmployee.rows[0]!.id) ||
    multiGrants.rowCount !== 2
  )
    throw new Error("多资料/负责人/部门持久化、审批或访问授权失败");
  // Migrated in_progress plans with no actual execution remain withdrawable.
  await contractPool.query("update training_plans set status='in_progress' where id=$1", [
    multiBody.data.id,
  ]);
  const withdrawUnstartedLegacy = await qaRequest(
    `/api/training-plans/${multiBody.data.id}/withdraw`,
    "POST",
  );
  if (
    withdrawUnstartedLegacy.status !== 200 ||
    (await approveTraining(multiBody.data.id)).status !== 200
  )
    throw new Error("历史进行中未实际开始计划不能撤回修改重审");
  const legacyTask = await contractPool.query<{ id: string }>(
    "select id from training_tasks where plan_id=$1 and employee_id=$2",
    [multiBody.data.id, importedEmployee.rows[0]!.id],
  );
  await contractPool.query(
    "update training_tasks set status='returned',returned_at=now(),return_reason='历史退回' where id=$1",
    [legacyTask.rows[0]!.id],
  );
  if (
    (await executeTraining(legacyTask.rows[0]!.id, "start", successfulConcurrentCookie)).status !==
      200 ||
    (await executeTraining(legacyTask.rows[0]!.id, "complete", successfulConcurrentCookie))
      .status !== 200
  )
    throw new Error("历史returned任务无法由负责人恢复执行");
  const legacyCompleted = await contractPool.query(
    "select return_reason,actual_start_at,actual_completed_at from training_tasks where id=$1",
    [legacyTask.rows[0]!.id],
  );
  if (
    legacyCompleted.rows[0]?.return_reason !== "历史退回" ||
    !legacyCompleted.rows[0]?.actual_start_at ||
    !legacyCompleted.rows[0]?.actual_completed_at
  )
    throw new Error("恢复培训未保留历史退回或实际时间");

  const secondMaterialReport = await qaRequest(
    `/api/reports/dashboard?employeeId=${importedEmployee.rows[0]!.id}&skillId=${unrelatedSkill.rows[0]!.id}`,
  );
  const secondMaterialReportBody = await secondMaterialReport.json();
  if (
    secondMaterialReport.status !== 200 ||
    secondMaterialReportBody.data.metrics.trainingCompletion.numerator !== 1 ||
    secondMaterialReportBody.data.metrics.trainingCompletion.denominator !== 1
  )
    throw new Error("报表按第二份培训资料关联技能筛选漏计完成记录");

  const examResponse = await qaRequest("/api/training-exams", "POST", {
    planId: createPlanBody.data.id,
    employeeId: importedEmployee.rows[0]!.id,
    skillId: materialSkill.rows[0]!.id,
    method: "written_practical",
    score: 88.5,
    passed: true,
    completedAt: new Date().toISOString(),
    remarks: "验收考核",
  });
  const examBody = await examResponse.json();
  const ownExams = await (
    await qaRequest("/api/training-exams", "GET", undefined, importedCookie!)
  ).json();
  await contractPool.query(
    "insert into user_accounts(employee_id,password_hash,role,must_change_password) values ($1,$2,'employee',false)",
    [otherEmployee.rows[0]!.id, passwordHash],
  );
  const isolatedEmployeeCookie = (await login("E0099")).cookie!;
  const otherExams = await (
    await qaRequest("/api/training-exams", "GET", undefined, isolatedEmployeeCookie)
  ).json();
  if (
    examResponse.status !== 200 ||
    !ownExams.data.some((e: { id: string }) => e.id === examBody.data.id) ||
    otherExams.data.some((e: { id: string }) => e.id === examBody.data.id)
  )
    throw new Error(`考核档案录入或个人隔离失败 ${JSON.stringify(examBody)}`);

  const emptyDepartment = await contractPool.query<{ id: string }>(
    "insert into departments(code,name) values ('QA-EMPTY','逻辑删除验收') returning id",
  );
  const emptyPosition = await contractPool.query<{ id: string }>(
    "insert into positions(code,name,department_id) values ('QA-EMPTY-P','逻辑删除岗位',$1) returning id",
    [emptyDepartment.rows[0]!.id],
  );
  const removedPosition = await qaRequest(
    `/api/organization/positions/${emptyPosition.rows[0]!.id}/deactivate`,
    "POST",
  );
  const removedDepartment = await qaRequest(
    `/api/organization/departments/${emptyDepartment.rows[0]!.id}/deactivate`,
    "POST",
  );
  const softDeleted = await contractPool.query(
    "select active from positions where id=$1 union all select active from departments where id=$2",
    [emptyPosition.rows[0]!.id, emptyDepartment.rows[0]!.id],
  );
  if (
    removedPosition.status !== 200 ||
    removedDepartment.status !== 200 ||
    softDeleted.rowCount !== 2 ||
    softDeleted.rows.some((r) => r.active)
  )
    throw new Error("基础数据停用应保留行，不可物理删除");

  const positionsPlanResponse = await qaRequest("/api/training-plans", "POST", {
    ...multiPayload,
    scopeType: "position",
    scopeDepartmentIds: [],
    scopePositionIds: [assignment.positionId, editablePosition.rows[0]!.id],
  });
  const positionsPlanBody = await positionsPlanResponse.json();
  const employeeOwnerDenied = await qaRequest("/api/training-plans", "POST", {
    ...planPayload,
    ownerEmployeeIds: [importedEmployee.rows[0]!.id],
  });
  if (
    positionsPlanResponse.status !== 200 ||
    employeeOwnerDenied.status !== 409 ||
    (await approveTraining(positionsPlanBody.data.id)).status !== 200
  )
    throw new Error("岗位多选发布或普通员工负责人限制失败");
  const positionsStored = await contractPool.query(
    "select scope_position_ids from training_plans where id=$1",
    [positionsPlanBody.data.id],
  );
  if (positionsStored.rows[0]?.scope_position_ids.length !== 2)
    throw new Error("岗位多选未完整持久化");

  const proxyPlanResponse = await qaRequest(
    "/api/training-plans",
    "POST",
    planPayload,
    successfulConcurrentCookie,
  );
  const proxyPlanBody = await proxyPlanResponse.json();
  if (proxyPlanResponse.status !== 200) throw new Error("主管创建代理提交验收计划失败");
  const proxySubmitted = await qaRequest(
    `/api/training-plans/${proxyPlanBody.data.id}/submit`,
    "POST",
  );
  const submitterApproveDenied = await qaRequest(
    `/api/training-plans/${proxyPlanBody.data.id}/approve`,
    "POST",
  );
  const submitterRejectDenied = await qaRequest(
    `/api/training-plans/${proxyPlanBody.data.id}/reject`,
    "POST",
    { reason: "提交人不得自行处理审批" },
  );
  const creatorApproveDenied = await qaRequest(
    `/api/training-plans/${proxyPlanBody.data.id}/approve`,
    "POST",
    undefined,
    successfulConcurrentCookie,
  );
  const independentProxyApproved = await qaRequest(
    `/api/training-plans/${proxyPlanBody.data.id}/approve`,
    "POST",
    undefined,
    independentHrCookie,
  );
  const actualSubmitter = await contractPool.query(
    "select submitted_by_account_id,created_by_account_id from training_plans where id=$1",
    [proxyPlanBody.data.id],
  );
  if (
    proxySubmitted.status !== 200 ||
    submitterApproveDenied.status !== 409 ||
    submitterRejectDenied.status !== 409 ||
    creatorApproveDenied.status !== 409 ||
    independentProxyApproved.status !== 200 ||
    actualSubmitter.rows[0]?.submitted_by_account_id !== accountIds.get("hr_admin") ||
    actualSubmitter.rows[0]?.created_by_account_id !== accountIds.get("department_manager")
  )
    throw new Error("HR代提交审批隔离失败：创建人与实际提交人均不得审批/退回，另一HR应成功审批");

  const crossOwnerTask = await contractPool.query<{ id: string }>(
    "select id from training_tasks where plan_id=$1 and employee_id=$2",
    [multiBody.data.id, otherEmployee.rows[0]!.id],
  );
  await contractPool.query("update user_accounts set factory_read=false where id=$1", [
    accountIds.get("department_manager")!,
  ]);
  const scopedOwnerTasks = await (
    await qaRequest("/api/training-tasks", "GET", undefined, successfulConcurrentCookie)
  ).json();
  const crossOwnerStart = await executeTraining(
    crossOwnerTask.rows[0]!.id,
    "start",
    successfulConcurrentCookie,
  );
  const hrOwnerStart = await executeTraining(
    crossOwnerTask.rows[0]!.id,
    "start",
    independentHrCookie,
  );
  const crossOwnerComplete = await executeTraining(
    crossOwnerTask.rows[0]!.id,
    "complete",
    successfulConcurrentCookie,
  );
  const hrOwnerComplete = await executeTraining(
    crossOwnerTask.rows[0]!.id,
    "complete",
    independentHrCookie,
  );
  if (
    scopedOwnerTasks.data.some(
      (t: { departmentId: string }) => t.departmentId !== department.rows[0]!.id,
    ) ||
    crossOwnerStart.status !== 409 ||
    crossOwnerComplete.status !== 409 ||
    hrOwnerStart.status !== 200 ||
    hrOwnerComplete.status !== 200
  )
    throw new Error("多负责人身份扩大主管部门读写范围，或HR负责人不能合法跨部门执行");
  await contractPool.query("update user_accounts set role='employee' where id=$1", [
    accountIds.get("department_manager")!,
  ]);
  const downgradedOwnerTasks = await (
    await qaRequest("/api/training-tasks", "GET", undefined, successfulConcurrentCookie)
  ).json();
  const downgradedOwnerWrite = await executeTraining(
    crossOwnerTask.rows[0]!.id,
    "start",
    successfulConcurrentCookie,
  );
  if (
    downgradedOwnerTasks.data.some(
      (t: { employeeId: string }) => t.employeeId !== employeeIds.get("department_manager"),
    ) ||
    downgradedOwnerWrite.status !== 403
  )
    throw new Error("负责人降级为员工后仍能查看或操作他人任务");
  await contractPool.query(
    "update user_accounts set role='department_manager',factory_read=true where id=$1",
    [accountIds.get("department_manager")!],
  );

  let missingFactoryGrantRejected = false;
  try {
    await grantReviewedFactoryRead(contractPool);
  } catch {
    missingFactoryGrantRejected = true;
  }
  await contractPool.query("update employees set display_name='邓华明' where id=any($1::uuid[])", [
    [employeeIds.get("department_manager")!, independentHrEmployee.rows[0]!.id],
  ]);
  let duplicateFactoryGrantRejected = false;
  try {
    await grantReviewedFactoryRead(contractPool);
  } catch {
    duplicateFactoryGrantRejected = true;
  }
  await contractPool.query("update employees set display_name='独立审批HR' where id=$1", [
    independentHrEmployee.rows[0]!.id,
  ]);
  const originalManagerNumber = await contractPool.query(
    "select employee_number from employees where id=$1",
    [employeeIds.get("department_manager")!],
  );
  await contractPool.query("update employees set employee_number='10032' where id=$1", [
    employeeIds.get("department_manager")!,
  ]);
  await contractPool.query("update user_accounts set factory_read=false where id=$1", [
    accountIds.get("department_manager")!,
  ]);
  const reviewedGrant = await grantReviewedFactoryRead(contractPool);
  const repeatedGrant = await grantReviewedFactoryRead(contractPool);
  const grantedAccount = await contractPool.query(
    "select role,factory_read from user_accounts where id=$1",
    [accountIds.get("department_manager")!],
  );
  const grantAudit = await contractPool.query(
    "select 1 from audit_logs where action='account.factory_read_granted' and object_id=$1",
    [accountIds.get("department_manager")!],
  );
  if (
    !missingFactoryGrantRejected ||
    !duplicateFactoryGrantRejected ||
    reviewedGrant.status !== "granted" ||
    repeatedGrant.status !== "already_granted" ||
    grantedAccount.rows[0]?.role !== "department_manager" ||
    grantedAccount.rows[0]?.factory_read !== true ||
    grantAudit.rowCount !== 1
  )
    throw new Error("邓华明唯一账号授权、缺失/重名拒绝、幂等或角色保持失败");
  await contractPool.query("update employees set display_name='部门主管' where id=$1", [
    employeeIds.get("department_manager")!,
  ]);
  await contractPool.query("update employees set employee_number=$2 where id=$1", [
    employeeIds.get("department_manager")!,
    originalManagerNumber.rows[0]!.employee_number,
  ]);

  await contractPool.query(
    "update drizzle.__drizzle_migrations set hash = 'tampered' where id = (select max(id) from drizzle.__drizzle_migrations)",
  );
  const tamperedResult = await readinessProbe();
  if (tamperedResult.ok || tamperedResult.reason !== "migration-mismatch") {
    throw new Error("就绪探针未识别迁移 hash 不一致");
  }

  await verifyTrainingApproval(contractPool, {
    hrAccountId: accountIds.get("hr_admin")!,
    managerAccountId: accountIds.get("department_manager")!,
    managerEmployeeId: employeeIds.get("department_manager")!,
    departmentId: department.rows[0]!.id,
    otherEmployeeId: otherEmployee.rows[0]!.id,
  });
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
