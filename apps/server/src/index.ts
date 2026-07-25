import { parseServerConfig } from "@jineng/skill-matrix-config";
import { createDatabase } from "@jineng/skill-matrix-db";
import { createApp } from "./app";

const config = parseServerConfig(process.env);
const database = createDatabase(config);

const app = createApp({
  appUrl: config.appUrl,
  readinessProbe: database.readinessProbe,
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
