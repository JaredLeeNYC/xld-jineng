import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { createEmployeeExport, parseEmployeeWorkbook } from "./organization-excel";

describe("organization Excel", () => {
  test("parses the employee template and ignores blank rows", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("员工");
    sheet.addRow(["工号", "姓名", "部门编码", "岗位编码", "入职日期", "手机号"]);
    sheet.addRow(["e0001", "张明", "d001", "p001", "2026-01-02", "13800000000"]);
    sheet.addRow([]);

    const rows = await parseEmployeeWorkbook(await workbook.xlsx.writeBuffer());
    expect(rows).toEqual([
      {
        rowNumber: 2,
        employeeNumber: "e0001",
        displayName: "张明",
        departmentCode: "d001",
        positionCode: "p001",
        hireDate: "2026-01-02",
        phone: "13800000000",
      },
    ]);
  });

  test("exports the current employee selection without credentials", async () => {
    const buffer = await createEmployeeExport([
      {
        id: "employee-1",
        employeeNumber: "E0001",
        displayName: "张明",
        departmentName: "装配部",
        positionName: "装配工",
        role: "employee",
        active: true,
      },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getCell("A2").text).toBe("E0001");
    expect(sheet.getCell("G2").text).toBe("在职");
    expect(sheet.columnCount).toBe(7);
  });
});
