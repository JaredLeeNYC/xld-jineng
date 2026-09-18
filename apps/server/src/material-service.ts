import type { MaterialRepository } from "@jineng/skill-matrix-db";
import {
  allowedMaterialMimeTypes,
  maximumMaterialBytes,
  trainingTypes,
  type TrainingType,
} from "@jineng/skill-matrix-shared";
import { createHash } from "node:crypto";
import type { SessionView } from "./auth-contract";
import type { MaterialStorage } from "./material-storage";

const fail = (code: string, message: string, status: 400 | 403 | 404 | 409 | 500) => ({
  ok: false as const,
  error: { code, message, status },
});
const hrOnly = (actor: SessionView) =>
  actor.role === "hr_admin" || actor.role === "department_manager"
    ? undefined
    : fail("FORBIDDEN", "仅 HR 或部门主管可维护培训资料", 403);
const readers = ["employee", "department_manager", "hr_admin", "executive_viewer"];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const validText = (value: string, maximum: number) =>
  value.trim().length > 0 && value.trim().length <= maximum;
const safeFilename = (value: string) =>
  value.length <= 255 &&
  !value.includes("..") &&
  !value.includes("\\") &&
  !value.includes("/") &&
  !value.includes(String.fromCharCode(0));

const hasExpectedSignature = (mimeType: string, bytes: Uint8Array) => {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (mimeType === "application/pdf") return starts(0x25, 0x50, 0x44, 0x46);
  if (mimeType === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
  if (mimeType === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mimeType === "image/webp")
    return starts(0x52, 0x49, 0x46, 0x46) && bytes.slice(8, 12).toString() === "87,69,66,80";
  if (mimeType.includes("openxmlformats")) return starts(0x50, 0x4b);
  if (mimeType === "application/msword" || mimeType === "application/vnd.ms-powerpoint")
    return starts(0xd0, 0xcf, 0x11, 0xe0);
  if (mimeType === "video/mp4")
    return bytes.length >= 12 && bytes.slice(4, 8).toString() === "102,116,121,112";
  if (mimeType === "video/webm") return starts(0x1a, 0x45, 0xdf, 0xa3);
  return false;
};

export const createMaterialService = (dependencies: {
  repository: MaterialRepository;
  storage: MaterialStorage;
  idSource: () => string;
  storageWarning?: (error: unknown) => void;
}) => {
  const { repository, storage, idSource, storageWarning = console.error } = dependencies;
  const canMaintain = async (actor: SessionView, id: string) => {
    const denied = hrOnly(actor);
    if (denied) return denied;
    const material = await repository.get(id);
    if (!material || material.archivedAt)
      return fail("MATERIAL_NOT_FOUND", "资料不存在或已移除", 404);
    if (actor.role !== "hr_admin" && material.createdByAccountId !== actor.accountId)
      return fail("FORBIDDEN", "仅可维护本人创建的培训资料", 403);
    return undefined;
  };
  return {
    async list(actor: SessionView, input: { includeInactive?: boolean; query?: string } = {}) {
      if (!readers.includes(actor.role)) return fail("FORBIDDEN", "无权查看培训资料", 403);
      const materials = await repository.list({
        ...((actor.role === "hr_admin" || actor.role === "department_manager") &&
        input.includeInactive
          ? { includeInactive: true }
          : {}),
        ...(input.query?.trim() ? { query: input.query.trim() } : {}),
        role: actor.role as "employee" | "department_manager" | "hr_admin" | "executive_viewer",
        employeeId: actor.employeeId,
        accountId: actor.accountId,
        factoryRead: "factoryRead" in actor && actor.factoryRead === true,
        ...(actor.departmentId ? { departmentId: actor.departmentId } : {}),
      });
      const publicMaterials = materials.map(
        ({
          storageKey: _storageKey,
          createdByAccountId,
          archivedAt: _archivedAt,
          ...material
        }) => ({
          ...material,
          canManage:
            actor.role === "hr_admin" ||
            (actor.role === "department_manager" && createdByAccountId === actor.accountId),
        }),
      );
      return {
        ok: true as const,
        data:
          actor.role === "hr_admin"
            ? publicMaterials
            : publicMaterials.map(({ externalUrl: _externalUrl, ...material }) => material),
      };
    },
    async createLink(
      actor: SessionView,
      input: {
        title: string;
        category: string;
        trainingType?: TrainingType;
        trainingName?: string;
        description?: string;
        externalUrl: string;
        skillIds: string[];
      },
    ) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      let url: URL;
      try {
        url = new URL(input.externalUrl);
      } catch {
        return fail("INVALID_URL", "请输入有效的网页或视频链接", 400);
      }
      if (!["https:", "http:"].includes(url.protocol))
        return fail("INVALID_URL", "链接仅支持 HTTP 或 HTTPS", 400);
      if (
        !validText(input.title, 150) ||
        !validText(input.category, 80) ||
        (input.trainingType !== undefined && !trainingTypes.includes(input.trainingType)) ||
        (input.trainingName?.length ?? 0) > 150 ||
        !Array.isArray(input.skillIds)
      )
        return fail("INVALID_MATERIAL", "请填写资料标题和有效的培训类型，培训名称不超过150字", 400);
      const id = idSource();
      const created = await repository.create({
        id,
        title: input.title.trim(),
        category: input.category.trim(),
        ...(input.trainingType ? { trainingType: input.trainingType } : {}),
        ...(input.trainingName?.trim() ? { trainingName: input.trainingName.trim() } : {}),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        kind: "link",
        externalUrl: url.toString(),
        skillIds: [...new Set(input.skillIds)],
        actorAccountId: actor.accountId,
      });
      return created
        ? { ok: true as const, data: { id } }
        : fail("INVALID_SKILLS", "关联技能不存在或已停用", 409);
    },
    async upload(
      actor: SessionView,
      input: {
        title: string;
        category: string;
        trainingType?: TrainingType;
        trainingName?: string;
        description?: string;
        skillIds: string[];
        filename: string;
        mimeType: string;
        bytes: Uint8Array;
      },
    ) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      if (
        !validText(input.title, 150) ||
        !validText(input.category, 80) ||
        (input.trainingType !== undefined && !trainingTypes.includes(input.trainingType)) ||
        (input.trainingName?.length ?? 0) > 150 ||
        !Array.isArray(input.skillIds)
      )
        return fail("INVALID_MATERIAL", "请填写资料标题和有效的培训类型，培训名称不超过150字", 400);
      if (!safeFilename(input.filename)) return fail("UNSAFE_FILENAME", "文件名不安全", 400);
      if (
        !allowedMaterialMimeTypes.includes(
          input.mimeType as (typeof allowedMaterialMimeTypes)[number],
        )
      )
        return fail(
          "UNSUPPORTED_FILE_TYPE",
          "仅支持 PDF、Word、PPT、常用图片、MP4 和 WebM 视频",
          400,
        );
      if (input.bytes.byteLength === 0 || input.bytes.byteLength > maximumMaterialBytes)
        return fail("INVALID_FILE_SIZE", "文件不能为空且不得超过 25MB", 400);
      if (!hasExpectedSignature(input.mimeType, input.bytes))
        return fail("FILE_SIGNATURE_MISMATCH", "文件内容与声明类型不一致", 400);
      const id = idSource();
      const storageKey = idSource();
      let writeLocked = false;
      try {
        await storage.beginWrite(storageKey);
        writeLocked = true;
        await storage.put(storageKey, input.bytes);
        const created = await repository.create({
          id,
          title: input.title.trim(),
          category: input.category.trim(),
          ...(input.trainingType ? { trainingType: input.trainingType } : {}),
          ...(input.trainingName?.trim() ? { trainingName: input.trainingName.trim() } : {}),
          ...(input.description?.trim() ? { description: input.description.trim() } : {}),
          kind: "file",
          storageKey,
          originalFilename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.bytes.byteLength,
          checksum: sha256(input.bytes),
          skillIds: [...new Set(input.skillIds)],
          actorAccountId: actor.accountId,
        });
        if (!created) {
          await storage.delete(storageKey);
          return fail("INVALID_SKILLS", "关联技能不存在或已停用", 409);
        }
        return { ok: true as const, data: { id } };
      } catch {
        try {
          await storage.delete(storageKey);
        } catch {
          /* cleanup job reconciles orphaned keys */
        }
        return fail("MATERIAL_STORAGE_FAILED", "资料保存失败，请稍后重试", 500);
      } finally {
        if (writeLocked) {
          try {
            await storage.endWrite(storageKey);
          } catch (error) {
            storageWarning(error);
          }
        }
      }
    },
    async update(
      actor: SessionView,
      id: string,
      input: {
        title: string;
        category: string;
        trainingType?: TrainingType;
        trainingName?: string;
        description?: string;
        skillIds: string[];
      },
    ) {
      const denied = await canMaintain(actor, id);
      if (denied) return denied;
      if (
        !validText(input.title, 150) ||
        !validText(input.category, 80) ||
        (input.trainingType !== undefined && !trainingTypes.includes(input.trainingType)) ||
        (input.trainingName?.length ?? 0) > 150 ||
        !Array.isArray(input.skillIds)
      )
        return fail("INVALID_MATERIAL", "请填写资料标题和有效的培训类型，培训名称不超过150字", 400);
      return (await repository.update({
        ...input,
        id,
        skillIds: [...new Set(input.skillIds)],
        actorAccountId: actor.accountId,
      }))
        ? { ok: true as const, data: { id } }
        : fail("MATERIAL_NOT_FOUND", "资料不存在或关联技能无效", 404);
    },
    async deactivate(actor: SessionView, id: string) {
      const denied = await canMaintain(actor, id);
      if (denied) return denied;
      return (await repository.deactivate(id, actor.accountId))
        ? { ok: true as const, data: { id, active: false as const } }
        : fail("MATERIAL_NOT_FOUND", "资料不存在或已停用", 404);
    },
    async archive(actor: SessionView, id: string) {
      const denied = await canMaintain(actor, id);
      if (denied) return denied;
      return (await repository.archive(id, actor.accountId))
        ? { ok: true as const, data: { id, active: false as const } }
        : fail("MATERIAL_NOT_FOUND", "资料不存在或已移除", 404);
    },
    async content(actor: SessionView, id: string) {
      if (!readers.includes(actor.role)) return fail("FORBIDDEN", "无权访问培训资料", 403);
      const material = await repository.get(id);
      if (!material) return fail("MATERIAL_NOT_FOUND", "资料不存在或已停用", 404);
      const businessAuthorized = await repository.canRead({
        materialId: id,
        role: actor.role as "employee" | "department_manager" | "hr_admin" | "executive_viewer",
        employeeId: actor.employeeId,
        accountId: actor.accountId,
        factoryRead: "factoryRead" in actor && actor.factoryRead === true,
        ...(actor.departmentId ? { departmentId: actor.departmentId } : {}),
      });
      const historicalAuthorized =
        (actor.role === "employee" || actor.role === "department_manager") &&
        (await repository.hasHistoricalAccess(material.id, actor.employeeId));
      if (
        actor.role !== "hr_admin" &&
        !historicalAuthorized &&
        (!material.active || !businessAuthorized)
      )
        return fail("MATERIAL_NOT_FOUND", "资料不存在或无访问权限", 404);
      if (material.kind === "link")
        return { ok: true as const, data: { kind: "link" as const, url: material.externalUrl! } };
      try {
        const bytes = await storage.get(material.storageKey!);
        if (sha256(bytes) !== material.checksum)
          return fail("CHECKSUM_MISMATCH", "资料校验失败，请联系管理员", 500);
        return {
          ok: true as const,
          data: {
            kind: "file" as const,
            bytes,
            filename: material.originalFilename!,
            mimeType: material.mimeType!,
          },
        };
      } catch {
        return fail("MATERIAL_READ_FAILED", "资料读取失败，请稍后重试", 500);
      }
    },
    async cleanupOrphans() {
      await storage.cleanupTemporary(new Date(Date.now() - 24 * 60 * 60 * 1_000));
      const referenced = new Set(await repository.storageKeys());
      const orphaned = (await storage.listKeys(new Date(Date.now() - 24 * 60 * 60 * 1_000))).filter(
        (key) => !referenced.has(key),
      );
      for (const key of orphaned) await storage.delete(key);
      return orphaned;
    },
  };
};

export type MaterialService = ReturnType<typeof createMaterialService>;
