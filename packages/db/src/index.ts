import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { ServerConfig } from "@jineng/skill-matrix-config";
import { createDatabaseReadinessProbe } from "./readiness";
import * as schema from "./schema";
import { createPostgresAuthRepository } from "./auth-repository";

export const createDatabase = (config: Pick<ServerConfig, "databaseUrl">) => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool, { schema });
  const readinessProbe = createDatabaseReadinessProbe({
    query: async (sql) => pool.query(sql),
  });
  const authRepository = createPostgresAuthRepository(pool);

  return {
    authRepository,
    db,
    pool,
    readinessProbe,
    close: () => pool.end(),
  };
};

export * from "./readiness";
export * from "./schema";
export * from "./auth-repository";
