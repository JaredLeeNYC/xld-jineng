import { expect, test } from "bun:test";
import { createTrainingAnalyticsService } from "./training-analytics-service";
import {
  calculateTrainingMonths,
  validTrainingHours,
  type AnnualTrainingPlan,
  type TrainingHoursFact,
} from "../../../packages/shared/src/training-analytics";
const manager = {
  accountId: "a",
  employeeId: "e",
  employeeNumber: "M",
  displayName: "主管",
  departmentId: "d1",
  role: "department_manager" as const,
  mustChangePassword: false,
};
test("manager scope is forced while factory read only expands reads", async () => {
  const scopes: (string | undefined)[] = [];
  const writes: string[] = [];
  const service = createTrainingAnalyticsService({
    loadFacts: async (_year, departmentId) => {
      scopes.push(departmentId);
      return { employeeCount: 0, plans: [], tasks: [] };
    },
    registerHours: async (input) => {
      writes.push(`${input.role}:${input.departmentId}`);
      return true;
    },
  });
  await service.dashboard(manager, { year: 2026, departmentId: "d2" });
  await service.dashboard({ ...manager, factoryRead: true }, { year: 2026, departmentId: "d2" });
  await service.registerHours({ ...manager, factoryRead: true }, "t", 2.5);
  expect(scopes).toEqual(["d1", "d2"]);
  expect(writes).toEqual(["department_manager:d1"]);
  expect((await service.dashboard({ ...manager, role: "employee" }, { year: 2026 })).ok).toBe(
    false,
  );
  expect((await service.dashboard(manager, { year: NaN })).ok).toBe(false);
  expect((await service.registerHours(manager, "t", -2)).ok).toBe(false);
  expect((await service.registerHours({ ...manager, role: "employee" }, "t", 2)).ok).toBe(false);
});
test("hours use declared teaching time, deduplicate monthly people, preserve missing values and Shanghai year boundary", () => {
  const p: AnnualTrainingPlan = {
    id: "p",
    title: "跨周课程",
    status: "draft",
    startAt: "2025-12-31T16:00:00Z",
    dueAt: "2026-01-09T10:00:00Z",
    plannedHours: 2,
    participantCount: 3,
  };
  const t: TrainingHoursFact = {
    employeeId: "e1",
    startAt: p.startAt,
    completedAt: "2026-01-31T16:00:00Z",
    plannedHours: 2,
    actualHours: 1.5,
    status: "confirmed",
  };
  const months = calculateTrainingMonths(
    2026,
    2,
    [
      p,
      { ...p, id: "missing", plannedHours: null },
      { ...p, id: "cancelled", status: "cancelled" },
    ],
    [
      t,
      { ...t, actualHours: 2.5 },
      { ...t, employeeId: "e2", actualHours: null },
      { ...t, status: "cancelled", actualHours: 99 },
    ],
  );
  expect(months[0]).toMatchObject({
    plannedHours: 2,
    plannedPersonHours: 6,
    actualPersonHours: 0,
    missingPlannedHours: 1,
  });
  expect(months[1]).toMatchObject({
    employeesTrained: 2,
    actualPersonHours: 4,
    averageHours: 2,
    cumulativeAverageHours: 2,
    missingActualHours: 1,
  });
  expect(months[11]!.cumulativeAverageHours).toBe(2);
  expect(calculateTrainingMonths(2026, 0, [], [])[0]!.averageHours).toBeNull();
});
test("hours validation rejects strings nonfinite negatives excess precision and overflow", () => {
  for (const value of ["2", null, -1, 0, NaN, Infinity, 0.001, 1000000])
    expect(validTrainingHours(value)).toBe(false);
  for (const value of [0.01, 2, 1.25, 999999.99]) expect(validTrainingHours(value)).toBe(true);
});
