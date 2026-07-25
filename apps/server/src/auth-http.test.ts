import { describe, expect, test } from "bun:test";
import { createApp } from "./app";

const session = {
  accountId: "00000000-0000-4000-8000-000000000001",
  employeeId: "00000000-0000-4000-8000-000000000101",
  employeeNumber: "E0001",
  displayName: "张明",
  role: "employee" as const,
  mustChangePassword: true,
};

describe("authentication HTTP API", () => {
  test("logs in by employee number and sets an HttpOnly session cookie", async () => {
    const response = await createApp({
      authService: {
        login: async () => ({
          ok: true,
          data: {
            session,
            token: "plain-session-token",
            expiresAt: new Date("2026-07-26T00:00:00.000Z"),
          },
        }),
      },
    } as never).handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeNumber: "E0001",
          password: "Initial-Password-123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: session,
    });
    expect(response.headers.get("set-cookie")).toContain(
      "skill_matrix_session=plain-session-token",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  });

  test("returns one generic response for an unknown employee number or wrong password", async () => {
    const app = createApp({
      authService: {
        login: async () => ({
          ok: false,
          error: {
            code: "INVALID_CREDENTIALS",
            message: "工号或密码错误",
            status: 401,
          },
        }),
      },
    } as never);
    const request = (employeeNumber: string) =>
      app.handle(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            employeeNumber,
            password: "wrong-password",
          }),
        }),
      );

    const unknownResponse = await request("UNKNOWN");
    const wrongPasswordResponse = await request("E0001");

    expect(unknownResponse.status).toBe(401);
    const expectedError = {
      ok: false,
      error: {
        code: "INVALID_CREDENTIALS",
        message: "工号或密码错误",
      },
    };
    expect(await unknownResponse.json()).toEqual(expectedError);
    expect(await wrongPasswordResponse.json()).toEqual(expectedError);
  });

  test("reads the session cookie, rotates it after password change, and expires it on logout", async () => {
    const calls: string[] = [];
    const app = createApp({
      authService: {
        getSession: async (token: string) => {
          calls.push(`session:${token}`);
          return { ok: true, data: session };
        },
        changePassword: async (token: string) => {
          calls.push(`change:${token}`);
          return {
            ok: true,
            data: {
              session: { ...session, mustChangePassword: false },
              token: "rotated-token",
              expiresAt: new Date("2026-07-27T00:00:00.000Z"),
            },
          };
        },
        logout: async (token: string) => {
          calls.push(`logout:${token}`);
          return { ok: true, data: { loggedOut: true as const } };
        },
      },
    } as never);

    const sessionResponse = await app.handle(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: "skill_matrix_session=plain-session-token" },
      }),
    );
    const changeResponse = await app.handle(
      new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "skill_matrix_session=plain-session-token",
        },
        body: JSON.stringify({
          currentPassword: "Initial-Password-123",
          newPassword: "Changed-Password-456",
        }),
      }),
    );
    const logoutResponse = await app.handle(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: "skill_matrix_session=rotated-token" },
      }),
    );

    expect(sessionResponse.status).toBe(200);
    expect(changeResponse.headers.get("set-cookie")).toContain(
      "skill_matrix_session=rotated-token",
    );
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(calls).toEqual([
      "session:plain-session-token",
      "change:plain-session-token",
      "logout:rotated-token",
    ]);
  });

  test("maps an authorization refusal to a structured 403", async () => {
    const response = await createApp({
      authService: {
        resetPassword: async () => ({
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "无权执行此操作",
            status: 403,
          },
        }),
      },
    } as never).handle(
      new Request(
        "http://localhost/api/admin/accounts/00000000-0000-4000-8000-000000000001/reset-password",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "skill_matrix_session=employee-token",
          },
          body: JSON.stringify({
            temporaryPassword: "Temporary-Password-999",
          }),
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "无权执行此操作",
      },
    });
  });
});
