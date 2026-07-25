import { failure, success, type ReadinessProbe } from "@jineng/skill-matrix-shared";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia, t } from "elysia";

const healthResponse = t.Object({
  ok: t.Literal(true),
  data: t.Object({
    service: t.Literal("skill-matrix-server"),
    status: t.Literal("healthy"),
  }),
});

const readyResponse = t.Object({
  ok: t.Literal(true),
  data: t.Object({
    service: t.Literal("skill-matrix-server"),
    status: t.Literal("ready"),
    database: t.Literal("reachable"),
    migrations: t.Literal("current"),
  }),
});

const errorResponse = t.Object({
  ok: t.Literal(false),
  error: t.Object({
    code: t.String(),
    message: t.String(),
  }),
});

type AppDependencies = {
  appUrl?: string;
  readinessProbe?: ReadinessProbe;
};

const defaultReadinessProbe: ReadinessProbe = async () => ({
  ok: false,
  reason: "database-unavailable",
  message: "数据库就绪检查尚未配置",
});

export const createApp = ({
  appUrl = "http://localhost:3101",
  readinessProbe = defaultReadinessProbe,
}: AppDependencies = {}) =>
  new Elysia()
    .use(
      openapi({
        path: "/openapi",
        documentation: {
          info: {
            title: "技能矩阵系统 API",
            version: "0.1.0",
          },
        },
      }),
    )
    .use(
      cors({
        credentials: true,
        origin: appUrl,
      }),
    )
    .get(
      "/api/health",
      () =>
        success({
          service: "skill-matrix-server" as const,
          status: "healthy" as const,
        }),
      {
        detail: {
          summary: "进程健康检查",
          tags: ["System"],
        },
        response: {
          200: healthResponse,
        },
      },
    )
    .get(
      "/api/ready",
      async ({ set }) => {
        const result = await readinessProbe();
        if (!result.ok) {
          set.status = 503;
          const code =
            result.reason === "database-unavailable"
              ? "DATABASE_UNAVAILABLE"
              : "MIGRATION_MISMATCH";
          return failure(code, result.message);
        }

        return success({
          service: "skill-matrix-server" as const,
          status: "ready" as const,
          database: "reachable" as const,
          migrations: "current" as const,
        });
      },
      {
        detail: {
          summary: "数据库及迁移就绪检查",
          tags: ["System"],
        },
        response: {
          200: readyResponse,
          503: errorResponse,
        },
      },
    );
