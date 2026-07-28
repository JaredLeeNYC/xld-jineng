import type { EmployeeImportRow, EmployeeView } from "@jineng/skill-matrix-shared";
import ExcelJS from "exceljs";

const expectedHeaders = ["工号", "姓名", "部门编码", "岗位编码", "入职日期", "手机号"] as const;

const textValue = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    if ("text" in value) return String(value.text);
    if (
      "result" in value &&
      (typeof value.result === "string" ||
        typeof value.result === "number" ||
        typeof value.result === "boolean")
    ) {
      return String(value.result);
    }
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
  }
  return "";
};

export const parseEmployeeWorkbook = async (buffer: ArrayBuffer): Promise<EmployeeImportRow[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("WORKBOOK_EMPTY");

  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    headers.set(textValue(cell.value).trim(), columnNumber);
  });
  for (const header of expectedHeaders.slice(0, 4)) {
    if (!headers.has(header)) throw new Error(`MISSING_HEADER:${header}`);
  }

  const rows: EmployeeImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const read = (header: string) => {
      const column = headers.get(header);
      return column ? textValue(row.getCell(column).value).trim() : "";
    };
    const values = expectedHeaders.map(read);
    if (values.every((value) => !value)) continue;
    const [employeeNumber, displayName, departmentCode, positionCode, hireDate, phone] = values;
    rows.push({
      rowNumber,
      employeeNumber: employeeNumber ?? "",
      displayName: displayName ?? "",
      departmentCode: departmentCode ?? "",
      positionCode: positionCode ?? "",
      ...(hireDate ? { hireDate } : {}),
      ...(phone ? { phone } : {}),
    });
  }
  return rows;
};

export const createEmployeeExport = async (employees: EmployeeView[]): Promise<ArrayBuffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "技能矩阵系统";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("组织人员");
  sheet.columns = [
    { header: "工号", key: "employeeNumber", width: 16 },
    { header: "姓名", key: "displayName", width: 16 },
    { header: "部门", key: "departmentName", width: 20 },
    { header: "岗位", key: "positionName", width: 20 },
    { header: "入职日期", key: "hireDate", width: 14 },
    { header: "手机号", key: "phone", width: 16 },
    { header: "状态", key: "status", width: 10 },
  ];
  for (const employee of employees) {
    sheet.addRow({ ...employee, status: employee.active ? "在职" : "停用" });
  }
  sheet.getRow(1).font = { bold: true };
  const output = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
  return output.buffer.slice(
    output.byteOffset,
    output.byteOffset + output.byteLength,
  ) as ArrayBuffer;
};

export const createEmployeeImportWorkbook = async (
  rows: Array<{
    employeeNumber: string;
    displayName: string;
    departmentCode: string;
    positionCode: string;
    hireDate?: string;
    phone?: string;
  }>,
): Promise<ArrayBuffer> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("员工导入");
  sheet.addRow(expectedHeaders);
  for (const row of rows) {
    sheet.addRow([
      row.employeeNumber,
      row.displayName,
      row.departmentCode,
      row.positionCode,
      row.hireDate ?? "",
      row.phone ?? "",
    ]);
  }
  const output = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
  return output.buffer.slice(
    output.byteOffset,
    output.byteOffset + output.byteLength,
  ) as ArrayBuffer;
};
