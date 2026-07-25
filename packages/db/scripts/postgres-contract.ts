import { createDatabaseReadinessProbe, migrationsFolder } from "../src";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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

  await contractPool.query(
    "update drizzle.__drizzle_migrations set hash = 'tampered' where id = (select max(id) from drizzle.__drizzle_migrations)",
  );
  const tamperedResult = await readinessProbe();
  if (tamperedResult.ok || tamperedResult.reason !== "migration-mismatch") {
    throw new Error("就绪探针未识别迁移 hash 不一致");
  }

  console.log("PostgreSQL 空库、幂等迁移及 hash 一致性合同测试通过");
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
