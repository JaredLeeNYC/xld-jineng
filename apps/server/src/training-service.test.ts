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
    submitPlan: async () => true,
    rejectPlan: async () => true,
    deletePlan: async () => true,
    executeTask: async () => true,
    publish: async () => ({ ok: true as const, taskCount: 2, status: "published" as const }),
    cancelPlan: async () => true,
    withdrawPlan: async () => true,
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
  test("accepts past plan dates for creating and editing historical training", async () => {
    const { service, events } = setup();
    const historicalPlan = {
      ...plan,
      startAt: "2025-06-10T09:00:00+08:00",
      dueAt: "2025-06-10T17:00:00+08:00",
    };
    expect(await service.createPlan(actor("hr_admin"), historicalPlan)).toMatchObject({
      ok: true,
      data: { status: "draft" },
    });
    expect(await service.updatePlan(actor("hr_admin"), "plan", historicalPlan)).toMatchObject({
      ok: true,
    });
    expect(events).toEqual(["created"]);
    expect(
      await service.createPlan(actor("hr_admin"), {
        ...historicalPlan,
        dueAt: "2025-06-10T08:00:00+08:00",
      }),
    ).toMatchObject({ error: { code: "INVALID_TRAINING_PLAN" } });
  });

  test("creates a valid draft and rejects employee management", async () => {
    const { service, events } = setup();
    expect(await service.createPlan(actor("hr_admin"), plan)).toMatchObject({ ok: true });
    expect(events).toEqual(["created"]);
    expect(await service.createPlan(actor("employee"), plan)).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  test("historical completion requires past dates and preserves the selected mode", async () => {
    const drafts: Array<{ historicalCompleted?: boolean; startAt: Date; dueAt: Date }> = [];
    const service = createTrainingService({
      repository: {
        validateDraft: async () => true,
        createDraft: async (input: Parameters<TrainingRepository["createDraft"]>[0]) => {
          drafts.push(input);
          return input.id;
        },
        updateDraft: async (
          _id: string,
          input: Parameters<TrainingRepository["updateDraft"]>[1],
        ) => {
          drafts.push(input);
          return true;
        },
      } as unknown as TrainingRepository,
      storage: createMemoryMaterialStorage(),
      idSource: () => "plan",
      now: () => new Date("2026-07-28T00:00:00Z"),
    });
    const historical = {
      ...plan,
      startAt: "2025-06-10T09:00:00+08:00",
      dueAt: "2025-06-10T17:00:00+08:00",
      historicalCompleted: true,
    };
    expect(await service.createPlan(actor("hr_admin"), historical)).toMatchObject({ ok: true });
    expect(drafts[0]).toMatchObject({
      historicalCompleted: true,
      startAt: new Date("2025-06-10T01:00:00Z"),
      dueAt: new Date("2025-06-10T09:00:00Z"),
    });
    expect(
      await service.updatePlan(actor("hr_admin"), "plan", {
        ...historical,
        historicalCompleted: false,
      }),
    ).toMatchObject({ ok: true });
    expect(drafts[1]?.historicalCompleted).toBe(false);
    for (const input of [
      { ...plan, historicalCompleted: true },
      { ...historical, dueAt: "invalid" },
      { ...historical, dueAt: historical.startAt },
    ]) {
      expect(await service.createPlan(actor("hr_admin"), input)).toMatchObject({
        error: { code: "INVALID_TRAINING_PLAN" },
      });
      expect(await service.updatePlan(actor("hr_admin"), "plan", input)).toMatchObject({
        error: { code: "INVALID_TRAINING_PLAN" },
      });
    }
    expect(drafts).toHaveLength(2);
    expect(await service.createPlan(actor("employee"), historical)).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  test("accepts all four training types and rejects unknown values", async () => {
    const { service } = setup();
    for (const trainingType of ["professional", "general", "safety", "other"] as const) {
      expect(await service.createPlan(actor("hr_admin"), { ...plan, trainingType })).toMatchObject({
        ok: true,
      });
    }
    expect(
      await service.createPlan(actor("hr_admin"), { ...plan, trainingType: "invalid" as never }),
    ).toMatchObject({ error: { code: "INVALID_TRAINING_PLAN" } });
  });

  test("withdrawal requires management authorization and preserves repository state conflicts", async () => {
    const { service } = setup();
    expect(await service.withdrawPlan(actor("employee"), "plan")).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    expect(await service.withdrawPlan(actor("hr_admin"), "plan")).toMatchObject({
      data: { status: "draft" },
    });
    const rejected = createTrainingService({
      repository: { withdrawPlan: async () => false } as unknown as TrainingRepository,
      storage: createMemoryMaterialStorage(),
      idSource: () => "id",
      now: () => new Date(),
    });
    expect(await rejected.withdrawPlan(actor("department_manager"), "plan")).toMatchObject({
      error: { code: "PLAN_WITHDRAW_REJECTED" },
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

  test("disables employee submission while preserving legacy confirmation", async () => {
    const { service } = setup();
    expect(await service.submitTask(actor("employee"), "task")).toMatchObject({
      error: { code: "EMPLOYEE_SUBMISSION_DISABLED" },
    });
    expect(await service.submitTask(actor("department_manager"), "task")).toMatchObject({
      error: { code: "EMPLOYEE_SUBMISSION_DISABLED" },
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

test("approval cannot be bypassed; draft submission and approval are separate", async () => {
  const { service } = setup();
  expect(await service.publishPlan(actor("hr_admin"), "plan")).toMatchObject({
    error: { code: "APPROVAL_REQUIRED" },
  });
  expect(await service.submitPlan(actor("hr_admin"), "plan")).toMatchObject({
    data: { status: "pending_approval" },
  });
  expect(await service.approvePlan(actor("employee"), "plan")).toMatchObject({
    error: { code: "FORBIDDEN" },
  });
  expect(await service.approvePlan(actor("hr_admin"), "plan")).toMatchObject({
    data: { status: "published" },
  });
  expect(await service.rejectPlan(actor("hr_admin"), "plan", " ")).toMatchObject({
    error: { code: "RETURN_REASON_REQUIRED" },
  });
});
test("multi-selection draft is normalized and empty materials rejected", async () => {
  const { service } = setup();
  expect(
    await service.createPlan(actor("hr_admin"), {
      ...plan,
      materialIds: [plan.materialId],
      ownerEmployeeIds: [plan.ownerEmployeeId],
      scopeDepartmentIds: [plan.scopeDepartmentId],
    }),
  ).toMatchObject({ ok: true });
  expect(await service.createPlan(actor("hr_admin"), { ...plan, materialIds: [] })).toMatchObject({
    error: { code: "INVALID_TRAINING_PLAN" },
  });
});
test("task execution rejects unauthorized owner or invalid state returned by repository", async () => {
  const service = createTrainingService({
    repository: { executeTask: async () => false } as unknown as TrainingRepository,
    storage: createMemoryMaterialStorage(),
    idSource: () => "id",
    now: () => new Date(),
  });
  expect(await service.startTask(actor("employee"), "task")).toMatchObject({
    error: { code: "FORBIDDEN" },
  });
  expect(await service.completeTask(actor("hr_admin"), "task")).toMatchObject({
    error: { code: "TASK_COMPLETE_REJECTED" },
  });
});
