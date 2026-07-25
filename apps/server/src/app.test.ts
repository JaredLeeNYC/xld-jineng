import { describe, expect, test } from "bun:test";
import { createApp } from "./app";

describe("system HTTP API", () => {
  test("reports process health through the public API envelope", async () => {
    const response = await createApp().handle(new Request("http://localhost/api/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        service: "skill-matrix-server",
        status: "healthy",
      },
    });
  });

  test("reports database and migration readiness", async () => {
    const response = await createApp({
      readinessProbe: async () => ({ ok: true }),
    }).handle(new Request("http://localhost/api/ready"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        service: "skill-matrix-server",
        status: "ready",
        database: "reachable",
        migrations: "current",
      },
    });
  });

  test("distinguishes database failures from migration failures", async () => {
    const databaseResponse = await createApp({
      readinessProbe: async () => ({
        ok: false,
        reason: "database-unavailable",
        message: "数据库暂不可用",
      }),
    }).handle(new Request("http://localhost/api/ready"));
    const migrationResponse = await createApp({
      readinessProbe: async () => ({
        ok: false,
        reason: "migration-mismatch",
        message: "数据库结构未升级到当前版本",
      }),
    }).handle(new Request("http://localhost/api/ready"));

    expect(databaseResponse.status).toBe(503);
    expect(await databaseResponse.json()).toEqual({
      ok: false,
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "数据库暂不可用",
      },
    });
    expect(migrationResponse.status).toBe(503);
    expect(await migrationResponse.json()).toEqual({
      ok: false,
      error: {
        code: "MIGRATION_MISMATCH",
        message: "数据库结构未升级到当前版本",
      },
    });
  });

  test("publishes the OpenAPI contract", async () => {
    const response = await createApp().handle(new Request("http://localhost/openapi/json"));
    const specification = (await response.json()) as {
      info: { title: string };
      paths: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(specification.info.title).toBe("技能矩阵系统 API");
    expect(specification.paths["/api/health"]).toBeDefined();
    expect(specification.paths["/api/ready"]).toBeDefined();
  });
});
