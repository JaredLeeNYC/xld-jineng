import type { SkillBaselineImportRow } from "@jineng/skill-matrix-shared";
import ExcelJS from "exceljs";

const headers = ["工号", "技能编码", "等级", "评定日期", "来源说明"] as const;

const text = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if ("text" in value) return String(value.text).trim();
  if ("result" in value && value.result !== undefined && value.result !== null) {
    return typeof value.result === "string" ||
      typeof value.result === "number" ||
      typeof value.result === "boolean"
      ? String(value.result).trim()
      : "";
  }
  if ("richText" in value)
    return value.richText
      .map((part) => part.text)
      .join("")
      .trim();
  return "";
};

export const parseSkillBaselineWorkbook = async (buffer: ArrayBuffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("技能基线文件没有工作表");
  const actualHeaders = headers.map((_, index) => text(sheet.getRow(1).getCell(index + 1).value));
  if (headers.some((header, index) => actualHeaders[index] !== header)) {
    throw new Error(`技能基线表头必须为：${headers.join("、")}`);
  }
  const rows: SkillBaselineImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = headers.map((_, index) => text(row.getCell(index + 1).value));
    if (values.every((value) => !value)) continue;
    rows.push({
      rowNumber,
      employeeNumber: values[0]!,
      skillCode: values[1]!,
      level: values[2] ? Number(values[2]) : Number.NaN,
      assessedAt: values[3]!,
      sourceReference: values[4]!,
    });
  }
  return rows;
};

export const createSkillBaselineWorkbook = async (
  rows: Array<Omit<SkillBaselineImportRow, "rowNumber">>,
) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("初始技能");
  sheet.addRow([...headers]);
  for (const row of rows) {
    sheet.addRow([
      row.employeeNumber,
      row.skillCode,
      row.level,
      row.assessedAt,
      row.sourceReference,
    ]);
  }
  return workbook.xlsx.writeBuffer();
};
