import { describe, expect, test } from "bun:test";
import type { OrganizationRepository } from "@jineng/skill-matrix-db";
import type { SessionView } from "./auth-contract";
import { createOrganizationService } from "./organization-service";

const hr: SessionView = {
  accountId: "account-hr",
  employeeId: "employee-hr",
  employeeNumber: "H0001",
  displayName: "HR",
  departmentId: "department-1",
  role: "hr_admin",
  mustChangePassword: false,
};

const manager: SessionView = {
  ...hr,
  accountId: "account-manager",
  employeeId: "employee-manager",
  employeeNumber: "M0001",
  role: "department_manager",
};

const createFixture = () => {
  const previews = new Map<string, any>();
  let confirmedRows: any[] = [];
  const repository = {
    findImportReferences: async () => ({
      departments: [{ id: "department-1", code: "D001" }],
      positions: [{ id: "position-1", code: "P001", departmentId: "department-1" }],
      employeeNumbers: ["E0001"],
    }),
    storeImportPreview: async (input: any) => previews.set(input.id, input),
    loadImportPreview: async (id: string, actorAccountId: string) => {
      const preview = previews.get(id);
      return preview?.actorAccountId === actorAccountId
        ? { ...preview, confirmedAt: null }
        : undefined;
    },
    confirmImport: async (input: any) => {
      confirmedRows = input.rows;
      return input.rows.map((row: any) => ({
        employeeNumber: row.employeeNumber,
        temporaryPassword: row.temporaryPassword,
      }));
    },
    listEmployees: async (filters: { departmentId?: string; employeeId?: string }) => [
      {
        id: filters.employeeId ?? "employee-1",
        employeeNumber: "E0002",
        displayName: "员工",
        departmentId: filters.departmentId ?? "department-1",
        role: "employee" as const,
        active: true,
      },
    ],
    listDepartments: async () => [
      { id: "department-1", code: "D001", name: "装配部", active: true },
      { id: "department-2", code: "D002", name: "质量部", active: true },
    ],
    recordExport: async () => undefined,
  } as unknown as OrganizationRepository;
  const service = createOrganizationService({
    repository,
    passwordHash: async (value) => `hash:${value}`,
    temporaryPassword: () => "Temporary-Password-123",
    idSource: () => "00000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-07-28T00:00:00.000Z"),
  });
  return { service, getConfirmedRows: () => confirmedRows };
};

describe("organization service", () => {
  test("dry-runs imports with normalized values and row-level reference errors", async () => {
    const { service } = createFixture();
    const result = await service.dryRunImport(hr, [
      {
        rowNumber: 2,
        employeeNumber: " e0001 ",
        displayName: "张明",
        departmentCode: "d001",
        positionCode: "p001",
      },
      {
        rowNumber: 3,
        employeeNumber: "e0002",
        displayName: "李华",
        departmentCode: "unknown",
        positionCode: "unknown",
      },
    ]);

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.data.totalRows).toBe(2);
    expect(result.data.validRows).toBe(0);
    expect(result.data.errors.map((error) => error.code)).toEqual([
      "DUPLICATE",
      "INVALID_DEPARTMENT",
      "INVALID_POSITION",
    ]);
  });

  test("confirms only a clean HR preview and returns one-time credentials", async () => {
    const { service, getConfirmedRows } = createFixture();
    const preview = await service.dryRunImport(hr, [
      {
        rowNumber: 2,
        employeeNumber: "e0002",
        displayName: "李华",
        departmentCode: "d001",
        positionCode: "p001",
      },
    ]);
    if (!preview.ok) throw new Error("preview failed");

    const confirmed = await service.confirmImport(hr, preview.data.previewId);
    expect(confirmed).toMatchObject({
      ok: true,
      data: {
        imported: 1,
        credentials: [{ employeeNumber: "E0002", temporaryPassword: "Temporary-Password-123" }],
      },
    });
    expect(getConfirmedRows()[0].passwordHash).toBe("hash:Temporary-Password-123");
  });

  test("enforces department and personal scopes on organization reads", async () => {
    const { service } = createFixture();
    const managerDepartments = await service.listDepartments(manager);
    expect(managerDepartments).toMatchObject({
      ok: true,
      data: [{ id: "department-1" }],
    });
    const employeeResult = await service.listEmployees({
      ...manager,
      role: "employee",
      employeeId: "employee-self",
    });
    expect(employeeResult).toMatchObject({
      ok: true,
      data: [{ id: "employee-self" }],
    });
  });

  test("rejects organization writes from a department manager", async () => {
    const { service } = createFixture();
    expect(await service.createDepartment(manager, { code: "D003", name: "新部门" })).toMatchObject(
      { ok: false, error: { code: "FORBIDDEN" } },
    );
  });
});
