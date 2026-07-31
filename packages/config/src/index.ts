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
  MATERIAL_STORAGE_PROVIDER: z.enum(["filesystem", "cos"]).default("filesystem"),
  COS_BUCKET: z.string().min(1).optional(),
  COS_REGION: z.string().min(1).default("ap-guangzhou"),
  COS_OBJECT_PREFIX: z.string().min(1).default("skill-matrix/"),
  COS_SECRET_ID: z.string().min(1).optional(),
  COS_SECRET_KEY: z.string().min(1).optional(),
});

export type ServerConfig = {
  appUrl: string;
  databaseUrl: string;
  host: string;
  port: number;
  materialStorageDir: string;
  materialStorageProvider: "filesystem" | "cos";
  cosBucket?: string;
  cosRegion?: string;
  cosObjectPrefix?: string;
  cosSecretId?: string;
  cosSecretKey?: string;
};

export const parseServerConfig = (
  environment: Record<string, string | undefined>,
): ServerConfig => {
  const parsed = serverConfigSchema.parse(environment);
  if (parsed.MATERIAL_STORAGE_PROVIDER === "cos") {
    if (!parsed.COS_BUCKET || !parsed.COS_SECRET_ID || !parsed.COS_SECRET_KEY) {
      throw new Error(
        "COS_STORAGE_CONFIGURATION_MISSING: COS_BUCKET、COS_SECRET_ID、COS_SECRET_KEY 必须同时配置",
      );
    }
  }
  return {
    appUrl: parsed.APP_URL,
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.HOST,
    port: parsed.PORT,
    materialStorageDir: parsed.MATERIAL_STORAGE_DIR,
    materialStorageProvider: parsed.MATERIAL_STORAGE_PROVIDER,
    ...(parsed.MATERIAL_STORAGE_PROVIDER === "cos"
      ? {
          cosBucket: parsed.COS_BUCKET!,
          cosRegion: parsed.COS_REGION,
          cosObjectPrefix: parsed.COS_OBJECT_PREFIX,
          cosSecretId: parsed.COS_SECRET_ID!,
          cosSecretKey: parsed.COS_SECRET_KEY!,
        }
      : {}),
  };
};
