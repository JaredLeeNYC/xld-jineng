import type { ReportRepository } from "@jineng/skill-matrix-db";
import { calculateDashboardMetrics, type SkillMatrixCell } from "@jineng/skill-matrix-shared";
import type { SessionView } from "./auth-contract";

export type ReportFilters = {
  departmentId?: string;
  positionId?: string;
  employeeId?: string;
  skillId?: string;
  status?: SkillMatrixCell["status"];
  validity?: NonNullable<SkillMatrixCell["validityStatus"]>;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "employeeNumber" | "departmentName" | "positionName" | "skillCode" | "status";
  sortOrder?: "asc" | "desc";
};

const definitions = {
  positionSkillCompliance: "在岗员工已达标的必备岗位技能要求数 / 应满足的全部必备岗位技能要求数",
  departmentSkillCoverage: "至少一名在岗员工达标的必备岗位-技能组合数 / 全部必备岗位-技能组合数",
  trainingCompletion: "统计周期内已确认且未取消任务数 / 同期已发布且未取消任务数",
  expiry: "仍在岗员工当前技能中未来 30 天到期和已经到期的数量",
};

const fail = (code: string, message: string, status: 400 | 403) => ({
  ok: false as const,
  error: { code, message, status },
});

const date = (value: string | undefined) => {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
};

export const createReportService = (dependencies: {
  repository: ReportRepository;
  now: () => Date;
}) => {
  const build = async (actor: SessionView, filters: ReportFilters) => {
    if (!["department_manager", "hr_admin", "executive_viewer"].includes(actor.role))
      return fail("FORBIDDEN", "无权查看管理报表", 403);
    if (actor.role === "department_manager" && !actor.departmentId)
      return fail("FORBIDDEN", "主管账号未关联部门", 403);
    const dateFrom = date(filters.dateFrom);
    const dateTo = date(filters.dateTo);
    if (dateFrom === null || dateTo === null || (dateFrom && dateTo && dateFrom > dateTo))
      return fail("INVALID_REPORT_PERIOD", "统计日期范围无效", 400);
    const generatedAt = dependencies.now();
    const scopedFilters = {
      ...filters,
      ...(actor.role === "department_manager" ? { departmentId: actor.departmentId } : {}),
    };
    const facts = await dependencies.repository.loadFacts({
      ...(scopedFilters.departmentId ? { departmentId: scopedFilters.departmentId } : {}),
      ...(scopedFilters.positionId ? { positionId: scopedFilters.positionId } : {}),
      ...(scopedFilters.employeeId ? { employeeId: scopedFilters.employeeId } : {}),
      ...(scopedFilters.skillId ? { skillId: scopedFilters.skillId } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateToExclusive: new Date(dateTo.getTime() + 24 * 60 * 60 * 1000) } : {}),
      now: generatedAt,
    });
    const dateToExclusive = dateTo ? new Date(dateTo.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const metrics = calculateDashboardMetrics({
      ...facts,
      now: generatedAt,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateToExclusive ? { dateToExclusive } : {}),
    });
    const rows = facts.matrix
      .filter((row) => !filters.status || row.status === filters.status)
      .filter((row) => !filters.validity || row.validityStatus === filters.validity)
      .sort((left, right) => {
        const field = filters.sortBy ?? "employeeNumber";
        const direction = filters.sortOrder === "desc" ? -1 : 1;
        return String(left[field]).localeCompare(String(right[field]), "zh-CN") * direction;
      });
    return {
      ok: true as const,
      data: {
        generatedAt: generatedAt.toISOString(),
        filters: scopedFilters,
        definitions,
        metrics,
        rows,
      },
    };
  };

  return {
    dashboard: build,
    async exportData(actor: SessionView, filters: ReportFilters) {
      const result = await build(actor, filters);
      if (result.ok)
        await dependencies.repository.recordExport({
          actorAccountId: actor.accountId,
          filters: result.data.filters,
          rowCount: result.data.rows.length,
        });
      return result;
    },
  };
};

export type ReportService = ReturnType<typeof createReportService>;
