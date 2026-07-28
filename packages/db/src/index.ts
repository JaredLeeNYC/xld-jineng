import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { ServerConfig } from "@jineng/skill-matrix-config";
import { createDatabaseReadinessProbe } from "./readiness";
import * as schema from "./schema";
import { createPostgresAuthRepository } from "./auth-repository";
import { createPostgresOrganizationRepository } from "./organization-repository";
import { createPostgresSkillRepository } from "./skill-repository";
import { createPostgresMaterialRepository } from "./material-repository";
import { createPostgresTrainingRepository } from "./training-repository";

export const createDatabase = (config: Pick<ServerConfig, "databaseUrl">) => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool, { schema });
  const readinessProbe = createDatabaseReadinessProbe({
    query: async (sql) => pool.query(sql),
  });
  const authRepository = createPostgresAuthRepository(pool);
  const organizationRepository = createPostgresOrganizationRepository(pool);
  const skillRepository = createPostgresSkillRepository(pool);
  const materialRepository = createPostgresMaterialRepository(pool);
  const trainingRepository = createPostgresTrainingRepository(pool);

  return {
    authRepository,
    organizationRepository,
    skillRepository,
    materialRepository,
    trainingRepository,
    db,
    pool,
    readinessProbe,
    close: () => pool.end(),
  };
};

export * from "./readiness";
export * from "./schema";
export * from "./auth-repository";
export * from "./organization-repository";
export * from "./skill-repository";
export * from "./material-repository";
export * from "./training-repository";
