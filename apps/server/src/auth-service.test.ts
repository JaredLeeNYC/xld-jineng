import { describe, expect, test } from "bun:test";
import {
  createAuthService,
  type AuthAccount,
  type AuthRepository,
  type StoredSession,
} from "./auth-service";

const employeeAccount = (): AuthAccount => ({
  id: "account-employee",
  employeeId: "employee-1",
  employeeNumber: "E0001",
  displayName: "张明",
  departmentId: "department-1",
  role: "employee",
  passwordHash: "hash:Initial-Password-123",
  mustChangePassword: true,
  active: true,
  sessionVersion: 1,
});

const adminAccount = (): AuthAccount => ({
  ...employeeAccount(),
  id: "account-admin",
  employeeId: "employee-admin",
  employeeNumber: "A0001",
  displayName: "系统管理员",
  role: "system_admin",
  passwordHash: "hash:Admin-Password-123",
  mustChangePassword: false,
});

class MemoryAuthRepository implements AuthRepository {
  readonly accounts = new Map<string, AuthAccount>();
  readonly employeeProfiles = new Map<
    string,
    {
      employeeId: string;
      employeeNumber: string;
      displayName: string;
      departmentId?: string;
    }
  >();
  readonly sessions = new Map<string, StoredSession>();
  readonly throttles = new Map<string, { failures: number; lockedUntil?: Date }>();
  readonly securityEvents: Array<{ type: string; accountId?: string }> = [];

  constructor(accounts: AuthAccount[]) {
    for (const account of accounts) {
      this.accounts.set(account.employeeNumber, account);
      this.employeeProfiles.set(account.employeeId, {
        employeeId: account.employeeId,
        employeeNumber: account.employeeNumber,
        displayName: account.displayName,
        ...(account.departmentId ? { departmentId: account.departmentId } : {}),
      });
    }
    this.employeeProfiles.set("employee-coworker", {
      employeeId: "employee-coworker",
      employeeNumber: "E0002",
      displayName: "同部门员工",
      departmentId: "department-1",
    });
    this.employeeProfiles.set("employee-other", {
      employeeId: "employee-other",
      employeeNumber: "E0003",
      displayName: "其他部门员工",
      departmentId: "department-2",
    });
  }

  async findAccountByEmployeeNumber(employeeNumber: string) {
    return this.accounts.get(employeeNumber);
  }

  async findAccountById(accountId: string) {
    return [...this.accounts.values()].find((account) => account.id === accountId);
  }

  async findEmployeeProfile(employeeId: string) {
    return this.employeeProfiles.get(employeeId);
  }

  async listAccounts() {
    return [...this.accounts.values()].map((account) => ({
      accountId: account.id,
      employeeNumber: account.employeeNumber,
      displayName: account.displayName,
      role: account.role,
      active: account.active,
      mustChangePassword: account.mustChangePassword,
    }));
  }

  async findLoginThrottle(identifierHash: string) {
    return this.throttles.get(identifierHash);
  }

  async registerLoginFailure(input: {
    identifierHash: string;
    accountId?: string;
    now: Date;
    lockAfter: number;
    lockUntil: Date;
    event: { type: string; accountId?: string };
  }) {
    const current = this.throttles.get(input.identifierHash);
    const failures = (current?.failures ?? 0) + 1;
    const state = {
      failures,
      ...(failures >= input.lockAfter ? { lockedUntil: input.lockUntil } : {}),
    };
    this.throttles.set(input.identifierHash, state);
    this.securityEvents.push(input.event);
    return state;
  }

  async completeLogin(input: {
    accountId: string;
    identifierHash: string;
    session: StoredSession;
    event: { type: string; accountId?: string };
  }) {
    this.throttles.delete(input.identifierHash);
    this.sessions.set(input.session.tokenHash, input.session);
    this.securityEvents.push(input.event);
  }

  async findSessionByTokenHash(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    if (!session) return undefined;
    const account = [...this.accounts.values()].find(
      (candidate) => candidate.id === session.accountId,
    );
    return account ? { account, session } : undefined;
  }

