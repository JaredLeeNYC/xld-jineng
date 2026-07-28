import type { TrainingRepository } from "@jineng/skill-matrix-db";
import {
  allowedMaterialMimeTypes,
  maximumMaterialBytes,
  trainingScopeTypes,
  type TrainingScopeType,
} from "@jineng/skill-matrix-shared";
import { createHash } from "node:crypto";
import type { SessionView } from "./auth-contract";
import type { MaterialStorage } from "./material-storage";

const fail = (code: string, message: string, status: 400 | 403 | 404 | 409 | 500) => ({
  ok: false as const,
  error: { code, message, status },
});
const manager = (actor: SessionView) =>
  actor.role === "hr_admin" || actor.role === "department_manager";
const actorScope = (actor: SessionView) => ({
  accountId: actor.accountId,
  role: actor.role as "hr_admin" | "department_manager",
  ...(actor.departmentId ? { departmentId: actor.departmentId } : {}),
});
const validDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const safeFilename = (value: string) =>
  value.length > 0 && value.length <= 255 && !value.includes("..") && !/[\\/]/.test(value);
const evidenceSignature = (mime: string, bytes: Uint8Array) => {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (mime === "application/pdf") return starts(0x25, 0x50, 0x44, 0x46);
  if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
  if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mime === "image/webp") return starts(0x52, 0x49, 0x46, 0x46);
  return false;
};

type PlanInput = {
  title: string;
  materialId: string;
  ownerEmployeeId: string;
  startAt: string;
  dueAt: string;
  location: string;
  scopeType: TrainingScopeType;
  scopeDepartmentId?: string;
  scopePositionId?: string;
  scopeEmployeeIds?: string[];
};

