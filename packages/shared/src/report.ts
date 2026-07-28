import type { SkillMatrixCell } from "./skill";

export type MetricRatio = { numerator: number; denominator: number; rate: number | null };

export type TrainingTaskMetricFact = {
  status: "assigned" | "submitted" | "confirmed" | "returned" | "cancelled";
  assignedAt: string;
  confirmedAt?: string;
};

export type ExpiryMetricFact = {
  employeeId: string;
  skillId: string;
  validUntil: string;
};

export type DashboardMetrics = {
  positionSkillCompliance: MetricRatio;
  departmentSkillCoverage: MetricRatio;
  trainingCompletion: MetricRatio;
  expiringSoonCount: number;
  expiredCount: number;
};

const ratio = (numerator: number, denominator: number): MetricRatio => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

export const calculateDashboardMetrics = (input: {
  matrix: SkillMatrixCell[];
  trainingTasks: TrainingTaskMetricFact[];
  expiryFacts: ExpiryMetricFact[];
  now: Date;
  dateFrom?: Date;
  dateToExclusive?: Date;
}): DashboardMetrics => {
  const requiredCells = input.matrix.filter((cell) => cell.required);
  const requiredCombinations = new Map<string, boolean>();
  for (const cell of requiredCells) {
    const key = `${cell.departmentId}:${cell.positionId}:${cell.skillId}`;
    requiredCombinations.set(
      key,
      (requiredCombinations.get(key) ?? false) || cell.status === "met",
    );
  }
  const inPeriod = (value: string) => {
    const time = new Date(value);
    return (
      (!input.dateFrom || time >= input.dateFrom) &&
      (!input.dateToExclusive || time < input.dateToExclusive)
    );
  };
  const denominatorTasks = input.trainingTasks.filter(
    (task) => task.status !== "cancelled" && inPeriod(task.assignedAt),
  );
  const confirmedTasks = input.trainingTasks.filter(
    (task) =>
      task.status === "confirmed" && Boolean(task.confirmedAt) && inPeriod(task.confirmedAt!),
  );
  const inThirtyDays = new Date(input.now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiry = new Map(
    input.expiryFacts.map((fact) => [`${fact.employeeId}:${fact.skillId}`, fact.validUntil]),
  );
  let expiringSoonCount = 0;
  let expiredCount = 0;
  for (const validUntil of expiry.values()) {
    const date = new Date(validUntil);
    if (date < input.now) expiredCount += 1;
    else if (date <= inThirtyDays) expiringSoonCount += 1;
  }
  return {
    positionSkillCompliance: ratio(
      requiredCells.filter((cell) => cell.status === "met").length,
      requiredCells.length,
    ),
    departmentSkillCoverage: ratio(
      [...requiredCombinations.values()].filter(Boolean).length,
      requiredCombinations.size,
    ),
    trainingCompletion: ratio(confirmedTasks.length, denominatorTasks.length),
    expiringSoonCount,
    expiredCount,
  };
};
