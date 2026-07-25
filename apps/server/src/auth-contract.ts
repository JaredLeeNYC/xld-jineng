import type { FixedRole } from "@jineng/skill-matrix-shared";

export type SessionView = {
  accountId: string;
  employeeId: string;
  employeeNumber: string;
  displayName: string;
  role: FixedRole;
  mustChangePassword: boolean;
};

export type AuthFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    status: 401 | 403 | 409 | 423 | 500 | 503;
  };
};

export type AuthLoginResult =
  | {
      ok: true;
      data: {
        session: SessionView;
        token: string;
        expiresAt: Date;
      };
    }
  | AuthFailure;

export type AuthActionResult<T> = { ok: true; data: T } | AuthFailure;

export type AuthHttpService = {
  login: (
    input: {
      employeeNumber: string;
      password: string;
    },
    context: {
      ipAddress?: string;
      userAgent?: string;
    },
  ) => Promise<AuthLoginResult>;
  getSession: (token: string | undefined) => Promise<AuthActionResult<SessionView>>;
  changePassword: (
    token: string | undefined,
    input: { currentPassword: string; newPassword: string },
  ) => Promise<
    AuthActionResult<{
      session: SessionView;
      token: string;
      expiresAt: Date;
    }>
  >;
  logout: (token: string | undefined) => Promise<{ ok: true; data: { loggedOut: true } }>;
  resetPassword: (
    actorToken: string | undefined,
    accountId: string,
    temporaryPassword: string,
  ) => Promise<AuthActionResult<{ accountId: string; mustChangePassword: true }>>;
};
