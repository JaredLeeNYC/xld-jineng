import { describe, expect, test } from "bun:test";
import { createTrainingExamService } from "./training-exam-service";
import type { SessionView } from "./auth-contract";
import type { AssessmentActor } from "../../../packages/db/src/assessment-repository";
const manager: SessionView = {
  accountId: "manager",
  employeeId: "manager-employee",
  employeeNumber: "M1",
  displayName: "主管",
  role: "department_manager",
  departmentId: "department-1",
  mustChangePassword: false,
};
const input = {
  planId: "plan",
  employeeId: "employee",
  skillId: "skill",
  method: "written" as const,
  score: 45,
  passed: true,
  completedAt: "2026-09-17T08:00:00Z",
};
const setup = () => {
  const actors: AssessmentActor[] = [];
  const service = createTrainingExamService({
    now: () => new Date("2026-09-18T08:00:00Z"),
    repository: {
      list: async (actor) => {
        actors.push(actor);
        return [];
      },
      create: async (actor) => {
        actors.push(actor);
        return actor.departmentId === "department-1" ? "exam" : undefined;
      },
    },
  });
  return { service, actors };
};
describe("training exam service", () => {
  test("allows independent pass result and validates score and completion time", async () => {
    const { service } = setup();
    expect(await service.create(manager, input)).toMatchObject({ ok: true, data: { id: "exam" } });
    for (const score of [-1, 101, NaN])
      expect(await service.create(manager, { ...input, score })).toMatchObject({
        ok: false,
        error: { status: 400 },
      });
    expect(
      await service.create(manager, { ...input, completedAt: "2026-09-19T00:00:00Z" }),
    ).toMatchObject({ ok: false, error: { status: 400 } });
  });
  test("employees can read only their repository scope and cannot write", async () => {
    const { service, actors } = setup();
    const employee = { ...manager, role: "employee" as const };
    expect((await service.list(employee)).ok).toBe(true);
    expect(actors[0]).toMatchObject({ role: "employee", employeeId: employee.employeeId });
    expect(await service.create(employee, input)).toMatchObject({
      ok: false,
      error: { status: 403 },
    });
  });
  test("factory read does not elevate mutation scope", async () => {
    const { service, actors } = setup();
    const viewer = { ...manager, factoryRead: true };
    await service.list(viewer);
    await service.create(viewer, input);
    expect(actors.map((a) => a.role)).toEqual(["executive_viewer", "department_manager"]);
    expect(await service.create({ ...manager, departmentId: "other" }, input)).toMatchObject({
      ok: false,
      error: { status: 409 },
    });
  });
});
