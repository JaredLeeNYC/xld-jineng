import {
  calculateTrainingMonths,
  validTrainingHours,
} from "../../../packages/shared/src/training-analytics";
import type { TrainingAnalyticsRepository } from "../../../packages/db/src/training-analytics-repository";
import type { SessionView } from "./auth-contract";

const fail = (code: string, message: string, status: 400 | 403 | 409) => ({
  ok: false as const,
  error: { code, message, status },
});
export const createTrainingAnalyticsService = (repository: TrainingAnalyticsRepository) => ({
  async dashboard(actor: SessionView, filters: { year: number; departmentId?: string }) {
    if (!["hr_admin", "department_manager", "executive_viewer"].includes(actor.role))
      return fail("FORBIDDEN", "无权查看培训统计", 403);
    if (!Number.isInteger(filters.year) || filters.year < 2000 || filters.year > 2100)
      return fail("INVALID_YEAR", "请选择 2000–2100 年", 400);
    if (actor.role === "department_manager" && !actor.factoryRead && !actor.departmentId)
      return fail("FORBIDDEN", "主管账号未关联部门", 403);
    const departmentId =
      actor.role === "department_manager" && !actor.factoryRead
        ? actor.departmentId
        : filters.departmentId;
    const facts = await repository.loadFacts(filters.year, departmentId);
    return {
      ok: true as const,
      data: {
        year: filters.year,
        ...(departmentId ? { departmentId } : {}),
        employeeCount: facts.employeeCount,
        plans: facts.plans,
        months: calculateTrainingMonths(
          filters.year,
          facts.employeeCount,
          facts.plans,
          facts.tasks,
        ),
      },
    };
  },
  async registerHours(actor: SessionView, taskId: string, hours: unknown) {
    if (!["hr_admin", "department_manager"].includes(actor.role))
      return fail("FORBIDDEN", "无权登记培训时数", 403);
    if (!validTrainingHours(hours))
      return fail("INVALID_HOURS", "实际培训时数须大于 0，最多两位小数", 400);
    const updated = await repository.registerHours({
      taskId,
      hours,
      accountId: actor.accountId,
      employeeId: actor.employeeId,
      role: actor.role,
      ...(actor.departmentId ? { departmentId: actor.departmentId } : {}),
    });
    return updated
      ? { ok: true as const, data: { taskId, actualHours: hours } }
      : fail("HOURS_REJECTED", "仅 HR 或本部门指定负责人可登记已完成培训的实际时数", 409);
  },
});
export type TrainingAnalyticsService = ReturnType<typeof createTrainingAnalyticsService>;
