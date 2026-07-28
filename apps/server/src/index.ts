import { parseServerConfig } from "@jineng/skill-matrix-config";
import { createDatabase } from "@jineng/skill-matrix-db";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createApp } from "./app";
import { createAuthService } from "./auth-service";
import { createOrganizationService } from "./organization-service";
import { createSkillService } from "./skill-service";
import { createMaterialService } from "./material-service";
import { createFilesystemMaterialStorage } from "./material-storage";

const config = parseServerConfig(process.env);
const database = createDatabase(config);
const authService = createAuthService({
  repository: database.authRepository,
  password: {
    hash: (value) =>
      Bun.password.hash(value, {
        algorithm: "argon2id",
        memoryCost: 65_536,
        timeCost: 3,
      }),
    verify: (value, hash) => Bun.password.verify(value, hash),
  },
  digest: (value) => createHash("sha256").update(value).digest("hex"),
  now: () => new Date(),
  idSource: () => randomUUID(),
  tokenSource: () => randomBytes(32).toString("base64url"),
  dummyPasswordHash: await Bun.password.hash("invalid-account-password-placeholder", {
    algorithm: "argon2id",
    memoryCost: 65_536,
    timeCost: 3,
  }),
});
const organizationService = createOrganizationService({
  repository: database.organizationRepository,
  passwordHash: (value) =>
    Bun.password.hash(value, {
      algorithm: "argon2id",
      memoryCost: 65_536,
      timeCost: 3,
    }),
  temporaryPassword: () => `Tmp-${randomBytes(12).toString("base64url")}!`,
  idSource: () => randomUUID(),
  now: () => new Date(),
});
const skillService = createSkillService({
  repository: database.skillRepository,
  idSource: () => randomUUID(),
  now: () => new Date(),
});
const materialService = createMaterialService({
  repository: database.materialRepository,
  storage: createFilesystemMaterialStorage(config.materialStorageDir),
  idSource: () => randomUUID(),
});

const app = createApp({
  appUrl: config.appUrl,
  authService,
  organizationService,
  skillService,
  materialService,
  readinessProbe: database.readinessProbe,
  secureCookie: config.appUrl.startsWith("https://"),
}).listen({
  hostname: config.host,
  port: config.port,
});

console.log(`技能矩阵 API 已启动：http://${app.server?.hostname}:${app.server?.port}`);

const shutdown = async () => {
  await database.close();
  await app.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
