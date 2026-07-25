import { createApp } from "../../../apps/server/src/app";
import { createAuthService } from "../../../apps/server/src/auth-service";
import {
  createDatabaseReadinessProbe,
  createPostgresAuthRepository,
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
  const roles = [
    ["E0001", "员工", "employee", true],
    ["M0001", "部门主管", "department_manager", false],
    ["H0001", "HR管理员", "hr_admin", false],
    ["V0001", "高层查看者", "executive_viewer", false],
    ["A0001", "系统管理员", "system_admin", false],
  ] as const;
  const contractPassword = "Contract-Password-123";
  const passwordHash = await Bun.password.hash(contractPassword, {
    algorithm: "argon2id",
    memoryCost: 4_096,
    timeCost: 1,
  });
  const accountIds = new Map<string, string>();
  for (const [employeeNumber, displayName, role, mustChangePassword] of roles) {
    const employee = await contractPool.query<{ id: string }>(
      `insert into employees (
         employee_number, display_name, department_id
       ) values ($1, $2, $3)
       returning id`,
      [employeeNumber, displayName, department.rows[0]!.id],
    );
    const account = await contractPool.query<{ id: string }>(
      `insert into user_accounts (
         employee_id, password_hash, role, must_change_password
       ) values ($1, $2, $3, $4)
       returning id`,
      [employee.rows[0]!.id, passwordHash, role, mustChangePassword],
    );
    accountIds.set(role, account.rows[0]!.id);
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
  const app = createApp({ authService, readinessProbe });
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

  await contractPool.query(
    "update drizzle.__drizzle_migrations set hash = 'tampered' where id = (select max(id) from drizzle.__drizzle_migrations)",
  );
  const tamperedResult = await readinessProbe();
  if (tamperedResult.ok || tamperedResult.reason !== "migration-mismatch") {
    throw new Error("就绪探针未识别迁移 hash 不一致");
  }

  console.log("PostgreSQL 空库、认证事务、五角色越权及迁移 hash 合同测试通过");
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
