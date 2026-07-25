import { hasPermission, type FixedRole, type Permission } from "@jineng/skill-matrix-shared";
import type { AuthFailure, AuthHttpService, SessionView } from "./auth-contract";

export type AuthAccount = {
  id: string;
  employeeId: string;
  employeeNumber: string;
  displayName: string;
  departmentId?: string;
  role: FixedRole;
  passwordHash: string;
  mustChangePassword: boolean;
  active: boolean;
  sessionVersion: number;
};

export type StoredSession = {
  id: string;
  accountId: string;
  tokenHash: string;
  sessionVersion: number;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
};

export type SecurityEventInput = {
  type: string;
  accountId?: string;
  identifierHash?: string;
  ipAddress?: string;
  userAgent?: string;
  detail?: Record<string, unknown>;
};

export type AuthRepository = {
  findAccountByEmployeeNumber: (employeeNumber: string) => Promise<AuthAccount | undefined>;
  findLoginThrottle: (
    identifierHash: string,
  ) => Promise<{ failures: number; lockedUntil?: Date } | undefined>;
  registerLoginFailure: (input: {
    identifierHash: string;
    accountId?: string;
    now: Date;
    lockAfter: number;
    lockUntil: Date;
  }) => Promise<{ failures: number; lockedUntil?: Date }>;
  completeLogin: (input: {
    accountId: string;
    identifierHash: string;
    session: StoredSession;
  }) => Promise<void>;
  findSessionByTokenHash: (
    tokenHash: string,
  ) => Promise<{ account: AuthAccount; session: StoredSession } | undefined>;
  changePasswordAndRotateSession: (input: {
    accountId: string;
    passwordHash: string;
    session: StoredSession;
  }) => Promise<AuthAccount>;
  revokeSession: (tokenHash: string, revokedAt: Date) => Promise<void>;
  resetPassword: (input: {
    accountId: string;
    passwordHash: string;
    revokedAt: Date;
  }) => Promise<AuthAccount | undefined>;
  clearLoginThrottle: (identifierHash: string) => Promise<void>;
  recordSecurityEvent: (input: SecurityEventInput) => Promise<void>;
};

type PasswordProvider = {
  hash: (value: string) => Promise<string>;
  verify: (value: string, hash: string) => Promise<boolean>;
};

type AuthServiceDependencies = {
  repository: AuthRepository;
  password: PasswordProvider;
  digest: (value: string) => string;
  now: () => Date;
  idSource: () => string;
  tokenSource: () => string;
  dummyPasswordHash: string;
};

type ActionSuccess<T> = { ok: true; data: T };
type ActionResult<T> = ActionSuccess<T> | AuthFailure;

const authFailure = (
  code: string,
  message: string,
  status: AuthFailure["error"]["status"],
): AuthFailure => ({
  ok: false,
  error: { code, message, status },
});

const unauthenticated = () => authFailure("UNAUTHENTICATED", "请先登录", 401);

const sessionView = (account: AuthAccount): SessionView => ({
  accountId: account.id,
  employeeId: account.employeeId,
  employeeNumber: account.employeeNumber,
  displayName: account.displayName,
  role: account.role,
  mustChangePassword: account.mustChangePassword,
});

const normalizeEmployeeNumber = (employeeNumber: string) => employeeNumber.trim().toUpperCase();

const passwordIsValid = (password: string) => password.length >= 12 && password.length <= 200;

