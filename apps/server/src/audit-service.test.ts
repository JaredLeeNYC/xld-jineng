import { describe, expect, test } from "bun:test";
import { createAuditService } from "./audit-service";

const actor = {
  accountId: "a1",
  employeeId: "e1",
  employeeNumber: "A001",
  displayName: "管理员",
  role: "system_admin" as const,
  mustChangePassword: false,
};

describe("audit service", () => {
  test("allows only system administrators and bounds the result size", async () => {
    let limit = 0;
    const service = createAuditService({
      list: async (input) => {
        limit = input.limit;
        return [];
      },
    });
    expect((await service.list({ ...actor, role: "hr_admin" }, {})).ok).toBe(false);
    expect((await service.list(actor, { limit: 10_000 })).ok).toBe(true);
    expect(limit).toBe(500);
  });
});
