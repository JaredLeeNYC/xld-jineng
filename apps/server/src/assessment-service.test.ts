import { describe, expect, test } from "bun:test";
import { createMemoryMaterialStorage } from "./material-storage";
import { createAssessmentService } from "./assessment-service";

const manager = {
  accountId: "account-manager",
  employeeId: "employee-manager",
  employeeNumber: "M001",
  displayName: "主管",
  departmentId: "department-1",
  role: "department_manager" as const,
  mustChangePassword: false,
};
const hr = { ...manager, accountId: "account-hr", role: "hr_admin" as const };
const employee = { ...manager, accountId: "account-employee", role: "employee" as const };
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]);
const failure = (result: { ok: boolean; error?: { code: string; status: number } }) => {
  if (result.ok || !result.error) throw new Error("expected failure");
  return result.error;
};

const setup = (selfAuthored = false) => {
  const calls: string[] = [];
  const repository = {
    list: async () =>
      selfAuthored
        ? [
            {
              id: "assessment-1",
              assessorEmployeeId: manager.employeeId,
            },
          ]
        : [],
    create: async () => {
      calls.push("create");
      return "assessment-1";
    },
    update: async () => {
      calls.push("update");
      return true;
    },
    submit: async () => {
      calls.push("submit");
      return true;
    },
    managerConfirm: async () => {
      calls.push("manager-confirm");
      return true;
    },
    returnAssessment: async () => {
      calls.push("return");
      return true;
    },
    archive: async () => {
      calls.push("archive");
      return true;
    },
    voidAssessment: async () => {
      calls.push("void");
      return true;
    },
    evidence: async () => undefined,
  };
  let sequence = 0;
  const service = createAssessmentService({
    repository: repository as any,
    storage: createMemoryMaterialStorage(),
    idSource: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    now: () => new Date("2026-07-28T08:00:00.000Z"),
  });
  return { service, calls };
};

const input = {
  employeeId: "00000000-0000-4000-8000-000000000101",
  skillId: "00000000-0000-4000-8000-000000000102",
  method: "practical" as const,
  level: 3,
  passed: true,
  assessedAt: "2026-07-27T08:00:00.000Z",
  filename: "实操记录.pdf",
  mimeType: "application/pdf",
  bytes: pdf,
};

describe("assessment service", () => {
  test("accepts controlled offline evidence and restricts assessment creation", async () => {
    const { service, calls } = setup();
    expect((await service.create(manager, input)).ok).toBe(true);
    expect(failure(await service.create(employee, input)).status).toBe(403);
    expect(
      failure(
        await service.create(hr, {
          ...input,
          passed: false,
          reason: "",
        }),
      ).code,
    ).toBe("INVALID_ASSESSMENT");
    expect(calls).toEqual(["create"]);
  });

  test("keeps manager confirmation and HR archive as separate transitions", async () => {
    const { service, calls } = setup();
    expect((await service.submit(hr, "assessment-1")).ok).toBe(true);
    expect(failure(await service.managerConfirm(hr, "assessment-1")).status).toBe(403);
    expect((await service.managerConfirm(manager, "assessment-1")).ok).toBe(true);
    expect(failure(await service.archive(manager, "assessment-1")).status).toBe(403);
    expect((await service.archive(hr, "assessment-1")).ok).toBe(true);
    expect(calls).toEqual(["submit", "manager-confirm", "archive"]);
  });

  test("requires return and void reasons", async () => {
    const { service, calls } = setup();
    expect(failure(await service.returnAssessment(manager, "assessment-1", " ")).status).toBe(400);
    expect((await service.returnAssessment(manager, "assessment-1", "补充照片")).ok).toBe(true);
    expect(failure(await service.voidAssessment(hr, "assessment-1", "")).status).toBe(400);
    expect((await service.voidAssessment(hr, "assessment-1", "录入错误")).ok).toBe(true);
    expect(calls).toEqual(["return", "void"]);
  });

  test("prevents the assessor from confirming or archiving their own result", async () => {
    const { service, calls } = setup(true);
    expect(failure(await service.managerConfirm(manager, "assessment-1")).status).toBe(403);
    expect(failure(await service.archive(hr, "assessment-1")).status).toBe(403);
    expect(calls).toEqual([]);
  });
});
