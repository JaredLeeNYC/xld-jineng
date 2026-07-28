import { describe, expect, test } from "bun:test";
import { createApp } from "./app";

const hrSession = {
  accountId: "00000000-0000-4000-8000-000000000001",
  employeeId: "00000000-0000-4000-8000-000000000101",
  employeeNumber: "H0001",
  displayName: "HR",
  departmentId: "00000000-0000-4000-8000-000000000201",
  role: "hr_admin" as const,
  mustChangePassword: false,
};

describe("organization HTTP API", () => {
  test("maps the authenticated actor into organization list and mutation workflows", async () => {
    const calls: string[] = [];
    const app = createApp({
      authService: {
        getSession: async () => ({ ok: true, data: hrSession }),
      },
      organizationService: {
        listEmployees: async (actor: typeof hrSession) => {
          calls.push(`list:${actor.accountId}`);
          return {
            ok: true,
            data: [
              {
                id: hrSession.employeeId,
                employeeNumber: hrSession.employeeNumber,
                displayName: hrSession.displayName,
                departmentId: hrSession.departmentId,
                departmentName: "人力资源部",
                role: hrSession.role,
                active: true,
              },
            ],
          };
        },
        createDepartment: async (actor: typeof hrSession, input: { code: string }) => {
          calls.push(`create:${actor.accountId}:${input.code}`);
          return {
            ok: true,
            data: {
              id: "00000000-0000-4000-8000-000000000301",
              code: "D001",
              name: "人力资源部",
              active: true,
            },
          };
        },
      },
    } as never);

    const listResponse = await app.handle(
      new Request("http://localhost/api/organization/employees", {
        headers: { cookie: "skill_matrix_session=hr-token" },
      }),
    );
    const createResponse = await app.handle(
      new Request("http://localhost/api/organization/departments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "skill_matrix_session=hr-token",
        },
        body: JSON.stringify({ code: "D001", name: "人力资源部" }),
      }),
    );

    expect(listResponse.status).toBe(200);
    expect(createResponse.status).toBe(200);
    expect(calls).toEqual([`list:${hrSession.accountId}`, `create:${hrSession.accountId}:D001`]);
  });

  test("blocks organization access until the initial password is changed", async () => {
    const response = await createApp({
      authService: {
        getSession: async () => ({
          ok: true,
          data: { ...hrSession, mustChangePassword: true },
        }),
      },
      organizationService: {},
    } as never).handle(
      new Request("http://localhost/api/organization/employees", {
        headers: { cookie: "skill_matrix_session=initial-token" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "PASSWORD_CHANGE_REQUIRED" },
    });
  });
});
