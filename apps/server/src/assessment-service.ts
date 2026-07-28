import type { AssessmentRepository } from "@jineng/skill-matrix-db";
import {
  assessmentMethods,
  isSkillLevel,
  maximumMaterialBytes,
  type AssessmentMethod,
} from "@jineng/skill-matrix-shared";
import { createHash } from "node:crypto";
import type { SessionView } from "./auth-contract";
import type { MaterialStorage } from "./material-storage";

const fail = (code: string, message: string, status: 400 | 403 | 404 | 409 | 500) => ({
  ok: false as const,
  error: { code, message, status },
});
const canAssess = (actor: SessionView) =>
  actor.role === "department_manager" || actor.role === "hr_admin";
const canRead = (actor: SessionView) =>
  ["employee", "department_manager", "hr_admin", "executive_viewer"].includes(actor.role);
const actorScope = (actor: SessionView) => ({
  accountId: actor.accountId,
  employeeId: actor.employeeId,
  role: actor.role as "employee" | "department_manager" | "hr_admin" | "executive_viewer",
  ...(actor.departmentId ? { departmentId: actor.departmentId } : {}),
});
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const safeFilename = (value: string) =>
  value.length > 0 &&
  value.length <= 255 &&
  !value.includes("..") &&
  !value.includes("\\") &&
  !value.includes("/") &&
  !value.includes(String.fromCharCode(0));
const validEvidence = (mime: string, bytes: Uint8Array) => {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (mime === "application/pdf") return starts(0x25, 0x50, 0x44, 0x46);
  if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
  if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mime === "image/webp")
    return starts(0x52, 0x49, 0x46, 0x46) && bytes.slice(8, 12).toString() === "87,69,66,80";
  return false;
};

type AssessmentInput = {
  employeeId: string;
  skillId: string;
  method: AssessmentMethod;
  level: number;
  passed: boolean;
  reason?: string;
  remediation?: string;
  assessedAt: string;
  replacesAssessmentId?: string;
};

