import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFilesystemMaterialStorage, createMemoryMaterialStorage } from "./material-storage";

const key = "11111111-1111-4111-8111-111111111111";

describe("material storage", () => {
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
  });

  test("memory adapter isolates bytes and rejects path traversal", async () => {
    const storage = createMemoryMaterialStorage();
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.put(key, bytes);
    bytes[0] = 9;
    expect(await storage.get(key)).toEqual(new Uint8Array([1, 2, 3]));
    expect(storage.put("../escape", bytes)).rejects.toThrow("INVALID_STORAGE_KEY");
  });

  test("filesystem adapter survives a fresh adapter instance for restore validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-materials-"));
    directories.push(directory);
    await createFilesystemMaterialStorage(directory).put(key, new Uint8Array([4, 5, 6]));
    expect(await createFilesystemMaterialStorage(directory).get(key)).toEqual(
      new Uint8Array([4, 5, 6]),
    );
  });
});
