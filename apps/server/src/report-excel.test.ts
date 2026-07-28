import { describe, expect, test } from "bun:test";
import { createReportWorkbook, readReportWorkbookSummary } from "./report-excel";

describe("report Excel", () => {
  test("keeps dashboard metrics and filtered matrix rows in the workbook", async () => {
    const workbook = await createReportWorkbook({
      generatedAt: "2026-07-28T00:00:00.000Z",
      filters: { departmentId: "d1", status: "met" },
      definitions: {
        positionSkillCompliance: "岗位口径",
        departmentSkillCoverage: "覆盖口径",
        trainingCompletion: "培训口径",
        expiry: "到期口径",
      },
      metrics: {
        positionSkillCompliance: { numerator: 1, denominator: 2, rate: 0.5 },
        departmentSkillCoverage: { numerator: 1, denominator: 1, rate: 1 },
        trainingCompletion: { numerator: 2, denominator: 3, rate: 2 / 3 },
        expiringSoonCount: 1,
        expiredCount: 2,
      },
      rows: [
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
    });
    expect(await readReportWorkbookSummary(workbook)).toEqual({
      positionSkillNumerator: 1,
      positionSkillDenominator: 2,
      matrixRowCount: 1,
    });
  });
});
