import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export type MaterialStorage = {
  beginWrite(key: string): Promise<void>;
  endWrite(key: string): Promise<void>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  listKeys(olderThan?: Date): Promise<string[]>;
  cleanupTemporary(olderThan: Date): Promise<string[]>;
};

const assertStorageKey = (key: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(key)) throw new Error("INVALID_STORAGE_KEY");
};

export const createMemoryMaterialStorage = (
  now: () => Date = () => new Date(),
): MaterialStorage => {
  const objects = new Map<string, { bytes: Uint8Array; createdAt: Date }>();
  return {
    async beginWrite(key) {
      assertStorageKey(key);
    },
    async endWrite(key) {
      assertStorageKey(key);
    },
    async put(key, bytes) {
      assertStorageKey(key);
      objects.set(key, { bytes: bytes.slice(), createdAt: now() });
    },
    async get(key) {
      assertStorageKey(key);
      const value = objects.get(key);
      if (!value) throw new Error("STORAGE_OBJECT_NOT_FOUND");
      return value.bytes.slice();
    },
    async delete(key) {
      assertStorageKey(key);
      objects.delete(key);
    },
    async listKeys(olderThan) {
      return [...objects.entries()]
        .filter(([, value]) => !olderThan || value.createdAt < olderThan)
        .map(([key]) => key);
    },
    async cleanupTemporary() {
      return [];
    },
  };
};

export const createFilesystemMaterialStorage = (rootDirectory: string): MaterialStorage => {
  const root = resolve(rootDirectory);
  const maintenanceLock = `${root}.maintenance.lock`;
  const uploadLocks = `${root}.upload-locks`;
  const pathExists = async (path: string) => {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "ENOENT")
        return false;
      throw error;
    }
  };
  const target = (key: string) => {
    assertStorageKey(key);
    const path = resolve(root, key);
    if (!path.startsWith(`${root}${sep}`)) throw new Error("INVALID_STORAGE_KEY");
    return path;
  };
  return {
    async beginWrite(key) {
      target(key);
      if (await pathExists(maintenanceLock)) throw new Error("STORAGE_MAINTENANCE_IN_PROGRESS");
      await mkdir(uploadLocks, { recursive: true });
      const uploadLock = resolve(uploadLocks, key);
      await Bun.write(uploadLock, "uploading");
      if (await pathExists(maintenanceLock)) {
        await rm(uploadLock, { force: true });
        throw new Error("STORAGE_MAINTENANCE_IN_PROGRESS");
      }
    },
    async endWrite(key) {
      assertStorageKey(key);
      await rm(resolve(uploadLocks, key), { force: true });
    },
    async put(key, bytes) {
      const path = target(key);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.uploading`;
      try {
        await Bun.write(temporary, bytes);
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
    async get(key) {
      const file = Bun.file(target(key));
      if (!(await file.exists())) throw new Error("STORAGE_OBJECT_NOT_FOUND");
      return new Uint8Array(await file.arrayBuffer());
    },
    async delete(key) {
      await rm(target(key), { force: true });
    },
    async listKeys(olderThan) {
      try {
        const keys = (await readdir(root)).filter((key) => /^[0-9a-f-]{36}$/i.test(key));
        if (!olderThan) return keys;
        const eligible: string[] = [];
        for (const key of keys) {
          if ((await stat(target(key))).mtime < olderThan) eligible.push(key);
        }
        return eligible;
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "ENOENT")
          return [];
        throw error;
      }
    },
    async cleanupTemporary(olderThan) {
      try {
        const names = await readdir(root);
        const removed: string[] = [];
        for (const name of names.filter((item) => /^[0-9a-f-]{36}\.uploading$/i.test(item))) {
          const path = resolve(root, name);
          if ((await stat(path)).mtime < olderThan) {
            await rm(path, { force: true });
            removed.push(name);
          }
        }
        if (await pathExists(uploadLocks)) {
          for (const name of (await readdir(uploadLocks)).filter((item) =>
            /^[0-9a-f-]{36}$/i.test(item),
          )) {
            const path = resolve(uploadLocks, name);
            if ((await stat(path)).mtime < olderThan) {
              await rm(path, { force: true });
              removed.push(`.upload-locks/${name}`);
            }
          }
        }
        return removed;
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "ENOENT")
          return [];
        throw error;
      }
    },
  };
};
