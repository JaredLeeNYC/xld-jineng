import { z } from "zod";

const serverConfigSchema = z.object({
  APP_URL: z.url().default("http://localhost:3101"),
  DATABASE_URL: z
    .url()
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "DATABASE_URL 必须使用 PostgreSQL 协议",
    })
    .default("postgres://skill_matrix:skill_matrix_dev@localhost:5433/skill_matrix"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  MATERIAL_STORAGE_DIR: z.string().min(1).default(".data/materials"),
});

export type ServerConfig = {
  appUrl: string;
  databaseUrl: string;
  host: string;
  port: number;
  materialStorageDir: string;
};

export const parseServerConfig = (
  environment: Record<string, string | undefined>,
): ServerConfig => {
  const parsed = serverConfigSchema.parse(environment);
  return {
    appUrl: parsed.APP_URL,
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.HOST,
    port: parsed.PORT,
    materialStorageDir: parsed.MATERIAL_STORAGE_DIR,
  };
};