  async changePasswordAndRotateSession(input: {
    accountId: string;
    passwordHash: string;
    session: StoredSession;
    expectedSessionVersion: number;
    event: { type: string; accountId?: string };
  }) {
    const account = [...this.accounts.values()].find(
      (candidate) => candidate.id === input.accountId,
    );
    if (!account) throw new Error("missing account");
    if (account.sessionVersion !== input.expectedSessionVersion) return undefined;
    account.passwordHash = input.passwordHash;
    account.mustChangePassword = false;
    account.sessionVersion += 1;
    for (const session of this.sessions.values()) {
      if (session.accountId === account.id) {
        session.revokedAt = new Date("2026-07-25T01:00:00.000Z");
      }
    }
    input.session.sessionVersion = account.sessionVersion;
    this.sessions.set(input.session.tokenHash, input.session);
    this.securityEvents.push(input.event);
    return account;
  }

  async revokeSession(tokenHash: string, revokedAt: Date) {
    const session = this.sessions.get(tokenHash);
    if (session) session.revokedAt = revokedAt;
  }

  async resetPassword(input: {
    accountId: string;
    passwordHash: string;
    revokedAt: Date;
    identifierHash: string;
    event: { type: string; accountId?: string };
  }) {
    const account = [...this.accounts.values()].find(
      (candidate) => candidate.id === input.accountId,
    );
    if (!account) return undefined;
    account.passwordHash = input.passwordHash;
    account.mustChangePassword = true;
    account.sessionVersion += 1;
    for (const session of this.sessions.values()) {
      if (session.accountId === account.id) {
        session.revokedAt = input.revokedAt;
      }
    }
    this.throttles.delete(input.identifierHash);
    this.securityEvents.push(input.event);
    return account;
  }

  async recordSecurityEvent(input: { type: string; accountId?: string }) {
    this.securityEvents.push(input);
  }
}

const createFixture = (accounts = [employeeAccount()]) => {
  const repository = new MemoryAuthRepository(accounts);
  let sequence = 0;
  const service = createAuthService({
    repository,
    password: {
      hash: async (value) => `hash:${value}`,
      verify: async (value, hash) => hash === `hash:${value}`,
    },
    digest: (value) => `digest:${value}`,
    now: () => new Date("2026-07-25T00:00:00.000Z"),
    idSource: () => `session-${++sequence}`,
    tokenSource: () => `plain-token-${sequence}`,
    dummyPasswordHash: "hash:dummy-password",
  });
  return { repository, service };
};

