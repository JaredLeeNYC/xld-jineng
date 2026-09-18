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
  let historical = false;
  const repository = {
    list: async () => (record ? [record] : []),
    get: async () => record,
    create: async (input: any) => {
      record = {
        ...input,
        createdByAccountId: input.actorAccountId,
        active: true,
        skills: [],
        createdAt: new Date().toISOString(),
      };
      return input.id;
    },
    update: async (input: any) => {
      record = { ...record, ...input };
      return true;
    },
    archive: async () => {
      record.active = false;
      record.archivedAt = new Date().toISOString();
      return true;
    },
    deactivate: async () => {
      if (!record) return false;
      record.active = false;
      return true;
    },
    storageKeys: async () => (record?.storageKey ? [record.storageKey] : []),
    canRead: async () => true,
    hasHistoricalAccess: async () => historical,
    grantHistoricalAccess: async () => {
      historical = true;
    },
  } as unknown as MaterialRepository;
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  return {
    service: createMaterialService({ repository, storage, idSource: () => ids.shift()! }),
    getRecord: () => record,
    grantHistoricalAccess: () => {
      historical = true;
    },
  };
};

describe("training material service", () => {
  test("manager creates optional-skill material and edits all business metadata", async () => {
    const { service, getRecord } = setup();
    const result = await service.upload(actor("department_manager"), {
      title: "内部说明",
      category: "内部培训",
      trainingType: "general",
      trainingName: "入职培训",
      skillIds: [],
      filename: "说明.pdf",
      mimeType: "application/pdf",
      bytes: pdf,
    });
    expect(result.ok).toBe(true);
    expect(getRecord()).toMatchObject({
      skillIds: [],
      trainingType: "general",
      trainingName: "入职培训",
    });
    expect(
      await service.update(actor("department_manager"), getRecord().id, {
        title: "安全说明",
        category: "安全培训",
        trainingType: "safety",
        trainingName: "",
        skillIds: [],
      }),
    ).toMatchObject({ ok: true });
    expect(getRecord()).toMatchObject({
      title: "安全说明",
      trainingType: "safety",
      trainingName: "",
      skillIds: [],
    });
    const list = await service.list(actor("department_manager"));
    expect(list).toMatchObject({ ok: true, data: [{ canManage: true }] });
    if (list.ok) {
      expect(list.data[0]).not.toHaveProperty("createdByAccountId");
      expect(list.data[0]).not.toHaveProperty("storageKey");
    }
  });

  test("factory-wide read never permits another manager's material maintenance", async () => {
    const { service, getRecord } = setup();
    await service.createLink(actor("hr_admin"), {
      title: "资料",
      category: "安全",
      externalUrl: "https://example.com",
      skillIds: [],
    });
    const other = {
      ...actor("department_manager"),
      accountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      factoryRead: true,
    };
    expect(
      await service.update(other, getRecord().id, {
        title: "越权",
        category: "安全",
        skillIds: [],
      }),
    ).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(await service.deactivate(other, getRecord().id)).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    expect(await service.archive(other, getRecord().id)).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  test("logical removal preserves file and historical access", async () => {
    const { service, getRecord, grantHistoricalAccess } = setup();
    await service.upload(actor("hr_admin"), {
      title: "资料",
      category: "安全",
      skillIds: [],
      filename: "a.pdf",
      mimeType: "application/pdf",
      bytes: pdf,
    });
    const id = getRecord().id;
    expect(await service.archive(actor("hr_admin"), id)).toMatchObject({ ok: true });
    expect(getRecord().archivedAt).toBeDefined();
    expect(await service.content(actor("employee"), id)).toMatchObject({
      error: { code: "MATERIAL_NOT_FOUND" },
    });
    grantHistoricalAccess();
    expect(await service.content(actor("employee"), id)).toMatchObject({
      ok: true,
      data: { kind: "file", bytes: pdf },
    });
    expect(
      await service.update(actor("hr_admin"), id, {
        title: "改归档",
        category: "安全",
        skillIds: [],
      }),
    ).toMatchObject({ error: { code: "MATERIAL_NOT_FOUND" } });
  });

  test("supports MP4 and WebM signatures and rejects disguised video", async () => {
    for (const [mimeType, bytes] of [
      ["video/mp4", new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109])],
      ["video/webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])],
    ] as const) {
      const { service } = setup();
      expect(
        await service.upload(actor("hr_admin"), {
          title: "操作视频",
          category: "技能培训",
          trainingType: "professional",
          skillIds: [],
          filename: "操作视频",
          mimeType,
          bytes,
        }),
      ).toMatchObject({ ok: true });
      expect(
        await service.upload(actor("hr_admin"), {
          title: "伪装视频",
          category: "技能培训",
          skillIds: [],
          filename: "伪装.mp4",
          mimeType,
          bytes: pdf,
        }),
      ).toMatchObject({ error: { code: "FILE_SIGNATURE_MISMATCH" } });
    }
  });

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

  test("keeps a deactivated material readable only through a recorded historical grant", async () => {
    const { service, grantHistoricalAccess } = setup();
    await service.createLink(actor("hr_admin"), {
      title: "资料",
      category: "安全",
      externalUrl: "https://example.com",
      skillIds: ["skill"],
    });
    await service.deactivate(actor("hr_admin"), "11111111-1111-4111-8111-111111111111");
    grantHistoricalAccess();
    expect(
      await service.content(actor("employee"), "11111111-1111-4111-8111-111111111111"),
    ).toMatchObject({ ok: true, data: { kind: "link" } });
  });

  test("returns a controlled error and removes object when metadata save fails", async () => {
    let deleted = false;
    const storage: MaterialStorage = {
      beginWrite: async () => {},
      endWrite: async () => {},
      put: async () => {},
      get: async () => pdf,
      delete: async () => {
        deleted = true;
      },
      listKeys: async () => [],
      cleanupTemporary: async () => [],
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

  test("rejects checksum changes and reconciles orphaned objects", async () => {
    const storage = createMemoryMaterialStorage(() => new Date("2026-01-01T00:00:00.000Z"));
    const { service, getRecord } = setup(storage);
    await service.upload(actor("hr_admin"), {
      title: "资料",
      category: "安全",
      skillIds: ["skill"],
      filename: "a.pdf",
      mimeType: "application/pdf",
      bytes: pdf,
    });
    await storage.put(getRecord().storageKey, new Uint8Array([0x25, 0x50, 0x44, 0x46, 9]));
    expect(await service.content(actor("employee"), getRecord().id)).toMatchObject({
      error: { code: "CHECKSUM_MISMATCH" },
    });
    const orphan = "33333333-3333-4333-8333-333333333333";
    await storage.put(orphan, pdf);
    expect(await service.cleanupOrphans()).toEqual([orphan]);
    expect(await storage.listKeys()).not.toContain(orphan);
  });

  test("does not delete a fresh unreferenced object during an in-flight upload", async () => {
    const storage = createMemoryMaterialStorage();
    const repository = { storageKeys: async () => [] } as unknown as MaterialRepository;
    const service = createMaterialService({
      repository,
      storage,
      idSource: () => "unused",
    });
    const inFlight = "44444444-4444-4444-8444-444444444444";
    await storage.put(inFlight, pdf);
    expect(await service.cleanupOrphans()).toEqual([]);
    expect(await storage.listKeys()).toContain(inFlight);
  });

  test("holds the writer lock through the metadata transaction", async () => {
    const events: string[] = [];
    const storage: MaterialStorage = {
      beginWrite: async () => {
        events.push("lock");
      },
      endWrite: async () => {
        events.push("unlock");
      },
      put: async () => {
        events.push("object");
      },
      get: async () => pdf,
      delete: async () => {},
      listKeys: async () => [],
      cleanupTemporary: async () => [],
    };
    const repository = {
      create: async (input: { id: string }) => {
        events.push("metadata");
        return input.id;
      },
    } as unknown as MaterialRepository;
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const service = createMaterialService({ repository, storage, idSource: () => ids.shift()! });
    await service.upload(actor("hr_admin"), {
      title: "资料",
      category: "安全",
      skillIds: ["skill"],
      filename: "a.pdf",
      mimeType: "application/pdf",
      bytes: pdf,
    });
    expect(events).toEqual(["lock", "object", "metadata", "unlock"]);
  });

  test("does not report a committed upload as failed when lock release needs cleanup", async () => {
    const warnings: unknown[] = [];
    const storage: MaterialStorage = {
      beginWrite: async () => {},
      endWrite: async () => {
        throw new Error("lock release failed");
      },
      put: async () => {},
      get: async () => pdf,
      delete: async () => {},
      listKeys: async () => [],
      cleanupTemporary: async () => [],
    };
    const repository = {
      create: async (input: { id: string }) => input.id,
    } as unknown as MaterialRepository;
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const service = createMaterialService({
      repository,
      storage,
      idSource: () => ids.shift()!,
      storageWarning: (error) => warnings.push(error),
    });
    expect(
      await service.upload(actor("hr_admin"), {
        title: "资料",
        category: "安全",
        skillIds: ["skill"],
        filename: "a.pdf",
        mimeType: "application/pdf",
        bytes: pdf,
      }),
    ).toMatchObject({ ok: true });
    expect(warnings).toHaveLength(1);
  });
});
