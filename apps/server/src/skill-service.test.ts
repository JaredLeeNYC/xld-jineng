import { describe, expect, test } from "bun:test";
import type { SkillRepository } from "@jineng/skill-matrix-db";
import type { SessionView } from "./auth-contract";
import { createSkillService } from "./skill-service";

const hr: SessionView = {
  accountId: "account-hr",
  employeeId: "employee-hr",
  employeeNumber: "H0001",
  displayName: "HR",
  departmentId: "department-1",
  role: "hr_admin",
  mustChangePassword: false,
};

const fixture = () => {
  let preview: any;
  let matrixInput: any;
  const repository = {
    listSkills: async () => [],
    upsertRequirement: async () => true,
    findBaselineReferences: async () => ({
      employees: [{ id: "employee-1", employeeNumber: "E0001" }],
      skills: [{ id: "skill-1", code: "S001", reassessmentRequired: true, validityMonths: 12 }],
      current: [],
    }),
    storeBaselinePreview: async (input: any) => {
      preview = input;
    },
    loadBaselinePreview: async () => (preview ? { ...preview, confirmedAt: null } : undefined),
    confirmBaselineImport: async (input: any) => input.rows.length,
    listMatrix: async (input: any) => {
      matrixInput = input;
      return [];
    },
  } as unknown as SkillRepository;
  const service = createSkillService({
    repository,
    idSource: () => "00000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-07-28T00:00:00.000Z"),
  });
  return { service, getPreview: () => preview, getMatrixInput: () => matrixInput };
};

describe("skill service", () => {
  test("accepts only fixed 0-4 requirement levels", async () => {
    const { service } = fixture();
    expect(
      await service.saveRequirement(hr, {
        positionId: "position-1",
        skillId: "skill-1",
        requiredLevel: 4,
        required: true,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await service.saveRequirement(hr, {
        positionId: "position-1",
        skillId: "skill-1",
        requiredLevel: 5,
        required: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_SKILL_LEVEL" } });
  });

  test("prechecks baseline sources and archives only a clean preview", async () => {
    const { service, getPreview } = fixture();
    const invalid = await service.dryRunBaseline(hr, [
      {
        rowNumber: 2,
        employeeNumber: "E0001",
        skillCode: "S001",
        level: 3,
        assessedAt: "2026-02-30",
        sourceReference: "",
      },
    ]);
    expect(invalid).toMatchObject({
      ok: true,
      data: { validRows: 0, errors: [{ code: "REQUIRED" }, { code: "INVALID_DATE" }] },
    });
    const clean = await service.dryRunBaseline(hr, [
      {
        rowNumber: 2,
        employeeNumber: "e0001",
        skillCode: "s001",
        level: 3,
        assessedAt: "2026-07-01",
        sourceReference: "纸质档案 A-1",
      },
    ]);
    expect(clean).toMatchObject({ ok: true, data: { validRows: 1, errors: [] } });
    expect(getPreview().rows[0]).toMatchObject({ employeeNumber: "E0001", skillCode: "S001" });
    if (!clean.ok) return;
    expect(await service.confirmBaseline(hr, clean.data.previewId)).toMatchObject({
      ok: true,
      data: { imported: 1 },
    });
  });

  test("rejects an empty level and an oversized source during baseline preview", async () => {
    const { service } = fixture();
    const result = await service.dryRunBaseline(hr, [
      {
        rowNumber: 2,
        employeeNumber: "E0001",
        skillCode: "S001",
        level: Number.NaN,
        assessedAt: "2026-07-01",
        sourceReference: "x".repeat(301),
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      data: { errors: [{ code: "INVALID_VALUE" }, { code: "INVALID_LEVEL" }] },
    });
  });

  test("forces manager and employee matrix scopes", async () => {
    const { service, getMatrixInput } = fixture();
    await service.matrix(
      { ...hr, role: "department_manager", departmentId: "department-1" },
      { departmentId: "department-2" },
    );
    expect(getMatrixInput()).toMatchObject({ departmentId: "department-1" });
    await service.matrix({ ...hr, role: "employee", employeeId: "employee-self" });
    expect(getMatrixInput()).toMatchObject({ employeeId: "employee-self" });
  });
});
