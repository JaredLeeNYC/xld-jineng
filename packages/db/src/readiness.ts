import type { ReadinessProbe } from "@jineng/skill-matrix-shared";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";

type QueryResult = {
  rows: Array<Record<string, unknown>>;
};

export type ReadinessClient = {
  query: (sql: string) => Promise<QueryResult>;
};

export type ExpectedMigration = {
  hash: string;
  createdAt: string;
};

export const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));

export const readExpectedMigrations = (): ExpectedMigration[] =>
  readMigrationFiles({ migrationsFolder }).map((migration) => ({
    hash: migration.hash,
    createdAt: String(migration.folderMillis),
  }));

export const createDatabaseReadinessProbe =
  (client: ReadinessClient, expectedMigrations = readExpectedMigrations()): ReadinessProbe =>
  async () => {
    try {
      await client.query("select 1");
    } catch {
      return {
        ok: false,
        reason: "database-unavailable",
        message: "数据库暂不可用",
      };
    }

    try {
      const result = await client.query(
        'select hash, created_at::text as "createdAt" from drizzle.__drizzle_migrations order by created_at, id',
      );
      const appliedMigrations = result.rows.map((row) => ({
        hash: String(row.hash),
        createdAt: String(row.createdAt),
      }));

      if (JSON.stringify(appliedMigrations) !== JSON.stringify(expectedMigrations)) {
        return {
          ok: false,
          reason: "migration-mismatch",
          message: "数据库结构未升级到当前版本",
        };
      }
    } catch {
      return {
        ok: false,
        reason: "migration-mismatch",
        message: "数据库结构未升级到当前版本",
      };
    }

    return { ok: true };
  };
