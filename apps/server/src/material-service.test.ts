import { describe, expect, test } from "bun:test";
import type { MaterialRepository } from "@jineng/skill-matrix-db";
import type { SessionView } from "./auth-contract";
import { createMaterialService } from "./material-service";
import { createMemoryMaterialStorage, type MaterialStorage } from "./material-storage";

const actor = (role: SessionView["role"]): SessionView => ({
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  employeeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  employeeNumber: "E001",
  displayName: "测试用户",
  role,
  mustChangePassword: false,
});
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]);

const setup = (storage: MaterialStorage = createMemoryMaterialStorage()) => {
  let record: any;
  const repository = {
    list: async () => (record ? [record] : []),
    get: async () => record,
    create: async (input: any) => {
      record = { ...input, active: true, skills: [], createdAt: new Date().toISOString() };
      return input.id;
    },
    update: async () => true,
    deactivate: async () => {
      if (!record) return false;
      record.active = false;
      return true;
    },
    storageKeys: async () => (record?.storageKey ? [record.storageKey] : []),
  } as unknown as MaterialRepository;
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  return {
    service: createMaterialService({ repository, storage, idSource: () => ids.shift()! }),
    getRecord: () => record,
  };
};

describe("training material service", () => {
  test("uploads with checksum and storage key unrelated to filename", async () => {
    const { service, getRecord } = setup();
    const result = await service.upload(actor("hr_admin"), {
      title: "安全培训",
      category: "安全",
      skillIds: ["skill"],
      filename: "培训.pdf",
      mimeType: "application/pdf",
      bytes: pdf,
    });
    expect(result.ok).toBe(true);
    expect(getRecord()).toMatchObject({
      storageKey: "22222222-2222-4222-8222-222222222222",
      originalFilename: "培训.pdf",
      checksum: expect.any(String),
    });
    expect(getRecord().storageKey).not.toContain("培训");
  });

  test("rejects unsafe names, dangerous types and mismatched signatures", async () => {
    const { service } = setup();
    const base = { title: "资料", category: "安全", skillIds: ["skill"], bytes: pdf };
    expect(
      await service.upload(actor("hr_admin"), {
        ...base,
        filename: "../a.pdf",
        mimeType: "application/pdf",
      }),
    ).toMatchObject({ error: { code: "UNSAFE_FILENAME" } });
    expect(
      await service.upload(actor("hr_admin"), {
        ...base,
        filename: "a.exe",
        mimeType: "application/x-msdownload",
      }),
    ).toMatchObject({ error: { code: "UNSUPPORTED_FILE_TYPE" } });
    expect(
      await service.upload(actor("hr_admin"), {
        ...base,
        filename: "a.png",
        mimeType: "image/png",
      }),
    ).toMatchObject({ error: { code: "FILE_SIGNATURE_MISMATCH" } });
  });

  test("denies employee maintenance and hides deactivated content", async () => {
    const { service } = setup();
    expect(
      await service.createLink(actor("employee"), {
        title: "资料",
        category: "安全",
        externalUrl: "https://example.com",
        skillIds: ["skill"],
      }),
    ).toMatchObject({ error: { code: "FORBIDDEN" } });
    await service.createLink(actor("hr_admin"), {
      title: "资料",
      category: "安全",
      externalUrl: "https://example.com",
      skillIds: ["skill"],
    });
    await service.deactivate(actor("hr_admin"), "11111111-1111-4111-8111-111111111111");
    expect(
      await service.content(actor("employee"), "11111111-1111-4111-8111-111111111111"),
    ).toMatchObject({ error: { code: "MATERIAL_NOT_FOUND" } });
  });

  test("returns a controlled error and removes object when metadata save fails", async () => {
    let deleted = false;
    const storage: MaterialStorage = {
      put: async () => {},
      get: async () => pdf,
      delete: async () => {
        deleted = true;
      },
      listKeys: async () => [],
    };
    const repository = {
      create: async () => {
        throw new Error("db down");
      },
    } as unknown as MaterialRepository;
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const service = createMaterialService({ repository, storage, idSource: () => ids.shift()! });
    expect(
      await service.upload(actor("hr_admin"), {
        title: "资料",
        category: "安全",
        skillIds: ["skill"],
        filename: "a.pdf",
        mimeType: "application/pdf",
        bytes: pdf,
      }),
    ).toMatchObject({ error: { code: "MATERIAL_STORAGE_FAILED" } });
    expect(deleted).toBe(true);
  });
});
