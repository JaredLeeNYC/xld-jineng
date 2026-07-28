import { describe, expect, test } from "bun:test";
import type { SkillMatrixCell } from "./skill";
import { calculateDashboardMetrics } from "./report";

const cell = (overrides: Partial<SkillMatrixCell>): SkillMatrixCell => ({
  employeeId: "e1",
  employeeNumber: "E001",
  employeeName: "甲",
  departmentId: "d1",
  departmentName: "制造部",
  positionId: "p1",
  positionName: "操作工",
  skillId: "s1",
  skillCode: "S001",
  skillName: "点检",
  requiredLevel: 2,
  required: true,
  status: "unassessed",
  gap: 2,
  ...overrides,
});

describe("dashboard metric calculations", () => {
  test("excludes optional requirements, expired skills and canceled tasks", () => {
    const result = calculateDashboardMetrics({
      matrix: [
        cell({ employeeId: "e1", status: "met", currentLevel: 2, gap: 0 }),
        cell({ employeeId: "e2", status: "expired", currentLevel: 4 }),
        cell({ employeeId: "e3", skillId: "s2", status: "gap", currentLevel: 1 }),
        cell({ employeeId: "e4", skillId: "s3", required: false, status: "met", gap: 0 }),
      ],
      trainingTasks: [
        {
          status: "confirmed",
          assignedAt: "2026-07-01T00:00:00.000Z",
          confirmedAt: "2026-07-05T00:00:00.000Z",
        },
        { status: "submitted", assignedAt: "2026-07-02T00:00:00.000Z" },
        { status: "cancelled", assignedAt: "2026-07-03T00:00:00.000Z" },
      ],
      expiryFacts: [
        { employeeId: "e1", skillId: "s1", validUntil: "2026-08-27T00:00:00.000Z" },
        { employeeId: "e1", skillId: "s1", validUntil: "2026-08-27T00:00:00.000Z" },
        { employeeId: "e2", skillId: "s2", validUntil: "2026-07-27T23:59:59.000Z" },
      ],
      now: new Date("2026-07-28T00:00:00.000Z"),
    });
    expect(result.positionSkillCompliance).toEqual({ numerator: 1, denominator: 3, rate: 1 / 3 });
    expect(result.departmentSkillCoverage).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(result.trainingCompletion).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(result.expiringSoonCount).toBe(1);
    expect(result.expiredCount).toBe(1);
  });

  test("returns null rates for empty denominators", () => {
    const result = calculateDashboardMetrics({
      matrix: [],
      trainingTasks: [],
      expiryFacts: [],
      now: new Date(),
    });
    expect(result.positionSkillCompliance.rate).toBeNull();
    expect(result.departmentSkillCoverage.rate).toBeNull();
    expect(result.trainingCompletion.rate).toBeNull();
  });

  test("uses assignment time for the denominator and confirmation time for the numerator", () => {
    const result = calculateDashboardMetrics({
      matrix: [],
      trainingTasks: [
        {
          status: "confirmed",
          assignedAt: "2026-06-01T00:00:00.000Z",
          confirmedAt: "2026-07-10T00:00:00.000Z",
        },
        { status: "submitted", assignedAt: "2026-07-02T00:00:00.000Z" },
        {
          status: "confirmed",
          assignedAt: "2026-07-03T00:00:00.000Z",
          confirmedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      expiryFacts: [],
      now: new Date("2026-07-28T00:00:00.000Z"),
      dateFrom: new Date("2026-07-01T00:00:00.000Z"),
      dateToExclusive: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(result.trainingCompletion).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
  });
});
