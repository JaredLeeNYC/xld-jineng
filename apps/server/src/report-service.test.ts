import { describe, expect, test } from "bun:test";
import { createReportService } from "./report-service";

const actor = {
  accountId: "a1",
  employeeId: "e-manager",
  employeeNumber: "M001",
  displayName: "主管",
  role: "department_manager" as const,
  departmentId: "d1",
  mustChangePassword: false,
};

describe("report service", () => {
  test("forces manager scope and applies the same row filters and sorting", async () => {
    let received: { departmentId?: string } = {};
    const service = createReportService({
      repository: {
        loadFacts: async (filters) => {
          received = filters;
          return {
            matrix: [
              {
                employeeId: "e2",
                employeeNumber: "E002",
                employeeName: "乙",
                departmentId: "d1",
                departmentName: "制造部",
                positionId: "p1",
                positionName: "操作工",
                skillId: "s1",
                skillCode: "S001",
                skillName: "点检",
                requiredLevel: 2,
                required: true,
                currentLevel: 1,
                status: "gap",
                gap: 1,
              },
              {
                employeeId: "e1",
                employeeNumber: "E001",
                employeeName: "甲",
                departmentId: "d1",
                departmentName: "制造部",
                positionId: "p1",
                positionName: "操作工",
                skillId: "s1",
                skillCode: "S001",
                skillName: "点检",
                requiredLevel: 2,
                required: true,
                currentLevel: 2,
                status: "met",
                gap: 0,
              },
            ],
            trainingTasks: [],
            expiryFacts: [],
          };
        },
        recordExport: async () => undefined,
      },
      now: () => new Date("2026-07-28T00:00:00.000Z"),
    });
    const result = await service.dashboard(actor, { departmentId: "other", status: "met" });
    expect(received.departmentId).toBe("d1");
    expect(result.ok && result.data.rows.map((row) => row.employeeNumber)).toEqual(["E001"]);
    expect(result.ok && result.data.metrics.positionSkillCompliance.rate).toBe(0.5);
  });

  test("denies employees and validates the reporting period", async () => {
    const repository = {
      loadFacts: async () => ({ matrix: [], trainingTasks: [], expiryFacts: [] }),
      recordExport: async () => undefined,
    };
    const service = createReportService({ repository, now: () => new Date() });
    expect((await service.dashboard({ ...actor, role: "employee" }, {})).ok).toBe(false);
    expect(
      (await service.dashboard(actor, { dateFrom: "2026-08-01", dateTo: "2026-07-01" })).ok,
    ).toBe(false);
  });
});
