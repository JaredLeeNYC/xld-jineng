import { describe, expect, test } from "bun:test";
import { normalizeBusinessCode, organizationRoles } from "./organization";

describe("organization contracts", () => {
  test("normalizes stable business keys consistently", () => {
    expect(normalizeBusinessCode(" emp-001 ")).toBe("EMP-001");
  });

  test("allows only the five fixed account roles", () => {
    expect(organizationRoles).toEqual([
      "employee",
      "department_manager",
      "hr_admin",
      "executive_viewer",
      "system_admin",
    ]);
  });
});
