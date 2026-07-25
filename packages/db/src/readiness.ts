import type { ReadinessProbe } from "@jineng/skill-matrix-shared";

type QueryResult = {
  rows: Array<Record<string, unknown>>;
};

export type ReadinessClient = {
  query: (sql: string) => Promise<QueryResult>;
};

export const expectedMigrationCount = 1;

export const createDatabaseReadinessProbe =
  (client: ReadinessClient, expectedMigrations = expectedMigrationCount): ReadinessProbe =>
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
        "select count(*)::integer as count from drizzle.__drizzle_migrations",
      );
      if (result.rows[0]?.count !== expectedMigrations) {
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
