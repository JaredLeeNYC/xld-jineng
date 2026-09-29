import type { TrainingPlanStatus } from "./training-plan";

export type AnnualTrainingPlan = {
  id: string;
  title: string;
  status: TrainingPlanStatus;
  startAt: string;
  dueAt: string;
  plannedHours: number | null;
  participantCount: number;
};
export type TrainingHoursFact = {
  employeeId: string;
  startAt: string;
  completedAt: string | null;
  plannedHours: number | null;
  actualHours: number | null;
  status: string;
};
export type TrainingMonth = {
  month: number;
  employeesTrained: number;
  plannedHours: number;
  plannedPersonHours: number;
  actualPersonHours: number;
  averageHours: number | null;
  cumulativeAverageHours: number | null;
  missingPlannedHours: number;
  missingActualHours: number;
};
export type TrainingAnalytics = {
  year: number;
  departmentId?: string;
  areaId?: string;
  employeeCount: number;
  plans: AnnualTrainingPlan[];
  months: TrainingMonth[];
};
export const validTrainingHours = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= 999999.99 &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const monthInYear = (value: string, year: number) => {
  const date = new Date(new Date(value).getTime() + 8 * 3600000);
  return date.getUTCFullYear() === year ? date.getUTCMonth() + 1 : 0;
};
const round = (value: number) => Math.round(value * 100) / 100;
export function calculateTrainingMonths(
  year: number,
  employeeCount: number,
  plans: AnnualTrainingPlan[],
  tasks: TrainingHoursFact[],
): TrainingMonth[] {
  let cumulative = 0;
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const scheduled = plans.filter(
      (p) => p.status !== "cancelled" && monthInYear(p.startAt, year) === month,
    );
    const completed = tasks.filter(
      (t) =>
        t.status === "confirmed" && t.completedAt && monthInYear(t.completedAt, year) === month,
    );
    const actual = completed.reduce((sum, t) => sum + (t.actualHours ?? 0), 0);
    cumulative += actual;
    return {
      month,
      employeesTrained: new Set(completed.map((t) => t.employeeId)).size,
      plannedHours: round(scheduled.reduce((sum, p) => sum + (p.plannedHours ?? 0), 0)),
      plannedPersonHours: round(
        scheduled.reduce((sum, p) => sum + (p.plannedHours ?? 0) * p.participantCount, 0),
      ),
      actualPersonHours: round(actual),
      averageHours: employeeCount ? round(actual / employeeCount) : null,
      cumulativeAverageHours: employeeCount ? round(cumulative / employeeCount) : null,
      missingPlannedHours: scheduled.filter((p) => p.plannedHours === null).length,
      missingActualHours: completed.filter((t) => t.actualHours === null).length,
    };
  });
}
