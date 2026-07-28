import { describe, expect, test } from "bun:test";
import { fixedRoles, hasPermission, navigationForRole, permissionsForRole } from "./index";

describe("fixed role authorization", () => {
  test("keeps the role model fixed to five factory roles", () => {
    expect(fixedRoles).toEqual([
      "employee",
      "department_manager",
      "hr_admin",
      "executive_viewer",
      "system_admin",
    ]);
  });

  test("keeps employee access personal and executive access read-only", () => {
    expect(hasPermission("employee", "self:read")).toBeTrue();
    expect(hasPermission("employee", "department:read")).toBeFalse();
    expect(hasPermission("executive_viewer", "factory:read")).toBeTrue();
    expect(hasPermission("executive_viewer", "factory:manage")).toBeFalse();
    expect(hasPermission("executive_viewer", "system:manage")).toBeFalse();
  });

  test("exposes only navigation allowed for each role", () => {
    expect(navigationForRole("employee").map((item) => item.id)).toEqual([
      "my-workspace",
      "profile",
      "my-skills",
      "my-training",
      "my-assessments",
      "notifications",
    ]);
    expect(
      navigationForRole("executive_viewer").every((item) => item.access === "read"),
    ).toBeTrue();
    expect(permissionsForRole("system_admin")).toContain("system:manage");
  });
});
