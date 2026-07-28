import type { MaterialRepository } from "@jineng/skill-matrix-db";
import { allowedMaterialMimeTypes, maximumMaterialBytes } from "@jineng/skill-matrix-shared";
import { createHash } from "node:crypto";
import type { SessionView } from "./auth-contract";
import type { MaterialStorage } from "./material-storage";

const fail = (code: string, message: string, status: 400 | 403 | 404 | 409 | 500) => ({
  ok: false as const,
  error: { code, message, status },
});
const hrOnly = (actor: SessionView) =>
  actor.role === "hr_admin" ? undefined : fail("FORBIDDEN", "仅 HR/培训管理员可维护培训资料", 403);
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
  return false;
};

export const createMaterialService = (dependencies: {
  repository: MaterialRepository;
  storage: MaterialStorage;
  idSource: () => string;
}) => {
  const { repository, storage, idSource } = dependencies;
  return {
    async list(actor: SessionView, input: { includeInactive?: boolean; query?: string } = {}) {
      if (!readers.includes(actor.role)) return fail("FORBIDDEN", "无权查看培训资料", 403);
      return {
        ok: true as const,
        data: await repository.list({
          ...(actor.role === "hr_admin" && input.includeInactive ? { includeInactive: true } : {}),
          ...(input.query?.trim() ? { query: input.query.trim() } : {}),
        }),
      };
    },
    async createLink(
      actor: SessionView,
      input: {
        title: string;
        category: string;
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
        input.skillIds.length === 0
      )
        return fail("INVALID_MATERIAL", "标题、分类和至少一个关联技能必填", 400);
      const id = idSource();
      const created = await repository.create({
        id,
        title: input.title.trim(),
        category: input.category.trim(),
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
        input.skillIds.length === 0
      )
        return fail("INVALID_MATERIAL", "标题、分类和至少一个关联技能必填", 400);
      if (!safeFilename(input.filename)) return fail("UNSAFE_FILENAME", "文件名不安全", 400);
      if (
        !allowedMaterialMimeTypes.includes(
          input.mimeType as (typeof allowedMaterialMimeTypes)[number],
        )
      )
        return fail("UNSUPPORTED_FILE_TYPE", "仅支持 PDF、Word、PPT 和常用图片", 400);
      if (input.bytes.byteLength === 0 || input.bytes.byteLength > maximumMaterialBytes)
        return fail("INVALID_FILE_SIZE", "文件不能为空且不得超过 25MB", 400);
      if (!hasExpectedSignature(input.mimeType, input.bytes))
        return fail("FILE_SIGNATURE_MISMATCH", "文件内容与声明类型不一致", 400);
      const id = idSource();
      const storageKey = idSource();
      try {
        await storage.put(storageKey, input.bytes);
        const created = await repository.create({
          id,
          title: input.title.trim(),
          category: input.category.trim(),
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
      }
    },
    async update(
      actor: SessionView,
      id: string,
      input: { title: string; category: string; description?: string; skillIds: string[] },
    ) {
      const denied = hrOnly(actor);
      if (denied) return denied;
      if (
        !validText(input.title, 150) ||
        !validText(input.category, 80) ||
        input.skillIds.length === 0
      )
        return fail("INVALID_MATERIAL", "标题、分类和至少一个关联技能必填", 400);
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
      const denied = hrOnly(actor);
      if (denied) return denied;
      return (await repository.deactivate(id, actor.accountId))
        ? { ok: true as const, data: { id, active: false as const } }
        : fail("MATERIAL_NOT_FOUND", "资料不存在或已停用", 404);
    },
    async content(actor: SessionView, id: string, allowHistorical = false) {
      if (!readers.includes(actor.role)) return fail("FORBIDDEN", "无权访问培训资料", 403);
      const material = await repository.get(id);
      if (!material || (!material.active && actor.role !== "hr_admin" && !allowHistorical))
        return fail("MATERIAL_NOT_FOUND", "资料不存在或已停用", 404);
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
      const referenced = new Set(await repository.storageKeys());
      const orphaned = (await storage.listKeys()).filter((key) => !referenced.has(key));
      for (const key of orphaned) await storage.delete(key);
      return orphaned;
    },
  };
};

export type MaterialService = ReturnType<typeof createMaterialService>;
