import type { SkillRepository } from "@jineng/skill-matrix-db";
import {
  isSkillLevel,
  normalizeBusinessCode,
  skillCategories,
  type SkillBaselineImportRow,
  type SkillCategory,
  type SkillImportError,
} from "@jineng/skill-matrix-shared";
import type { SessionView } from "./auth-contract";

type Failure = {
  ok: false;
  error: { code: string; message: string; status: 400 | 403 | 404 | 409 };
};
type Result<T> = { ok: true; data: T } | Failure;

const fail = (code: string, message: string, status: 400 | 403 | 404 | 409): Failure => ({
  ok: false,
  error: { code, message, status },
});
const hrOnly = (actor: SessionView) =>
  actor.role === "hr_admin"
    ? undefined
    : fail("FORBIDDEN", "仅 HR/培训管理员可以维护技能标准", 403);
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const createSkillService = (dependencies: {
  repository: SkillRepository;
  idSource: () => string;
  now: () => Date;
}) => {
  const { repository, idSource, now } = dependencies;
  return {
    async listSkills(
      actor: SessionView,
      input: { includeInactive?: boolean; query?: string } = {},
    ) {
      if (!["hr_admin", "department_manager", "executive_viewer"].includes(actor.role))
        return fail("FORBIDDEN", "无权查看技能目录", 403);
      return {
        ok: true as const,
        data: await repository.listSkills({
          ...(actor.role === "hr_admin" && input.includeInactive ? { includeInactive: true } : {}),
          ...(input.query ? { query: input.query } : {}),
        }),
      };
    },

    async createSkill(
      actor: SessionView,
      input: {
        code: string;
        name: string;
        category: SkillCategory;
        reassessmentRequired: boolean;
        validityMonths?: number;
      },
    ) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      const code = normalizeBusinessCode(input.code);
      if (
        !code ||
        !input.name.trim() ||
        !skillCategories.includes(input.category) ||
        (input.reassessmentRequired &&
          (!input.validityMonths || input.validityMonths < 1 || input.validityMonths > 120))
      )
        return fail("INVALID_SKILL", "技能编码、名称、分类或复评周期无效", 400);
      try {
        return {
          ok: true as const,
          data: await repository.createSkill({
            code,
            name: input.name.trim(),
            category: input.category,
            reassessmentRequired: input.reassessmentRequired,
            ...(input.reassessmentRequired ? { validityMonths: input.validityMonths } : {}),
            actorAccountId: actor.accountId,
          }),
        };
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "23505")
          return fail("DUPLICATE_SKILL_CODE", "技能编码已存在", 409);
        throw error;
      }
    },

    async updateSkill(
      actor: SessionView,
      id: string,
      input: {
        name: string;
        category: SkillCategory;
        reassessmentRequired: boolean;
        validityMonths?: number;
      },
    ) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      if (
        !input.name.trim() ||
        !skillCategories.includes(input.category) ||
        (input.reassessmentRequired &&
          (!input.validityMonths || input.validityMonths < 1 || input.validityMonths > 120))
      )
        return fail("INVALID_SKILL", "技能名称、分类或复评周期无效", 400);
      return (await repository.updateSkill({
        id,
        name: input.name.trim(),
        category: input.category,
        reassessmentRequired: input.reassessmentRequired,
        ...(input.reassessmentRequired ? { validityMonths: input.validityMonths } : {}),
        actorAccountId: actor.accountId,
      }))
        ? { ok: true as const, data: { id } }
        : fail("SKILL_NOT_FOUND", "技能不存在", 404);
    },

    async deactivateSkill(actor: SessionView, id: string) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      return (await repository.deactivateSkill({ id, actorAccountId: actor.accountId }))
        ? { ok: true as const, data: { id, active: false as const } }
        : fail("SKILL_NOT_FOUND", "技能不存在或已停用", 404);
    },

    async listRequirements(actor: SessionView, positionId?: string) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      return { ok: true as const, data: await repository.listRequirements(positionId) };
    },

    async saveRequirement(
      actor: SessionView,
      input: { positionId: string; skillId: string; requiredLevel: number; required: boolean },
    ) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      if (!isSkillLevel(input.requiredLevel))
        return fail("INVALID_SKILL_LEVEL", "技能等级必须为 0-4", 400);
      return (await repository.upsertRequirement({
        ...input,
        requiredLevel: input.requiredLevel,
        actorAccountId: actor.accountId,
      }))
        ? { ok: true as const, data: input }
        : fail("INVALID_REQUIREMENT_REFERENCE", "岗位或技能不存在、已停用", 409);
    },

    async copyRequirements(
      actor: SessionView,
      input: { sourcePositionId: string; targetPositionId: string; levelDelta: number },
    ) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      if (!Number.isInteger(input.levelDelta) || input.levelDelta < -4 || input.levelDelta > 4)
        return fail("INVALID_LEVEL_DELTA", "批量等级调整必须在 -4 到 4 之间", 400);
      const copied = await repository.copyRequirements({
        ...input,
        actorAccountId: actor.accountId,
      });
      return copied === undefined
        ? fail("INVALID_POSITION", "源岗位或目标岗位无效", 409)
        : { ok: true as const, data: { copied } };
    },

    async dryRunBaseline(
      actor: SessionView,
      rawRows: SkillBaselineImportRow[],
    ): Promise<
      Result<{
        previewId: string;
        totalRows: number;
        validRows: number;
        errors: SkillImportError[];
        expiresAt: string;
      }>
    > {
      const denied = hrOnly(actor);
      if (denied) return denied;
      if (rawRows.length === 0 || rawRows.length > 5_000)
        return fail("INVALID_IMPORT_SIZE", "初始技能导入应包含 1-5000 行", 400);
      const refs = await repository.findBaselineReferences();
      const employees = new Map(refs.employees.map((item) => [item.employeeNumber, item.id]));
      const skills = new Map(refs.skills.map((item) => [item.code, item.id]));
      const current = new Set(refs.current.map((item) => `${item.employeeId}:${item.skillId}`));
      const seen = new Set<string>();
      const rows = rawRows.map((row) => ({
        ...row,
        employeeNumber: normalizeBusinessCode(row.employeeNumber),
        skillCode: normalizeBusinessCode(row.skillCode),
        sourceReference: row.sourceReference.trim(),
      }));
      const errors: SkillImportError[] = [];
      for (const row of rows) {
        if (!row.employeeNumber)
          errors.push({
            rowNumber: row.rowNumber,
            field: "employeeNumber",
            code: "REQUIRED",
            message: "工号不能为空",
          });
        if (!row.skillCode)
          errors.push({
            rowNumber: row.rowNumber,
            field: "skillCode",
            code: "REQUIRED",
            message: "技能编码不能为空",
          });
        if (!row.sourceReference)
          errors.push({
            rowNumber: row.rowNumber,
            field: "sourceReference",
            code: "REQUIRED",
            message: "来源说明不能为空",
          });
        else if (row.sourceReference.length > 300)
          errors.push({
            rowNumber: row.rowNumber,
            field: "sourceReference",
            code: "INVALID_VALUE",
            message: "来源说明不能超过 300 个字符",
          });
        const employeeId = employees.get(row.employeeNumber);
        const skillId = skills.get(row.skillCode);
        if (row.employeeNumber && !employeeId)
          errors.push({
            rowNumber: row.rowNumber,
            field: "employeeNumber",
            code: "INVALID_EMPLOYEE",
            message: "员工不存在或已停用",
          });
        if (row.skillCode && !skillId)
          errors.push({
            rowNumber: row.rowNumber,
            field: "skillCode",
            code: "INVALID_SKILL",
            message: "技能不存在或已停用",
          });
        if (!isSkillLevel(row.level))
          errors.push({
            rowNumber: row.rowNumber,
            field: "level",
            code: "INVALID_LEVEL",
            message: "等级必须为 0-4",
          });
        if (!validDate(row.assessedAt) || new Date(`${row.assessedAt}T00:00:00.000Z`) > now())
          errors.push({
            rowNumber: row.rowNumber,
            field: "assessedAt",
            code: "INVALID_DATE",
            message: "评定日期无效或晚于当前日期",
          });
        if (employeeId && skillId) {
          const key = `${employeeId}:${skillId}`;
          if (seen.has(key))
            errors.push({
              rowNumber: row.rowNumber,
              field: "skillCode",
              code: "DUPLICATE",
              message: "同一员工技能在文件中重复",
            });
          if (current.has(key))
            errors.push({
              rowNumber: row.rowNumber,
              field: "skillCode",
              code: "ALREADY_ASSESSED",
              message: "该员工技能已有当前评定",
            });
          seen.add(key);
        }
      }
      const previewId = idSource();
      const expiresAt = new Date(now().getTime() + 30 * 60 * 1000);
      await repository.storeBaselinePreview({
        id: previewId,
        actorAccountId: actor.accountId,
        rows,
        errors,
        expiresAt,
      });
      return {
        ok: true,
        data: {
          previewId,
          totalRows: rows.length,
          validRows: rows.length - new Set(errors.map((item) => item.rowNumber)).size,
          errors,
          expiresAt: expiresAt.toISOString(),
        },
      };
    },

    async confirmBaseline(actor: SessionView, previewId: string) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      const preview = await repository.loadBaselinePreview(previewId, actor.accountId);
      if (!preview || preview.confirmedAt || preview.expiresAt <= now())
        return fail("IMPORT_PREVIEW_EXPIRED", "预检不存在、已确认或已过期", 409);
      if (preview.errors.length > 0)
        return fail("IMPORT_HAS_ERRORS", "请修正全部预检错误后重新上传", 409);
      try {
        const imported = await repository.confirmBaselineImport({
          previewId,
          actorAccountId: actor.accountId,
          rows: preview.rows,
          now: now(),
        });
        return imported === undefined
          ? fail("IMPORT_PREVIEW_EXPIRED", "预检不存在、已确认或已过期", 409)
          : { ok: true as const, data: { imported } };
      } catch (error) {
        if (
          (typeof error === "object" && error && "code" in error && error.code === "23505") ||
          String(error).includes("BASELINE_REFERENCE_CHANGED")
        )
          return fail("IMPORT_CONFLICT", "员工或技能状态已变化，请重新预检", 409);
        throw error;
      }
    },

    async matrix(
      actor: SessionView,
      filters: {
        departmentId?: string;
        employeeId?: string;
        positionId?: string;
        skillId?: string;
      } = {},
    ) {
      if (actor.role === "system_admin") return fail("FORBIDDEN", "无权查看业务技能矩阵", 403);
      if (actor.role === "department_manager" && !actor.departmentId)
        return fail("FORBIDDEN", "主管账号未关联部门", 403);
      return {
        ok: true as const,
        data: await repository.listMatrix({
          ...filters,
          ...(actor.role === "department_manager" ? { departmentId: actor.departmentId } : {}),
          ...(actor.role === "employee" ? { employeeId: actor.employeeId } : {}),
          now: now(),
        }),
      };
    },
  };
};

export type SkillService = ReturnType<typeof createSkillService>;
