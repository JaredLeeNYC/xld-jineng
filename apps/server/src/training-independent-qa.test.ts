import { expect, test } from "bun:test";
import type { TrainingRepository } from "@jineng/skill-matrix-db";
import { createTrainingService } from "./training-service";
import { createMemoryMaterialStorage } from "./material-storage";
import type { SessionView } from "./auth-contract";

test("independent QA: factory-wide viewer reads training evidence with the same scope as tasks", async () => {
  let evidenceRole: string | undefined;
  const repository = {
    getEvidence: async (input: { actorRole: string }) => {
      evidenceRole = input.actorRole;
      return undefined;
    },
  } as unknown as TrainingRepository;
  const actor: SessionView = {
    accountId: "account",
    employeeId: "employee",
    employeeNumber: "M1",
    displayName: "主管",
    departmentId: "department",
    role: "department_manager",
    factoryRead: true,
    mustChangePassword: false,
  };
  const service = createTrainingService({
    repository,
    storage: createMemoryMaterialStorage(),
    idSource: () => "id",
    now: () => new Date(),
  });
  await service.evidenceContent(actor, "evidence");
  expect(evidenceRole).toBe("hr_admin");
});
