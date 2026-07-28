import { createApp } from "../../../apps/server/src/app";
import { createAuthService } from "../../../apps/server/src/auth-service";
import { createOrganizationService } from "../../../apps/server/src/organization-service";
import { createEmployeeImportWorkbook } from "../../../apps/server/src/organization-excel";
import {
  createDatabaseReadinessProbe,
  createPostgresAuthRepository,
  createPostgresOrganizationRepository,
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
  const app = createApp({ authService, organizationService, readinessProbe });
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

  await contractPool.query(
    "update drizzle.__drizzle_migrations set hash = 'tampered' where id = (select max(id) from drizzle.__drizzle_migrations)",
  );
  const tamperedResult = await readinessProbe();
  if (tamperedResult.ok || tamperedResult.reason !== "migration-mismatch") {
    throw new Error("就绪探针未识别迁移 hash 不一致");
  }

  console.log("PostgreSQL 空库、认证事务、五角色越权、50 人组织导入及迁移 hash 合同测试通过");
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
