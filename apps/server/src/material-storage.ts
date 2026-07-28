import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export type MaterialStorage = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
};

const assertStorageKey = (key: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(key)) throw new Error("INVALID_STORAGE_KEY");
};

export const createMemoryMaterialStorage = (): MaterialStorage => {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      assertStorageKey(key);
      objects.set(key, bytes.slice());
    },
    async get(key) {
      assertStorageKey(key);
      const value = objects.get(key);
      if (!value) throw new Error("STORAGE_OBJECT_NOT_FOUND");
      return value.slice();
    },
    async delete(key) {
      assertStorageKey(key);
      objects.delete(key);
    },
    async listKeys() {
      return [...objects.keys()];
    },
  };
};

export const createFilesystemMaterialStorage = (rootDirectory: string): MaterialStorage => {
  const root = resolve(rootDirectory);
  const target = (key: string) => {
    assertStorageKey(key);
    const path = resolve(root, key);
    if (!path.startsWith(`${root}${sep}`)) throw new Error("INVALID_STORAGE_KEY");
    return path;
  };
  return {
    async put(key, bytes) {
      const path = target(key);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.uploading`;
      await Bun.write(temporary, bytes);
      await rename(temporary, path);
    },
    async get(key) {
      const file = Bun.file(target(key));
      if (!(await file.exists())) throw new Error("STORAGE_OBJECT_NOT_FOUND");
      return new Uint8Array(await file.arrayBuffer());
    },
    async delete(key) {
      await rm(target(key), { force: true });
    },
    async listKeys() {
      try {
        return (await readdir(root)).filter((key) => /^[0-9a-f-]{36}$/i.test(key));
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "ENOENT")
          return [];
        throw error;
      }
    },
  };
};
