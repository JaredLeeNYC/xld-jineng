import type { ReportService } from "./report-service";
import ExcelJS from "exceljs";

type ReportData = Awaited<ReturnType<ReportService["dashboard"]>> & { ok: true };

export const createReportWorkbook = async (data: ReportData["data"]): Promise<ArrayBuffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "技能矩阵系统";
  workbook.created = new Date(data.generatedAt);
  const summary = workbook.addWorksheet("指标概览");
  summary.columns = [
    { header: "指标", key: "name", width: 24 },
    { header: "分子", key: "numerator", width: 12 },
    { header: "分母", key: "denominator", width: 12 },
    { header: "结果", key: "value", width: 16 },
    { header: "口径说明", key: "definition", width: 70 },
  ];
  const ratioRows = [
    [
      "岗位技能达标率",
      data.metrics.positionSkillCompliance,
      data.definitions.positionSkillCompliance,
    ],
    [
      "部门技能覆盖率",
      data.metrics.departmentSkillCoverage,
      data.definitions.departmentSkillCoverage,
    ],
    ["培训任务完成率", data.metrics.trainingCompletion, data.definitions.trainingCompletion],
  ] as const;
  for (const [name, metric, definition] of ratioRows)
    summary.addRow({
      name,
      numerator: metric.numerator,
      denominator: metric.denominator,
      value: metric.rate === null ? "—" : metric.rate,
      definition,
    });
  summary.getCell("D2").numFmt = "0.0%";
  summary.getCell("D3").numFmt = "0.0%";
  summary.getCell("D4").numFmt = "0.0%";
  summary.addRow({
    name: "30 天内到期",
    value: data.metrics.expiringSoonCount,
    definition: data.definitions.expiry,
  });
  summary.addRow({
    name: "已到期",
    value: data.metrics.expiredCount,
    definition: data.definitions.expiry,
  });
  summary.addRow({ name: "生成时间", value: data.generatedAt });
  summary.addRow({ name: "筛选条件", value: JSON.stringify(data.filters) });
  summary.getRow(1).font = { bold: true };
  summary.views = [{ state: "frozen", ySplit: 1 }];

  const matrix = workbook.addWorksheet("技能矩阵明细");
  matrix.columns = [
    { header: "工号", key: "employeeNumber", width: 14 },
    { header: "姓名", key: "employeeName", width: 16 },
    { header: "部门", key: "departmentName", width: 18 },
    { header: "岗位", key: "positionName", width: 18 },
    { header: "技能编码", key: "skillCode", width: 14 },
    { header: "技能名称", key: "skillName", width: 20 },
    { header: "是否必备", key: "required", width: 12 },
    { header: "要求等级", key: "requiredLevel", width: 12 },
    { header: "当前等级", key: "currentLevel", width: 12 },
    { header: "达标状态", key: "status", width: 14 },
    { header: "有效期状态", key: "validityStatus", width: 14 },
    { header: "有效期至", key: "validUntil", width: 24 },
  ];
  matrix.addRows(data.rows.map((row) => ({ ...row, required: row.required ? "是" : "否" })));
  matrix.getRow(1).font = { bold: true };
  matrix.views = [{ state: "frozen", ySplit: 1 }];
  matrix.autoFilter = { from: "A1", to: "L1" };
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
};

export const readReportWorkbookSummary = async (buffer: ArrayBuffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const summary = workbook.getWorksheet("指标概览");
  const matrix = workbook.getWorksheet("技能矩阵明细");
  return {
    positionSkillNumerator: Number(summary?.getCell("B2").value),
    positionSkillDenominator: Number(summary?.getCell("C2").value),
    matrixRowCount: Math.max(0, (matrix?.rowCount ?? 1) - 1),
  };
};
