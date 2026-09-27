import { expect, test } from "bun:test";
import type { OrganizationRepository } from "@jineng/skill-matrix-db";
import { createOrganizationService } from "./organization-service";
import type { SessionView } from "./auth-contract";
const hr = { accountId: "h", employeeId: "h", role: "hr_admin", departmentId: "d1" } as SessionView;
const fixture = () => {
  let written: unknown;
  const service = createOrganizationService({
    repository: {
      listAreas: async () => [
        { id: "a", name: "区域A", departmentId: "d1", departmentName: "部门", active: true },
      ],
      setEmployeeArea: async (input: unknown) => {
        written = input;
        return false;
      },
      createArea: async (input: unknown) => {
        written = input;
        return { id: "a" };
      },
    } as unknown as OrganizationRepository,
    passwordHash: async (v) => v,
    temporaryPassword: () => "p",
    idSource: () => "i",
    now: () => new Date(),
  });
  return { service, written: () => written };
};
test("区域查看遵循部门权限，写入仅 HR", async () => {
  const { service, written } = fixture();
  const listed = await service.listAreas({ ...hr, role: "department_manager", departmentId: "d2" });
  expect(listed.ok && listed.data).toEqual([]);
  expect(
    (await service.createArea({ ...hr, role: "employee" }, { name: "一区", departmentId: "d1" }))
      .ok,
  ).toBe(false);
  expect(written()).toBeUndefined();
});
test("拒绝无效区域归属，允许明确清空", async () => {
  const { service, written } = fixture();
  const result = await service.setEmployeeArea(hr, "e", { areaId: "a" });
  expect(result.ok).toBe(false);
  expect(written()).toEqual({ employeeId: "e", areaId: "a", actorAccountId: "h" });
  await service.setEmployeeArea(hr, "e", { areaId: null });
  expect(written()).toEqual({ employeeId: "e", areaId: null, actorAccountId: "h" });
});
