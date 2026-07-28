import { describe, expect, test } from "bun:test";
import type { TrainingRepository } from "@jineng/skill-matrix-db";
import type { SessionView } from "./auth-contract";
import { createMemoryMaterialStorage } from "./material-storage";
import { createTrainingService } from "./training-service";

const actor = (role: SessionView["role"]): SessionView => ({
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  employeeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  employeeNumber: "E001",
  displayName: "测试用户",
  departmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  role,
  mustChangePassword: false,
});
const plan = {
  title: "安全培训",
  materialId: "11111111-1111-4111-8111-111111111111",
  ownerEmployeeId: "22222222-2222-4222-8222-222222222222",
  startAt: "2026-08-01T00:00:00.000Z",
  dueAt: "2026-08-02T00:00:00.000Z",
  location: "一号会议室",
  scopeType: "department" as const,
  scopeDepartmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

const setup = () => {
  const events: string[] = [];
  const repository = {
    advanceStatuses: async () => {},
    listPlans: async () => [{ id: "plan", ...plan }],
    validateDraft: async () => true,
    createDraft: async () => {
      events.push("created");
      return "plan";
    },
    updateDraft: async () => true,
    publish: async () => ({ ok: true as const, taskCount: 2, status: "published" as const }),
    cancelPlan: async () => true,
    listTasks: async () => [],
    submitTask: async () => true,
    taskAuthorization: async () => ({ status: "submitted" }),
    confirmTask: async () => true,
    returnTask: async () => true,
    batchConfirm: async () => true,
  } as unknown as TrainingRepository;
  return {
    events,
    service: createTrainingService({
      repository,
      storage: createMemoryMaterialStorage(),
      idSource: () => "33333333-3333-4333-8333-333333333333",
      now: () => new Date("2026-07-28T00:00:00.000Z"),
    }),
  };
};

describe("training service", () => {
  test("creates a valid draft and rejects employee management", async () => {
    const { service, events } = setup();
    expect(await service.createPlan(actor("hr_admin"), plan)).toMatchObject({ ok: true });
    expect(events).toEqual(["created"]);
    expect(await service.createPlan(actor("employee"), plan)).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  test("rejects invalid ranges and missing explicit targets", async () => {
    const { service } = setup();
    expect(
      await service.createPlan(actor("hr_admin"), { ...plan, dueAt: plan.startAt }),
    ).toMatchObject({ error: { code: "INVALID_TRAINING_PLAN" } });
    const { scopeDepartmentId: _scopeDepartmentId, ...base } = plan;
    expect(
      await service.createPlan(actor("hr_admin"), {
        ...base,
        scopeType: "employees",
        scopeEmployeeIds: [],
      }),
    ).toMatchObject({ error: { code: "INVALID_TRAINING_PLAN" } });
  });

  test("keeps submit and manager confirmation as separate transitions", async () => {
    const { service } = setup();
    expect(await service.submitTask(actor("employee"), "task")).toMatchObject({
      data: { status: "submitted" },
    });
    expect(await service.submitTask(actor("department_manager"), "task")).toMatchObject({
      data: { status: "submitted" },
    });
    expect(await service.confirmTask(actor("department_manager"), "task")).toMatchObject({
      data: { status: "confirmed" },
    });
    expect(await service.confirmTask(actor("employee"), "task")).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  test("requires a return reason and accepts controlled batch evidence", async () => {
    const { service } = setup();
    expect(await service.returnTask(actor("department_manager"), "task", " ")).toMatchObject({
      error: { code: "RETURN_REASON_REQUIRED" },
    });
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]);
    expect(
      await service.batchConfirm(actor("hr_admin"), {
        planId: "plan",
        taskIds: ["task"],
        filename: "签到.pdf",
        mimeType: "application/pdf",
        bytes: pdf,
      }),
    ).toMatchObject({ ok: true, data: { confirmed: 1 } });
  });
});