export const createAssessmentService = (dependencies: {
  repository: AssessmentRepository;
  storage: MaterialStorage;
  idSource: () => string;
  now: () => Date;
  storageWarning?: (error: unknown) => void;
}) => {
  const { repository, storage, idSource, now, storageWarning = console.error } = dependencies;
  const parse = (input: AssessmentInput) => {
    const assessedAt = new Date(input.assessedAt);
    if (
      !assessmentMethods.includes(input.method) ||
      !isSkillLevel(input.level) ||
      Number.isNaN(assessedAt.getTime()) ||
      assessedAt > now() ||
      (input.reason?.length ?? 0) > 500 ||
      (input.remediation?.length ?? 0) > 500 ||
      (!input.passed && !input.reason?.trim())
    )
      return undefined;
    return {
      employeeId: input.employeeId,
      skillId: input.skillId,
      method: input.method,
      level: input.level,
      passed: input.passed,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      ...(input.remediation?.trim() ? { remediation: input.remediation.trim() } : {}),
      assessedAt,
      ...(input.replacesAssessmentId ? { replacesAssessmentId: input.replacesAssessmentId } : {}),
    };
  };
  return {
    async list(actor: SessionView) {
      if (!canRead(actor)) return fail("FORBIDDEN", "无权查看技能评定", 403);
      return { ok: true as const, data: await repository.list(actorScope(actor)) };
    },
    async create(
      actor: SessionView,
      input: AssessmentInput & { filename: string; mimeType: string; bytes: Uint8Array },
    ) {
      if (!canAssess(actor)) return fail("FORBIDDEN", "无权录入技能评定", 403);
      const parsed = parse(input);
      if (
        !parsed ||
        !safeFilename(input.filename) ||
        !validEvidence(input.mimeType, input.bytes) ||
        input.bytes.byteLength === 0 ||
        input.bytes.byteLength > maximumMaterialBytes
      )
        return fail(
          "INVALID_ASSESSMENT",
          "评定信息无效；未通过时原因必填，证据仅支持 25MB 内 PDF 或图片",
          400,
        );
      const storageKey = idSource();
      let locked = false;
      try {
        await storage.beginWrite(storageKey);
        locked = true;
        await storage.put(storageKey, input.bytes);
        const id = await repository.create(actorScope(actor), {
          ...parsed,
          evidence: {
            storageKey,
            originalFilename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            checksum: checksum(input.bytes),
          },
        });
        if (!id) {
          await storage.delete(storageKey);
          return fail("ASSESSMENT_TARGET_NOT_FOUND", "员工、技能或被替换评定无效", 404);
        }
        return { ok: true as const, data: { id, status: "draft" as const } };
      } catch {
        try {
          await storage.delete(storageKey);
        } catch {}
        return fail("EVIDENCE_STORAGE_FAILED", "评定证据保存失败", 500);
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
    async update(actor: SessionView, id: string, input: AssessmentInput) {
      if (!canAssess(actor)) return fail("FORBIDDEN", "无权修订技能评定", 403);
      const parsed = parse(input);
      if (!parsed) return fail("INVALID_ASSESSMENT", "评定信息无效", 400);
      return (await repository.update(actorScope(actor), id, parsed))
        ? { ok: true as const, data: { id, status: "draft" as const } }
        : fail("ASSESSMENT_UPDATE_REJECTED", "仅评定人可修订草稿或已退回评定", 409);
    },
    async submit(actor: SessionView, id: string) {
      if (!canAssess(actor)) return fail("FORBIDDEN", "无权提交技能评定", 403);
      const status = await repository.submit(actorScope(actor), id);
      return status
        ? { ok: true as const, data: { id, status } }
        : fail("ASSESSMENT_SUBMIT_REJECTED", "仅评定人可提交完整的草稿或已退回评定", 409);
    },
    async managerConfirm(actor: SessionView, id: string) {
      if (actor.role !== "department_manager" || !actor.departmentId)
        return fail("FORBIDDEN", "仅员工所属部门主管可以确认评定", 403);
      const visible = (await repository.list(actorScope(actor))).find((item) => item.id === id);
      if (visible?.assessorEmployeeId === actor.employeeId)
        return fail("SELF_REVIEW_FORBIDDEN", "评定人不能确认本人录入的评定", 403);
      return (await repository.managerConfirm(actorScope(actor), id, now()))
        ? { ok: true as const, data: { id, status: "pending_hr" as const } }
        : fail("ASSESSMENT_CONFIRM_REJECTED", "评定不存在、超出部门范围或状态不允许", 409);
    },
    async returnAssessment(actor: SessionView, id: string, reason: string) {
      if (!canAssess(actor)) return fail("FORBIDDEN", "无权退回技能评定", 403);
      if (!reason.trim() || reason.trim().length > 500)
        return fail("RETURN_REASON_REQUIRED", "退回原因必填且不得超过 500 字", 400);
      return (await repository.returnAssessment(actorScope(actor), id, reason.trim()))
        ? { ok: true as const, data: { id, status: "returned" as const } }
        : fail("ASSESSMENT_RETURN_REJECTED", "评定不存在、超出范围或状态不允许", 409);
    },
    async archive(actor: SessionView, id: string) {
      if (actor.role !== "hr_admin") return fail("FORBIDDEN", "仅 HR 可以归档技能评定", 403);
      return (await repository.archive(actorScope(actor), id, now()))
        ? { ok: true as const, data: { id, status: "archived" as const } }
        : fail(
            "ASSESSMENT_ARCHIVE_REJECTED",
            "评定需要至少一名独立复核人，且必须处于待 HR 归档状态",
            409,
          );
    },
    async voidAssessment(actor: SessionView, id: string, reason: string) {
      if (actor.role !== "hr_admin") return fail("FORBIDDEN", "仅 HR 可以作废归档评定", 403);
      if (!reason.trim() || reason.trim().length > 500)
        return fail("VOID_REASON_REQUIRED", "作废原因必填且不得超过 500 字", 400);
      return (await repository.voidAssessment(actorScope(actor), id, reason.trim(), now()))
        ? { ok: true as const, data: { id, status: "voided" as const } }
        : fail("ASSESSMENT_VOID_REJECTED", "仅已归档评定可以作废", 409);
    },
    async evidenceContent(actor: SessionView, id: string) {
      if (!canRead(actor)) return fail("FORBIDDEN", "无权查看评定证据", 403);
      const evidence = await repository.evidence(actorScope(actor), id);
      if (!evidence) return fail("EVIDENCE_NOT_FOUND", "评定证据不存在或超出权限范围", 404);
      try {
        const bytes = await storage.get(evidence.storageKey);
        if (checksum(bytes) !== evidence.checksum)
          return fail("CHECKSUM_MISMATCH", "评定证据校验失败，请联系管理员", 500);
        return {
          ok: true as const,
          data: {
            bytes,
            filename: evidence.originalFilename,
            mimeType: evidence.mimeType,
          },
        };
      } catch {
        return fail("EVIDENCE_READ_FAILED", "评定证据读取失败", 500);
      }
    },
  };
};

export type AssessmentService = ReturnType<typeof createAssessmentService>;
