import { failure, success, type ReadinessProbe } from "@jineng/skill-matrix-shared";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia, t } from "elysia";
import { isIP } from "node:net";
import type { AuthHttpService } from "./auth-contract";
import type { SessionView } from "./auth-contract";
import { createEmployeeExport, parseEmployeeWorkbook } from "./organization-excel";
import type { OrganizationService } from "./organization-service";
import { parseSkillBaselineWorkbook } from "./skill-excel";
import type { SkillService } from "./skill-service";
import type { MaterialService } from "./material-service";
import type { TrainingService } from "./training-service";

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
  departmentId: t.Optional(t.String()),
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

const employeeProfileEnvelopeResponse = t.Object({
  ok: t.Literal(true),
  data: t.Object({
    employeeId: t.String(),
    employeeNumber: t.String(),
    displayName: t.String(),
    departmentId: t.Optional(t.String()),
  }),
});

const accountSummaryResponse = t.Object({
  accountId: t.String(),
  employeeNumber: t.String(),
  displayName: t.String(),
  role: sessionDataResponse.properties.role,
  active: t.Boolean(),
  mustChangePassword: t.Boolean(),
});

const accountListEnvelopeResponse = t.Object({
  ok: t.Literal(true),
  data: t.Array(accountSummaryResponse),
});

const departmentResponse = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  active: t.Boolean(),
});

const positionResponse = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  departmentId: t.String(),
  departmentName: t.String(),
  active: t.Boolean(),
});

const employeeResponse = t.Object({
  id: t.String(),
  employeeNumber: t.String(),
  displayName: t.String(),
  departmentId: t.Optional(t.String()),
  departmentName: t.Optional(t.String()),
  positionId: t.Optional(t.String()),
  positionName: t.Optional(t.String()),
  hireDate: t.Optional(t.String()),
  phone: t.Optional(t.String()),
  role: sessionDataResponse.properties.role,
  active: t.Boolean(),
});

const organizationErrorResponses = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
  422: errorResponse,
  500: errorResponse,
  503: errorResponse,
};

type AppDependencies = {
  appUrl?: string;
  authService?: AuthHttpService;
  organizationService?: OrganizationService;
  skillService?: SkillService;
  materialService?: MaterialService;
  trainingService?: TrainingService;
  readinessProbe?: ReadinessProbe;
  secureCookie?: boolean;
};

const organizationActor = async (
  authService: AuthHttpService | undefined,
  request: Request,
): Promise<
  | { ok: true; actor: SessionView }
  | { ok: false; status: 401 | 403 | 503; code: string; message: string }
