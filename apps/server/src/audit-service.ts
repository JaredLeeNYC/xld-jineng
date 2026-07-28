import type { AuditRepository } from "@jineng/skill-matrix-db";
import type { SessionView } from "./auth-contract";

export const createAuditService = (repository: AuditRepository) => ({
  async list(
    actor: SessionView,
    input: { source?: "business" | "security"; action?: string; limit?: number },
  ) {
    if (actor.role !== "system_admin")
      return {
        ok: false as const,
        error: { code: "FORBIDDEN", message: "仅系统管理员可查看审计日志", status: 403 as const },
      };
    const requestedLimit = Number.isInteger(input.limit) ? input.limit! : 100;
    return {
      ok: true as const,
      data: await repository.list({
        ...(input.source ? { source: input.source } : {}),
        ...(input.action?.trim() ? { action: input.action.trim() } : {}),
        limit: Math.min(Math.max(requestedLimit, 1), 500),
      }),
    };
  },
});

export type AuditService = ReturnType<typeof createAuditService>;