describe("authentication service", () => {
  test("stores only a token digest when login succeeds", async () => {
    const { repository, service } = createFixture();

    const result = await service.login({
      employeeNumber: "e0001",
      password: "Initial-Password-123",
    });

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.data.token).toBe("plain-token-1");
    expect(result.data.session.mustChangePassword).toBeTrue();
    expect(repository.sessions.has("plain-token-1")).toBeFalse();
    expect(repository.sessions.has("digest:plain-token-1")).toBeTrue();
  });

  test("uses the same failure and lockout behavior for known and unknown numbers", async () => {
    const exercise = async (employeeNumber: string) => {
      const { service } = createFixture();
      const codes: string[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await service.login({
          employeeNumber,
          password: "wrong-password",
        });
        if (!result.ok) codes.push(result.error.code);
      }
      return codes;
    };

    expect(await exercise("E0001")).toEqual([
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "ACCOUNT_TEMPORARILY_LOCKED",
    ]);
    expect(await exercise("UNKNOWN")).toEqual([
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "ACCOUNT_TEMPORARILY_LOCKED",
    ]);
  });

  test("requires the initial password change and rotates the session", async () => {
    const { repository, service } = createFixture();
    const login = await service.login({
      employeeNumber: "E0001",
      password: "Initial-Password-123",
    });
    if (!login.ok) throw new Error("login failed");

    const blocked = await service.authorize(login.data.token, "training:self-submit");
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: "PASSWORD_CHANGE_REQUIRED" },
    });

    const changed = await service.changePassword(login.data.token, {
      currentPassword: "Initial-Password-123",
      newPassword: "Changed-Password-456",
    });
    expect(changed.ok).toBeTrue();
    if (!changed.ok) return;
    expect(changed.data.session.mustChangePassword).toBeFalse();
    expect(await service.getSession(login.data.token)).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(await service.authorize(changed.data.token, "training:self-submit")).toMatchObject({
      ok: true,
    });
    expect(repository.accounts.get("E0001")?.passwordHash).toBe("hash:Changed-Password-456");
  });

  test("records forbidden access and lets only a system admin reset passwords", async () => {
    const employee = employeeAccount();
    employee.mustChangePassword = false;
    const { repository, service } = createFixture([employee, adminAccount()]);
    const employeeLogin = await service.login({
      employeeNumber: "E0001",
      password: "Initial-Password-123",
    });
    const adminLogin = await service.login({
      employeeNumber: "A0001",
      password: "Admin-Password-123",
    });
    if (!employeeLogin.ok || !adminLogin.ok) throw new Error("login failed");

    expect(await service.authorize(employeeLogin.data.token, "factory:read")).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await service.resetPassword(
        employeeLogin.data.token,
        "account-employee",
        "Temporary-Password-999",
      ),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await service.resetPassword(
        adminLogin.data.token,
        "account-employee",
        "Temporary-Password-999",
      ),
    ).toMatchObject({ ok: true });
    expect(await service.getSession(employeeLogin.data.token)).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(repository.securityEvents.some((event) => event.type === "forbidden")).toBeTrue();
  });

  test("enforces personal, department, factory, and read-only employee scopes", async () => {
    const accounts = [
      { ...employeeAccount(), mustChangePassword: false },
      {
        ...employeeAccount(),
        id: "account-manager",
        employeeId: "employee-manager",
        employeeNumber: "M0001",
        role: "department_manager" as const,
        mustChangePassword: false,
      },
      {
        ...employeeAccount(),
        id: "account-hr",
        employeeId: "employee-hr",
        employeeNumber: "H0001",
        role: "hr_admin" as const,
        mustChangePassword: false,
      },
      {
        ...employeeAccount(),
        id: "account-viewer",
        employeeId: "employee-viewer",
        employeeNumber: "V0001",
        role: "executive_viewer" as const,
        mustChangePassword: false,
      },
      { ...adminAccount(), departmentId: "department-1" },
    ];
    const { service } = createFixture(accounts);
    const tokens = new Map<string, string>();
    for (const account of accounts) {
      const login = await service.login({
        employeeNumber: account.employeeNumber,
        password: account.role === "system_admin" ? "Admin-Password-123" : "Initial-Password-123",
      });
      if (!login.ok) throw new Error("login failed");
      tokens.set(account.role, login.data.token);
    }

    expect(
      await service.authorizeEmployeeAccess(tokens.get("employee"), {
        employeeId: "employee-1",
        access: "read",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await service.authorizeEmployeeAccess(tokens.get("employee"), {
        employeeId: "employee-other",
        access: "read",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await service.authorizeEmployeeAccess(tokens.get("department_manager"), {
        employeeId: "employee-coworker",
        access: "write",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await service.authorizeEmployeeAccess(tokens.get("department_manager"), {
        employeeId: "employee-other",
        access: "read",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await service.authorizeEmployeeAccess(tokens.get("hr_admin"), {
        employeeId: "employee-other",
        access: "write",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await service.authorizeEmployeeAccess(tokens.get("executive_viewer"), {
        employeeId: "employee-other",
        access: "read",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await service.authorizeEmployeeAccess(tokens.get("executive_viewer"), {
        employeeId: "employee-other",
        access: "write",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  test("allows only one password rotation for the same session version", async () => {
    const account = employeeAccount();
    account.mustChangePassword = false;
    const { service } = createFixture([account]);
    const login = await service.login({
      employeeNumber: "E0001",
      password: "Initial-Password-123",
    });
    if (!login.ok) throw new Error("login failed");

    const results = await Promise.all([
      service.changePassword(login.data.token, {
        currentPassword: "Initial-Password-123",
        newPassword: "Concurrent-Password-111",
      }),
      service.changePassword(login.data.token, {
        currentPassword: "Initial-Password-123",
        newPassword: "Concurrent-Password-222",
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ code: "SESSION_CHANGED_RETRY" }),
      }),
    ]);
  });
});