> => {
  if (!authService) {
    return { ok: false, status: 503, code: "AUTH_UNAVAILABLE", message: "登录服务暂不可用" };
  }
  const session = await authService.getSession(readSessionToken(request));
  if (!session.ok) {
    return {
      ok: false,
      status: session.error.status === 503 ? 503 : 401,
      code: session.error.code,
      message: session.error.message,
    };
  }
  if (session.data.mustChangePassword) {
    return {
      ok: false,
      status: 403,
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "首次登录必须先修改密码",
    };
  }
  return { ok: true, actor: session.data };
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
  organizationService,
  skillService,
  materialService,
  trainingService,
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
    .onError({ as: "global" }, ({ code, error, set }) => {
      if (code === "NOT_FOUND") {
        set.status = 404;
        return failure("NOT_FOUND", "接口不存在");
      }
      if (code === "VALIDATION") {
        set.status = 422;
        return failure("VALIDATION_ERROR", "请求参数无效");
      }

      console.error("unhandled API error", error);
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

        const reportedIp = request.headers.get("x-real-ip")?.trim();
        const ipAddress =
          reportedIp && reportedIp.length <= 45 && isIP(reportedIp) ? reportedIp : undefined;
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
    .get(
      "/api/employees/:employeeId/profile",
      async ({ params, request, set }) => {
        if (!authService) {
          set.status = 503;
          return failure("AUTH_UNAVAILABLE", "登录服务暂不可用");
        }
        const result = await authService.getEmployeeProfile(
          readSessionToken(request),
          params.employeeId,
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ employeeId: t.String({ format: "uuid" }) }),
        detail: {
          summary: "按角色范围读取员工档案",
          tags: ["Employees"],
        },
        response: {
          200: employeeProfileEnvelopeResponse,
          401: errorResponse,
          403: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
      },
    )
    .get(
      "/api/admin/accounts",
      async ({ request, set }) => {
        if (!authService) {
          set.status = 503;
          return failure("AUTH_UNAVAILABLE", "登录服务暂不可用");
        }
        const result = await authService.listAccounts(readSessionToken(request));
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        detail: {
          summary: "系统管理员读取账号列表",
          tags: ["Auth"],
        },
        response: {
          200: accountListEnvelopeResponse,
          401: errorResponse,
          403: errorResponse,
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
      "/api/organization/departments",
      async ({ query, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.listDepartments(
          authenticated.actor,
          query.includeInactive === "true",
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        query: t.Object({ includeInactive: t.Optional(t.String()) }),
        response: {
          200: t.Object({ ok: t.Literal(true), data: t.Array(departmentResponse) }),
          ...organizationErrorResponses,
        },
      },
    )
    .post(
      "/api/organization/departments",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.createDepartment(authenticated.actor, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          code: t.String({ minLength: 1, maxLength: 30 }),
          name: t.String({ minLength: 1, maxLength: 100 }),
        }),
        response: {
          200: t.Object({ ok: t.Literal(true), data: departmentResponse }),
          ...organizationErrorResponses,
        },
      },
    )
    .patch(
      "/api/organization/departments/:id",
      async ({ body, params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.updateDepartment(
          authenticated.actor,
          params.id,
          body,
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({ name: t.String({ minLength: 1, maxLength: 100 }) }),
        response: {
          200: t.Object({ ok: t.Literal(true), data: departmentResponse }),
          ...organizationErrorResponses,
        },
      },
    )
    .post(
      "/api/organization/departments/:id/deactivate",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.deactivateDepartment(
          authenticated.actor,
          params.id,
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/organization/positions",
      async ({ query, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.listPositions(
          authenticated.actor,
          query.includeInactive === "true",
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        query: t.Object({ includeInactive: t.Optional(t.String()) }),
        response: {
          200: t.Object({ ok: t.Literal(true), data: t.Array(positionResponse) }),
          ...organizationErrorResponses,
        },
      },
    )
    .post(
      "/api/organization/positions",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.createPosition(authenticated.actor, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          code: t.String({ minLength: 1, maxLength: 30 }),
          name: t.String({ minLength: 1, maxLength: 100 }),
          departmentId: t.String({ format: "uuid" }),
        }),
        response: {
          200: t.Object({ ok: t.Literal(true), data: positionResponse }),
          ...organizationErrorResponses,
        },
      },
    )
    .patch(
      "/api/organization/positions/:id",
      async ({ body, params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.updatePosition(
          authenticated.actor,
          params.id,
          body,
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 100 }),
          departmentId: t.String({ format: "uuid" }),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/organization/positions/:id/deactivate",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.deactivatePosition(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/organization/employees",
      async ({ query, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.listEmployees(authenticated.actor, {
          ...(query.active === "true"
            ? { active: true }
            : query.active === "false"
              ? { active: false }
              : {}),
          ...(query.query ? { query: query.query } : {}),
        });
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        query: t.Object({
          active: t.Optional(t.String()),
          query: t.Optional(t.String({ maxLength: 100 })),
        }),
        response: {
          200: t.Object({ ok: t.Literal(true), data: t.Array(employeeResponse) }),
          ...organizationErrorResponses,
        },
      },
    )
    .get(
      "/api/organization/employees/:id/assignments",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.listAssignments(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/organization/employees",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.createEmployee(authenticated.actor, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          employeeNumber: t.String({ minLength: 1, maxLength: 50 }),
          displayName: t.String({ minLength: 1, maxLength: 100 }),
          departmentCode: t.String({ minLength: 1, maxLength: 30 }),
          positionCode: t.String({ minLength: 1, maxLength: 30 }),
          hireDate: t.Optional(t.String()),
          phone: t.Optional(t.String({ maxLength: 30 })),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .patch(
      "/api/organization/employees/:id",
      async ({ body, params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.updateEmployee(
          authenticated.actor,
          params.id,
          body,
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          displayName: t.String({ minLength: 1, maxLength: 100 }),
          hireDate: t.Optional(t.String()),
          phone: t.Optional(t.String({ maxLength: 30 })),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/organization/employees/:id/assignment",
      async ({ body, params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.changeAssignment(
          authenticated.actor,
          params.id,
          body,
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          departmentId: t.String({ format: "uuid" }),
          positionId: t.String({ format: "uuid" }),
          reason: t.String({ minLength: 1, maxLength: 300 }),
          effectiveAt: t.Optional(t.String()),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/organization/employees/:id/deactivate",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.deactivateEmployee(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/organization/employees/import/dry-run",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        let rows;
        try {
          rows = await parseEmployeeWorkbook(await body.file.arrayBuffer());
        } catch (error) {
          set.status = 400;
          return failure("INVALID_WORKBOOK", `Excel 文件无法读取：${String(error)}`);
        }
        const result = await organizationService.dryRunImport(authenticated.actor, rows);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({ file: t.File({ maxSize: "10m" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/organization/employees/import/:previewId/confirm",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.confirmImport(
          authenticated.actor,
          params.previewId,
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ previewId: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/organization/employees/export.xlsx",
      async ({ query, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!organizationService) {
          set.status = 503;
          return failure("ORGANIZATION_UNAVAILABLE", "组织服务暂不可用");
        }
        const result = await organizationService.exportEmployees(authenticated.actor, {
          ...(query.active === "true"
            ? { active: true }
            : query.active === "false"
              ? { active: false }
              : {}),
          ...(query.query ? { query: query.query } : {}),
        });
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        const workbook = await createEmployeeExport(result.data);
        return new Response(workbook, {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": "attachment; filename=employees.xlsx",
          },
        });
      },
      {
        query: t.Object({
          active: t.Optional(t.String()),
          query: t.Optional(t.String({ maxLength: 100 })),
        }),
      },
    )
    .get(
      "/api/skills",
      async ({ query, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        const result = await skillService.listSkills(authenticated.actor, {
          includeInactive: query.includeInactive === "true",
          ...(query.query ? { query: query.query } : {}),
        });
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        query: t.Object({
          includeInactive: t.Optional(t.String()),
          query: t.Optional(t.String({ maxLength: 100 })),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/skills",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        const result = await skillService.createSkill(authenticated.actor, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          code: t.String({ maxLength: 30 }),
          name: t.String({ maxLength: 100 }),
          category: t.Union([t.Literal("general"), t.Literal("professional"), t.Literal("core")]),
          reassessmentRequired: t.Boolean(),
          validityMonths: t.Optional(t.Integer({ minimum: 1, maximum: 120 })),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .patch(
      "/api/skills/:id",
      async ({ body, params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        const result = await skillService.updateSkill(authenticated.actor, params.id, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.String({ maxLength: 100 }),
          category: t.Union([t.Literal("general"), t.Literal("professional"), t.Literal("core")]),
          reassessmentRequired: t.Boolean(),
          validityMonths: t.Optional(t.Integer({ minimum: 1, maximum: 120 })),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/skills/:id/deactivate",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        const result = await skillService.deactivateSkill(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/position-skill-requirements",
      async ({ query, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        const result = await skillService.listRequirements(authenticated.actor, query.positionId);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        query: t.Object({ positionId: t.Optional(t.String({ format: "uuid" })) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .put(
      "/api/position-skill-requirements",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        const result = await skillService.saveRequirement(authenticated.actor, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          positionId: t.String({ format: "uuid" }),
          skillId: t.String({ format: "uuid" }),
          requiredLevel: t.Integer({ minimum: 0, maximum: 4 }),
          required: t.Boolean(),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/position-skill-requirements/copy",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        const result = await skillService.copyRequirements(authenticated.actor, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          sourcePositionId: t.String({ format: "uuid" }),
          targetPositionId: t.String({ format: "uuid" }),
          levelDelta: t.Integer({ minimum: -4, maximum: 4 }),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/skill-baselines/import/dry-run",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        let rows;
        try {
          rows = await parseSkillBaselineWorkbook(await body.file.arrayBuffer());
        } catch (error) {
          set.status = 400;
          return failure("INVALID_WORKBOOK", `Excel 文件无法读取：${String(error)}`);
        }
        const result = await skillService.dryRunBaseline(authenticated.actor, rows);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({ file: t.File({ maxSize: "10m" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/skill-baselines/import/:previewId/confirm",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        const result = await skillService.confirmBaseline(authenticated.actor, params.previewId);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ previewId: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/skill-matrix",
      async ({ query, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!skillService) {
          set.status = 503;
          return failure("SKILL_SERVICE_UNAVAILABLE", "技能服务暂不可用");
        }
        const result = await skillService.matrix(authenticated.actor, query);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        query: t.Object({
          departmentId: t.Optional(t.String({ format: "uuid" })),
          employeeId: t.Optional(t.String({ format: "uuid" })),
          positionId: t.Optional(t.String({ format: "uuid" })),
          skillId: t.Optional(t.String({ format: "uuid" })),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/training-materials",
      async ({ query, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!materialService) {
          set.status = 503;
          return failure("MATERIAL_SERVICE_UNAVAILABLE", "培训资料服务暂不可用");
        }
        const result = await materialService.list(authenticated.actor, {
          includeInactive: query.includeInactive === "true",
          ...(query.query ? { query: query.query } : {}),
        });
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        query: t.Object({
          includeInactive: t.Optional(t.String()),
          query: t.Optional(t.String({ maxLength: 100 })),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/training-materials/link",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!materialService) {
          set.status = 503;
          return failure("MATERIAL_SERVICE_UNAVAILABLE", "培训资料服务暂不可用");
        }
        const result = await materialService.createLink(authenticated.actor, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          title: t.String({ maxLength: 150 }),
          category: t.String({ maxLength: 80 }),
          description: t.Optional(t.String({ maxLength: 500 })),
          externalUrl: t.String({ maxLength: 2000 }),
          skillIds: t.Array(t.String({ format: "uuid" }), { minItems: 1 }),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/training-materials/upload",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!materialService) {
          set.status = 503;
          return failure("MATERIAL_SERVICE_UNAVAILABLE", "培训资料服务暂不可用");
        }
        let skillIds: string[];
        try {
          skillIds = Array.isArray(body.skillIds)
            ? body.skillIds
            : (JSON.parse(body.skillIds) as string[]);
        } catch {
          set.status = 400;
          return failure("INVALID_SKILLS", "关联技能格式无效");
        }
        const result = await materialService.upload(authenticated.actor, {
          title: body.title,
          category: body.category,
          ...(body.description ? { description: body.description } : {}),
          skillIds,
          filename: body.file.name,
          mimeType: body.file.type,
          bytes: new Uint8Array(await body.file.arrayBuffer()),
        });
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          title: t.String({ maxLength: 150 }),
          category: t.String({ maxLength: 80 }),
          description: t.Optional(t.String({ maxLength: 500 })),
          skillIds: t.Union([t.String(), t.Array(t.String({ format: "uuid" }), { minItems: 1 })]),
          file: t.File({ maxSize: "25m" }),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .patch(
      "/api/training-materials/:id",
      async ({ body, params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!materialService) {
          set.status = 503;
          return failure("MATERIAL_SERVICE_UNAVAILABLE", "培训资料服务暂不可用");
        }
        const result = await materialService.update(authenticated.actor, params.id, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          title: t.String({ maxLength: 150 }),
          category: t.String({ maxLength: 80 }),
          description: t.Optional(t.String({ maxLength: 500 })),
          skillIds: t.Array(t.String({ format: "uuid" }), { minItems: 1 }),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/training-materials/:id/deactivate",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!materialService) {
          set.status = 503;
          return failure("MATERIAL_SERVICE_UNAVAILABLE", "培训资料服务暂不可用");
        }
        const result = await materialService.deactivate(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/training-materials/:id/content",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!materialService) {
          set.status = 503;
          return failure("MATERIAL_SERVICE_UNAVAILABLE", "培训资料服务暂不可用");
        }
        const result = await materialService.content(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        if (result.data.kind === "link") return Response.redirect(result.data.url, 302);
        return new Response(result.data.bytes.slice().buffer as ArrayBuffer, {
          headers: {
            "content-type": result.data.mimeType,
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.data.filename)}`,
            "x-content-type-options": "nosniff",
          },
        });
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/training-plans",
      async ({ request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.listPlans(authenticated.actor);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      { response: { 200: t.Any(), ...organizationErrorResponses } },
    )
    .post(
      "/api/training-plans",
      async ({ body, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.createPlan(authenticated.actor, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        body: t.Object({
          title: t.String({ maxLength: 150 }),
          materialId: t.String({ format: "uuid" }),
          ownerEmployeeId: t.String({ format: "uuid" }),
          startAt: t.String(),
          dueAt: t.String(),
          location: t.String({ maxLength: 150 }),
          scopeType: t.Union([
            t.Literal("department"),
            t.Literal("position"),
            t.Literal("employees"),
          ]),
          scopeDepartmentId: t.Optional(t.String({ format: "uuid" })),
          scopePositionId: t.Optional(t.String({ format: "uuid" })),
          scopeEmployeeIds: t.Optional(t.Array(t.String({ format: "uuid" }))),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .patch(
      "/api/training-plans/:id",
      async ({ body, params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.updatePlan(authenticated.actor, params.id, body);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          title: t.String({ maxLength: 150 }),
          materialId: t.String({ format: "uuid" }),
          ownerEmployeeId: t.String({ format: "uuid" }),
          startAt: t.String(),
          dueAt: t.String(),
          location: t.String({ maxLength: 150 }),
          scopeType: t.Union([
            t.Literal("department"),
            t.Literal("position"),
            t.Literal("employees"),
          ]),
          scopeDepartmentId: t.Optional(t.String({ format: "uuid" })),
          scopePositionId: t.Optional(t.String({ format: "uuid" })),
          scopeEmployeeIds: t.Optional(t.Array(t.String({ format: "uuid" }))),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/training-plans/:id/publish",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.publishPlan(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/training-plans/:id/cancel",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.cancelPlan(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/training-tasks",
      async ({ request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.listTasks(authenticated.actor);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      { response: { 200: t.Any(), ...organizationErrorResponses } },
    )
    .post(
      "/api/training-tasks/:id/submit",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.submitTask(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/training-tasks/:id/confirm",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.confirmTask(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/training-tasks/:id/return",
      async ({ body, params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.returnTask(
          authenticated.actor,
          params.id,
          body.reason,
        );
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({ reason: t.String({ maxLength: 500 }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .post(
      "/api/training-plans/:id/batch-confirm",
      async ({ body, params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        let taskIds: string[];
        try {
          taskIds = Array.isArray(body.taskIds)
            ? body.taskIds
            : (JSON.parse(body.taskIds) as string[]);
        } catch {
          set.status = 400;
          return failure("INVALID_TASKS", "参训员工格式无效");
        }
        if (
          !Array.isArray(taskIds) ||
          taskIds.length === 0 ||
          taskIds.some(
            (id) =>
              typeof id !== "string" ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                id,
              ),
          )
        ) {
          set.status = 400;
          return failure("INVALID_TASKS", "参训员工格式无效");
        }
        const result = await trainingService.batchConfirm(authenticated.actor, {
          planId: params.id,
          taskIds,
          filename: body.file.name,
          mimeType: body.file.type,
          bytes: new Uint8Array(await body.file.arrayBuffer()),
        });
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return success(result.data);
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          taskIds: t.Union([t.String(), t.Array(t.String({ format: "uuid" }), { minItems: 1 })]),
          file: t.File({ maxSize: "25m" }),
        }),
        response: { 200: t.Any(), ...organizationErrorResponses },
      },
    )
    .get(
      "/api/training-evidence/:id/content",
      async ({ params, request, set }) => {
        const authenticated = await organizationActor(authService, request);
        if (!authenticated.ok) {
          set.status = authenticated.status;
          return failure(authenticated.code, authenticated.message);
        }
        if (!trainingService) {
          set.status = 503;
          return failure("TRAINING_SERVICE_UNAVAILABLE", "培训计划服务暂不可用");
        }
        const result = await trainingService.evidenceContent(authenticated.actor, params.id);
        if (!result.ok) {
          set.status = result.error.status;
          return failure(result.error.code, result.error.message);
        }
        return new Response(result.data.bytes.slice().buffer as ArrayBuffer, {
          headers: {
            "content-type": result.data.mimeType,
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.data.filename)}`,
            "x-content-type-options": "nosniff",
          },
        });
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: t.Any(), ...organizationErrorResponses },
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