export const createAuthService = ({
  repository,
  password,
  digest,
  now,
  idSource,
  tokenSource,
  dummyPasswordHash,
}: AuthServiceDependencies) => {
  const createSession = (account: AuthAccount) => {
    const createdAt = now();
    const id = idSource();
    const token = tokenSource();
    const stored: StoredSession = {
      id,
      accountId: account.id,
      tokenHash: digest(token),
      sessionVersion: account.sessionVersion,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
    };
    return { token, stored };
  };

  const authenticate = async (
    token: string | undefined,
  ): Promise<{ ok: true; account: AuthAccount; session: StoredSession } | AuthFailure> => {
    if (!token) return unauthenticated();
    const found = await repository.findSessionByTokenHash(digest(token));
    if (
      !found ||
      !found.account.active ||
      found.session.revokedAt ||
      found.session.expiresAt <= now() ||
      found.session.sessionVersion !== found.account.sessionVersion
    ) {
      return unauthenticated();
    }
    return { ok: true, ...found };
  };

  const service = {
    async login(
      input: { employeeNumber: string; password: string },
      context: { ipAddress?: string; userAgent?: string } = {},
    ) {
      const employeeNumber = normalizeEmployeeNumber(input.employeeNumber);
      const identifierHash = digest(employeeNumber);
      const throttle = await repository.findLoginThrottle(identifierHash);
      if (throttle?.lockedUntil && throttle.lockedUntil > now()) {
        await repository.recordSecurityEvent({
          type: "login_locked",
          identifierHash,
          ...context,
        });
        return authFailure("ACCOUNT_TEMPORARILY_LOCKED", "登录失败次数过多，请稍后再试", 423);
      }

      const account = await repository.findAccountByEmployeeNumber(employeeNumber);
      const passwordMatches = await password.verify(
        input.password,
        account?.passwordHash ?? dummyPasswordHash,
      );
      if (!account?.active || !passwordMatches) {
        const failureState = await repository.registerLoginFailure({
          identifierHash,
          ...(account ? { accountId: account.id } : {}),
          now: now(),
          lockAfter: 5,
          lockUntil: new Date(now().getTime() + 15 * 60 * 1000),
        });
        await repository.recordSecurityEvent({
          type: "login_failed",
          ...(account ? { accountId: account.id } : {}),
          identifierHash,
          ...context,
        });
        return failureState.lockedUntil
          ? authFailure("ACCOUNT_TEMPORARILY_LOCKED", "登录失败次数过多，请稍后再试", 423)
          : authFailure("INVALID_CREDENTIALS", "工号或密码错误", 401);
      }

      const { token, stored } = createSession(account);
      await repository.completeLogin({
        accountId: account.id,
        identifierHash,
        session: stored,
      });
      await repository.recordSecurityEvent({
        type: "login_succeeded",
        accountId: account.id,
        identifierHash,
        ...context,
      });
      return {
        ok: true as const,
        data: {
          session: sessionView(account),
          token,
          expiresAt: stored.expiresAt,
        },
      };
    },

    async getSession(token: string | undefined): Promise<ActionResult<SessionView>> {
      const authenticated = await authenticate(token);
      if (!authenticated.ok) return authenticated;
      return { ok: true, data: sessionView(authenticated.account) };
    },

    async authorize(
      token: string | undefined,
      permission: Permission,
    ): Promise<ActionResult<SessionView>> {
      const authenticated = await authenticate(token);
      if (!authenticated.ok) return authenticated;
      if (authenticated.account.mustChangePassword) {
        return authFailure("PASSWORD_CHANGE_REQUIRED", "首次登录必须先修改密码", 403);
      }
      if (!hasPermission(authenticated.account.role, permission)) {
        await repository.recordSecurityEvent({
          type: "forbidden",
          accountId: authenticated.account.id,
          detail: { permission },
        });
        return authFailure("FORBIDDEN", "无权执行此操作", 403);
      }
      return { ok: true, data: sessionView(authenticated.account) };
    },

    async authorizeEmployeeAccess(
      token: string | undefined,
      target: {
        employeeId: string;
        departmentId?: string;
        access: "read" | "write";
      },
    ): Promise<ActionResult<SessionView>> {
      const authenticated = await authenticate(token);
      if (!authenticated.ok) return authenticated;
      if (authenticated.account.mustChangePassword) {
        return authFailure(
          "PASSWORD_CHANGE_REQUIRED",
          "首次登录必须先修改密码",
          403,
        );
      }

      const account = authenticated.account;
      const allowed =
        (account.role === "employee" &&
          target.employeeId === account.employeeId) ||
        (account.role === "department_manager" &&
          Boolean(account.departmentId) &&
          target.departmentId === account.departmentId) ||
        account.role === "hr_admin" ||
        ((account.role === "executive_viewer" ||
          account.role === "system_admin") &&
          target.access === "read");

      if (!allowed) {
        await repository.recordSecurityEvent({
          type: "forbidden",
          accountId: account.id,
          detail: {
            targetEmployeeId: target.employeeId,
            access: target.access,
          },
        });
        return authFailure("FORBIDDEN", "无权访问该员工数据", 403);
      }
      return { ok: true, data: sessionView(account) };
    },

    async changePassword(
      token: string | undefined,
      input: { currentPassword: string; newPassword: string },
    ): Promise<ActionResult<{ session: SessionView; token: string; expiresAt: Date }>> {
      const authenticated = await authenticate(token);
      if (!authenticated.ok) return authenticated;
      const currentMatches = await password.verify(
        input.currentPassword,
        authenticated.account.passwordHash,
      );
      if (!currentMatches) {
        return authFailure("INVALID_CURRENT_PASSWORD", "当前密码不正确", 401);
      }
      if (!passwordIsValid(input.newPassword) || input.newPassword === input.currentPassword) {
        return authFailure("WEAK_PASSWORD", "新密码至少 12 位且不能与当前密码相同", 409);
      }

      const passwordHash = await password.hash(input.newPassword);
      const nextAccount = {
        ...authenticated.account,
        mustChangePassword: false,
        sessionVersion: authenticated.account.sessionVersion + 1,
      };
      const { token: nextToken, stored } = createSession(nextAccount);
      const updatedAccount = await repository.changePasswordAndRotateSession({
        accountId: authenticated.account.id,
        passwordHash,
        session: stored,
      });
      await repository.recordSecurityEvent({
        type: "password_changed",
        accountId: authenticated.account.id,
      });
      return {
        ok: true,
        data: {
          session: sessionView(updatedAccount),
          token: nextToken,
          expiresAt: stored.expiresAt,
        },
      };
    },

    async logout(token: string | undefined): Promise<ActionSuccess<{ loggedOut: true }>> {
      if (token) {
        await repository.revokeSession(digest(token), now());
      }
      return { ok: true, data: { loggedOut: true } };
    },

    async resetPassword(
      actorToken: string | undefined,
      accountId: string,
      temporaryPassword: string,
    ): Promise<ActionResult<{ accountId: string; mustChangePassword: true }>> {
      const authorized = await service.authorize(actorToken, "system:manage");
      if (!authorized.ok) return authorized;
      if (!passwordIsValid(temporaryPassword)) {
        return authFailure("WEAK_PASSWORD", "临时密码至少需要 12 位", 409);
      }
      const updated = await repository.resetPassword({
        accountId,
        passwordHash: await password.hash(temporaryPassword),
        revokedAt: now(),
      });
      if (!updated) {
        return authFailure("ACCOUNT_NOT_FOUND", "账号不存在", 409);
      }
      await repository.clearLoginThrottle(digest(updated.employeeNumber));
      await repository.recordSecurityEvent({
        type: "password_reset",
        accountId,
        detail: { actorAccountId: authorized.data.accountId },
      });
      return {
        ok: true,
        data: { accountId, mustChangePassword: true },
      };
    },
  } satisfies AuthHttpService & {
    getSession: (token: string | undefined) => Promise<ActionResult<SessionView>>;
    authorize: (
      token: string | undefined,
      permission: Permission,
    ) => Promise<ActionResult<SessionView>>;
    authorizeEmployeeAccess: (
      token: string | undefined,
      target: {
        employeeId: string;
        departmentId?: string;
        access: "read" | "write";
      },
    ) => Promise<ActionResult<SessionView>>;
    changePassword: (
      token: string | undefined,
      input: { currentPassword: string; newPassword: string },
    ) => Promise<ActionResult<{ session: SessionView; token: string; expiresAt: Date }>>;
    logout: (token: string | undefined) => Promise<ActionSuccess<{ loggedOut: true }>>;
    resetPassword: (
      actorToken: string | undefined,
      accountId: string,
      temporaryPassword: string,
    ) => Promise<ActionResult<{ accountId: string; mustChangePassword: true }>>;
  };

  return service;
};

export type AuthService = ReturnType<typeof createAuthService>;
