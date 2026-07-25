import { failure, success, type ReadinessProbe } from "@jineng/skill-matrix-shared";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia, t } from "elysia";
import type { AuthHttpService } from "./auth-contract";

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

const sessionDataResponse = t.Object({
  accountId: t.String(),
  employeeId: t.String(),
  employeeNumber: t.String(),
  displayName: t.String(),
  role: t.Union([
    t.Literal("employee"),
    t.Literal("department_manager"),
    t.Literal("hr_admin"),
    t.Literal("executive_viewer"),
    t.Literal("system_admin"),
  ]),
  mustChangePassword: t.Boolean(),
});

const sessionEnvelopeResponse = t.Object({
  ok: t.Literal(true),
  data: sessionDataResponse,
});

const logoutEnvelopeResponse = t.Object({
  ok: t.Literal(true),
  data: t.Object({ loggedOut: t.Literal(true) }),
});

const resetPasswordEnvelopeResponse = t.Object({
  ok: t.Literal(true),
  data: t.Object({
    accountId: t.String(),
    mustChangePassword: t.Literal(true),
  }),
});

type AppDependencies = {
  appUrl?: string;
  authService?: AuthHttpService;
  readinessProbe?: ReadinessProbe;
  secureCookie?: boolean;
};

const defaultReadinessProbe: ReadinessProbe = async () => ({
  ok: false,
  reason: "database-unavailable",
  message: "数据库就绪检查尚未配置",
});

const sessionCookieName = "skill_matrix_session";

const readSessionToken = (request: Request): string | undefined => {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === sessionCookieName) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return undefined;
};

const createSessionCookie = (token: string, expiresAt: Date, secureCookie: boolean) =>
  `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secureCookie ? "; Secure" : ""}`;

const expiredSessionCookie = (secureCookie: boolean) =>
  `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? "; Secure" : ""}`;

export const createApp = ({
  appUrl = "http://localhost:3101",
  authService,
  readinessProbe = defaultReadinessProbe,
  secureCookie = false,
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
    .onError({ as: "global" }, ({ code, set }) => {
      if (code === "NOT_FOUND") {
        set.status = 404;
        return failure("NOT_FOUND", "接口不存在");
      }
      if (code === "VALIDATION") {
        set.status = 422;
        return failure("VALIDATION_ERROR", "请求参数无效");
      }

      set.status = 500;
      return failure("INTERNAL_ERROR", "服务暂时不可用");
    })
    .post(
      "/api/auth/login",
      async ({ body, request, set }) => {
        if (!authService) {
          set.status = 503;
          return failure("AUTH_UNAVAILABLE", "登录服务暂不可用");
        }

        const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
        const userAgent = request.headers.get("user-agent") ?? undefined;
        const context = {
          ...(ipAddress ? { ipAddress } : {}),
          ...(userAgent ? { userAgent } : {}),
        };
        const result = await authService.login(body, context);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }

        set.headers["set-cookie"] = createSessionCookie(
          result.data.token,
          result.data.expiresAt,
          secureCookie,
        );
        return success(result.data.session);
      },
      {
        body: t.Object({
          employeeNumber: t.String({ minLength: 1, maxLength: 50 }),
          password: t.String({ minLength: 1, maxLength: 200 }),
        }),
        detail: {
          summary: "工号密码登录",
          tags: ["Auth"],
        },
        response: {
          200: sessionEnvelopeResponse,
          401: errorResponse,
          422: errorResponse,
          423: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
      },
    )
    .get(
      "/api/auth/session",
      async ({ request, set }) => {
        if (!authService) {
          set.status = 503;
          return failure("AUTH_UNAVAILABLE", "登录服务暂不可用");
        }
        const result = await authService.getSession(readSessionToken(request));
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        detail: {
          summary: "读取当前登录会话",
          tags: ["Auth"],
        },
        response: {
          200: sessionEnvelopeResponse,
          401: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
      },
    )
    .post(
      "/api/auth/change-password",
      async ({ body, request, set }) => {
        if (!authService) {
          set.status = 503;
          return failure("AUTH_UNAVAILABLE", "登录服务暂不可用");
        }
        const result = await authService.changePassword(readSessionToken(request), body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        set.headers["set-cookie"] = createSessionCookie(
          result.data.token,
          result.data.expiresAt,
          secureCookie,
        );
        return success(result.data.session);
      },
      {
        body: t.Object({
          currentPassword: t.String({ minLength: 1, maxLength: 200 }),
          newPassword: t.String({ minLength: 12, maxLength: 200 }),
        }),
        detail: {
          summary: "修改首次或当前密码",
          tags: ["Auth"],
        },
        response: {
          200: sessionEnvelopeResponse,
          401: errorResponse,
          409: errorResponse,
          422: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
      },
    )
    .post(
      "/api/auth/logout",
      async ({ request, set }) => {
        if (!authService) {
          set.status = 503;
          return failure("AUTH_UNAVAILABLE", "登录服务暂不可用");
        }
        const result = await authService.logout(readSessionToken(request));
        set.headers["set-cookie"] = expiredSessionCookie(secureCookie);
        return success(result.data);
      },
      {
        detail: {
          summary: "退出当前会话",
          tags: ["Auth"],
        },
        response: {
          200: logoutEnvelopeResponse,
          500: errorResponse,
          503: errorResponse,
        },
      },
    )
    .post(
      "/api/admin/accounts/:accountId/reset-password",
      async ({ body, params, request, set }) => {
        if (!authService) {
          set.status = 503;
          return failure("AUTH_UNAVAILABLE", "登录服务暂不可用");
        }
        const result = await authService.resetPassword(
          readSessionToken(request),
          params.accountId,
          body.temporaryPassword,
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          temporaryPassword: t.String({ minLength: 12, maxLength: 200 }),
        }),
        params: t.Object({
          accountId: t.String({ format: "uuid" }),
        }),
        detail: {
          summary: "系统管理员重置账号密码",
          tags: ["Auth"],
        },
        response: {
          200: resetPasswordEnvelopeResponse,
          401: errorResponse,
          403: errorResponse,
          409: errorResponse,
          422: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
      },
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