export const createTrainingService = (dependencies: {
  repository: TrainingRepository;
  storage: MaterialStorage;
  idSource: () => string;
  now: () => Date;
  storageWarning?: (error: unknown) => void;
}) => {
  const { repository, storage, idSource, now, storageWarning = console.error } = dependencies;
  const parsePlan = (input: PlanInput) => {
    const startAt = validDate(input.startAt);
    const dueAt = validDate(input.dueAt);
    if (
      !input.title.trim() ||
      input.title.trim().length > 150 ||
      !input.location.trim() ||
      input.location.trim().length > 150 ||
      !startAt ||
      !dueAt ||
      dueAt <= startAt ||
      !trainingScopeTypes.includes(input.scopeType)
    )
      return undefined;
    if (
      (input.scopeType === "department" && !input.scopeDepartmentId) ||
      (input.scopeType === "position" && !input.scopePositionId) ||
      (input.scopeType === "employees" && !input.scopeEmployeeIds?.length)
    )
      return undefined;
    return {
      title: input.title.trim(),
      materialId: input.materialId,
      ownerEmployeeId: input.ownerEmployeeId,
      startAt,
      dueAt,
      location: input.location.trim(),
      scopeType: input.scopeType,
      ...(input.scopeType === "department" ? { scopeDepartmentId: input.scopeDepartmentId } : {}),
      ...(input.scopeType === "position" ? { scopePositionId: input.scopePositionId } : {}),
      scopeEmployeeIds: input.scopeType === "employees" ? [...new Set(input.scopeEmployeeIds)] : [],
    };
  };
  return {
    async listPlans(actor: SessionView) {
      if (!manager(actor)) return fail("FORBIDDEN", "无权查看培训计划", 403);
      await repository.advanceStatuses(now());
      return { ok: true as const, data: await repository.listPlans(actorScope(actor)) };
    },
    async createPlan(actor: SessionView, input: PlanInput) {
      if (!manager(actor)) return fail("FORBIDDEN", "无权创建培训计划", 403);
      const parsed = parsePlan(input);
      if (!parsed) return fail("INVALID_TRAINING_PLAN", "培训计划字段或时间范围无效", 400);
      if (!(await repository.validateDraft(parsed, actorScope(actor))))
        return fail("INVALID_TRAINING_SCOPE", "资料、负责人或培训对象无效或超出权限范围", 409);
      const id = idSource();
      await repository.createDraft({ ...parsed, id, actor: actorScope(actor) });
      return { ok: true as const, data: { id, status: "draft" as const } };
    },
    async updatePlan(actor: SessionView, id: string, input: PlanInput) {
      if (!manager(actor)) return fail("FORBIDDEN", "无权编辑培训计划", 403);
      const parsed = parsePlan(input);
      if (!parsed) return fail("INVALID_TRAINING_PLAN", "培训计划字段或时间范围无效", 400);
      if (!(await repository.validateDraft(parsed, actorScope(actor))))
        return fail("INVALID_TRAINING_SCOPE", "资料、负责人或培训对象无效或超出权限范围", 409);
      return (await repository.updateDraft(id, { ...parsed, actor: actorScope(actor) }))
        ? { ok: true as const, data: { id } }
        : fail("INVALID_PLAN_STATE", "计划不存在、无权编辑或已不再是草稿", 409);
    },
    async publishPlan(actor: SessionView, id: string) {
      if (!manager(actor)) return fail("FORBIDDEN", "无权发布培训计划", 403);
      const result = await repository.publish(id, actorScope(actor), now());
      if (!result.ok)
        return fail(
          "PLAN_PUBLISH_REJECTED",
          result.reason === "scope"
            ? "培训对象为空或超出权限范围"
            : result.reason === "material"
              ? "培训资料已停用"
              : "仅草稿计划可以发布",
          409,
        );
      return {
        ok: true as const,
        data: { id, taskCount: result.taskCount, status: result.status },
      };
    },
    async cancelPlan(actor: SessionView, id: string) {
      if (!manager(actor)) return fail("FORBIDDEN", "无权取消培训计划", 403);
      return (await repository.cancelPlan(id, actorScope(actor), now()))
        ? { ok: true as const, data: { id, status: "cancelled" as const } }
        : fail("PLAN_CANCEL_REJECTED", "计划状态不允许取消，或已有确认履历", 409);
    },
    async listTasks(actor: SessionView) {
      if (!manager(actor) && actor.role !== "employee")
        return fail("FORBIDDEN", "无权查看培训任务", 403);
      await repository.advanceStatuses(now());
      return {
        ok: true as const,
        data: await repository.listTasks({
          now: now(),
          actorRole: actor.role,
          employeeId: actor.employeeId,
          accountId: actor.accountId,
          ...(actor.departmentId ? { departmentId: actor.departmentId } : {}),
        }),
      };
    },
    async submitTask(actor: SessionView, id: string) {
      if (actor.role !== "employee") return fail("FORBIDDEN", "仅员工本人可以提交培训任务", 403);
      return (await repository.submitTask(id, actor.employeeId, now(), actor.accountId))
        ? { ok: true as const, data: { id, status: "submitted" as const } }
        : fail("TASK_SUBMIT_REJECTED", "任务不存在、已取消或当前状态不可提交", 409);
    },
    async confirmTask(actor: SessionView, id: string) {
      if (!manager(actor)) return fail("FORBIDDEN", "无权确认培训任务", 403);
      if (!(await repository.taskAuthorization(id, actorScope(actor))))
        return fail("TASK_NOT_FOUND", "任务不存在或超出管理范围", 404);
      if (!(await repository.confirmTask(id, actor.accountId, now())))
        return fail("TASK_CONFIRM_REJECTED", "仅员工已提交的任务可以确认", 409);
      try {
        await repository.advanceStatuses(now());
      } catch (error) {
        storageWarning(error);
      }
      return { ok: true as const, data: { id, status: "confirmed" as const } };
    },
    async returnTask(actor: SessionView, id: string, reason: string) {
      if (!manager(actor)) return fail("FORBIDDEN", "无权退回培训任务", 403);
      if (!reason.trim() || reason.trim().length > 500)
        return fail("RETURN_REASON_REQUIRED", "退回原因必填且不得超过 500 字", 400);
      if (!(await repository.taskAuthorization(id, actorScope(actor))))
        return fail("TASK_NOT_FOUND", "任务不存在或超出管理范围", 404);
      return (await repository.returnTask(id, reason.trim(), actor.accountId, now()))
        ? { ok: true as const, data: { id, status: "returned" as const } }
        : fail("TASK_RETURN_REJECTED", "仅员工已提交的任务可以退回", 409);
    },
    async batchConfirm(
      actor: SessionView,
      input: {
        planId: string;
        taskIds: string[];
        filename: string;
        mimeType: string;
        bytes: Uint8Array;
      },
    ) {
      if (!manager(actor)) return fail("FORBIDDEN", "无权批量确认培训任务", 403);
      const visiblePlans = await repository.listPlans(actorScope(actor));
      if (!visiblePlans.some((plan) => plan.id === input.planId))
        return fail("PLAN_NOT_FOUND", "计划不存在或超出管理范围", 404);
      if (
        !safeFilename(input.filename) ||
        !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(input.mimeType) ||
        !allowedMaterialMimeTypes.includes(
          input.mimeType as (typeof allowedMaterialMimeTypes)[number],
        ) ||
        !evidenceSignature(input.mimeType, input.bytes) ||
        input.bytes.byteLength === 0 ||
        input.bytes.byteLength > maximumMaterialBytes
      )
        return fail("INVALID_EVIDENCE", "签到证据仅支持 25MB 内的 PDF 或图片", 400);
      const evidenceId = idSource();
      const storageKey = idSource();
      let locked = false;
      try {
        await storage.beginWrite(storageKey);
        locked = true;
        await storage.put(storageKey, input.bytes);
        const saved = await repository.batchConfirm({
          planId: input.planId,
          taskIds: [...new Set(input.taskIds)],
          evidence: {
            id: evidenceId,
            storageKey,
            originalFilename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            checksum: checksum(input.bytes),
          },
          actorAccountId: actor.accountId,
          actorRole: actor.role as "hr_admin" | "department_manager",
          actorEmployeeId: actor.employeeId,
          ...(actor.departmentId ? { actorDepartmentId: actor.departmentId } : {}),
          now: now(),
        });
        if (!saved) {
          await storage.delete(storageKey);
          return fail("BATCH_CONFIRM_REJECTED", "所选任务无效或已确认", 409);
        }
        try {
          await repository.advanceStatuses(now());
        } catch (error) {
          storageWarning(error);
        }
        return { ok: true as const, data: { evidenceId, confirmed: new Set(input.taskIds).size } };
      } catch {
        try {
          await storage.delete(storageKey);
        } catch {}
        return fail("EVIDENCE_STORAGE_FAILED", "签到证据保存失败", 500);
      } finally {
        if (locked) {
          try {
            await storage.endWrite(storageKey);
          } catch (error) {
            storageWarning(error);
          }
        }
      }
    },
    async evidenceContent(actor: SessionView, id: string) {
      if (!manager(actor) && actor.role !== "employee")
        return fail("FORBIDDEN", "无权查看培训证据", 403);
      const evidence = await repository.getEvidence({
        evidenceId: id,
        actorRole: actor.role,
        employeeId: actor.employeeId,
        ...(actor.departmentId ? { departmentId: actor.departmentId } : {}),
      });
      if (!evidence) return fail("EVIDENCE_NOT_FOUND", "培训证据不存在或超出权限范围", 404);
      try {
        const bytes = await storage.get(evidence.storageKey);
        if (checksum(bytes) !== evidence.checksum)
          return fail("CHECKSUM_MISMATCH", "培训证据校验失败，请联系管理员", 500);
        return {
          ok: true as const,
          data: {
            bytes,
            filename: evidence.originalFilename,
            mimeType: evidence.mimeType,
          },
        };
      } catch {
        return fail("EVIDENCE_READ_FAILED", "培训证据读取失败", 500);
      }
    },
  };
};

export type TrainingService = ReturnType<typeof createTrainingService>;
