import { expect, test } from "bun:test";
import type { OrganizationRepository, SkillRepository } from "@jineng/skill-matrix-db";
import { createOrganizationService } from "./organization-service";
import { createSkillService } from "./skill-service";
import type { SessionView } from "./auth-contract";
const actor: SessionView = {
  accountId: "a",
  employeeId: "e",
  employeeNumber: "M",
  displayName: "主管",
  role: "department_manager",
  departmentId: "d1",
  mustChangePassword: false,
};
test("independent acceptance: factory viewer reads all areas but all four writes remain denied", async () => {
  let includeInactive: boolean | undefined;
  let writes = 0;
  const repository = {
    listAreas: async (include?: boolean) => {
      includeInactive = include;
      return [
        { id: "a1", name: "一区", departmentId: "d1", departmentName: "一部", active: true },
        { id: "a2", name: "二区", departmentId: "d2", departmentName: "二部", active: true },
      ];
    },
    createArea: async () => {
      writes++;
      return { id: "a" };
    },
    updateArea: async () => {
      writes++;
      return true;
    },
    deactivateArea: async () => {
      writes++;
      return true;
    },
    setEmployeeArea: async () => {
      writes++;
      return true;
    },
  } as unknown as OrganizationRepository;
  const service = createOrganizationService({
    repository,
    passwordHash: async (x) => x,
    temporaryPassword: () => "",
    idSource: () => "",
    now: () => new Date(),
  });
  const local = await service.listAreas(actor, true);
  expect(local.ok && local.data.map((a) => a.id)).toEqual(["a1"]);
  expect(includeInactive).toBe(false);
  const wide = { ...actor, factoryRead: true };
  const global = await service.listAreas(wide, true);
  expect(global.ok && global.data.length).toBe(2);
  for (const result of [
    await service.createArea(wide, { name: "三区", departmentId: "d2" }),
    await service.updateArea(wide, "a2", { name: "新版" }),
    await service.deactivateArea(wide, "a2"),
    await service.setEmployeeArea(wide, "e2", { areaId: "a2" }),
  ])
    expect(result.ok).toBe(false);
  expect(writes).toBe(0);
});
test("independent acceptance: foreign area cannot override manager department or employee self scope", async () => {
  let filters: unknown;
  const repository = {
    listMatrix: async (input: unknown) => {
      filters = input;
      return [];
    },
  } as unknown as SkillRepository;
  const service = createSkillService({
    repository,
    idSource: () => "",
    now: () => new Date("2026-09-27"),
  });
  await service.matrix(actor, { departmentId: "d2", areaId: "a2" });
  expect(filters).toMatchObject({ departmentId: "d1", areaId: "a2" });
  await service.matrix({ ...actor, role: "employee" }, { employeeId: "other", areaId: "a2" });
  expect(filters).toMatchObject({ employeeId: "e", areaId: "a2" });
  const hr = await service.matrix({ ...actor, role: "hr_admin" }, { departmentId: "d2" });
  expect(hr.ok).toBe(true);
  expect(filters).toMatchObject({ departmentId: "d2" });
});
