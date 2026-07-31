import { parseServerConfig } from "@jineng/skill-matrix-config";
import { createDatabase } from "@jineng/skill-matrix-db";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createApp } from "./app";
import { createAuthService } from "./auth-service";
import { createOrganizationService } from "./organization-service";
import { createSkillService } from "./skill-service";
import { createMaterialService } from "./material-service";
import { createConfiguredMaterialStorage } from "./material-storage-factory";
import { createTrainingService } from "./training-service";
import { createAssessmentService } from "./assessment-service";
import { createNotificationService } from "./notification-service";
import { createReportService } from "./report-service";
import { createAuditService } from "./audit-service";

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
const materialStorage = createConfiguredMaterialStorage(config);
const materialService = createMaterialService({
  repository: database.materialRepository,
  storage: materialStorage,
  idSource: () => randomUUID(),
});
const trainingService = createTrainingService({
  repository: database.trainingRepository,
  storage: materialStorage,
  idSource: () => randomUUID(),
  now: () => new Date(),
});
const assessmentService = createAssessmentService({
  repository: database.assessmentRepository,
  storage: materialStorage,
  idSource: () => randomUUID(),
  now: () => new Date(),
});
const notificationService = createNotificationService({
  repository: database.notificationRepository,
  now: () => new Date(),
});
const reportService = createReportService({
  repository: database.reportRepository,
  now: () => new Date(),
});
const auditService = createAuditService(database.auditRepository);

const app = createApp({
  appUrl: config.appUrl,
  authService,
  organizationService,
  skillService,
  materialService,
  trainingService,
  assessmentService,
  notificationService,
  reportService,
  auditService,
  readinessProbe: database.readinessProbe,
  secureCookie: config.appUrl.startsWith("https://"),
}).listen({
  hostname: config.host,
  port: config.port,
});

console.log(`技能矩阵 API 已启动：http://${app.server?.hostname}:${app.server?.port}`);

const notificationTimer = setInterval(
  () =>
    void notificationService.runScheduled().catch((error) => console.error("通知任务失败", error)),
  60_000,
);
void notificationService.runScheduled().catch((error) => console.error("通知任务失败", error));

const shutdown = async () => {
  clearInterval(notificationTimer);
  await database.close();
  await app.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
