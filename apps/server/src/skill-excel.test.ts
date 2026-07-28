import { describe, expect, test } from "bun:test";
import { createSkillBaselineWorkbook, parseSkillBaselineWorkbook } from "./skill-excel";

describe("skill baseline Excel", () => {
  test("round-trips the controlled baseline template", async () => {
    const workbook = await createSkillBaselineWorkbook([
      {
        employeeNumber: "E0001",
        skillCode: "S001",
        level: 3,
        assessedAt: "2026-07-01",
        sourceReference: "档案 A-1",
      },
    ]);
    expect(await parseSkillBaselineWorkbook(new Uint8Array(workbook).buffer)).toEqual([
      {
        rowNumber: 2,
        employeeNumber: "E0001",
        skillCode: "S001",
        level: 3,
        assessedAt: "2026-07-01",
        sourceReference: "档案 A-1",
      },
    ]);
  });
});
