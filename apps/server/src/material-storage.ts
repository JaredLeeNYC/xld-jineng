import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import COS from "cos-nodejs-sdk-v5";

export type MaterialStorage = {
  beginWrite(key: string): Promise<void>;
  endWrite(key: string): Promise<void>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  listKeys(olderThan?: Date): Promise<string[]>;
  cleanupTemporary(olderThan: Date): Promise<string[]>;
};

export type CosMaterialStorageClient = {
  putObject(params: COS.PutObjectParams): Promise<COS.PutObjectResult>;
  getObject(params: COS.GetObjectParams): Promise<COS.GetObjectResult>;
  deleteObject(params: COS.DeleteObjectParams): Promise<COS.DeleteObjectResult>;
  getBucket(params: COS.GetBucketParams): Promise<COS.GetBucketResult>;
};

export type CosMaterialStorageOptions = {
  bucket: string;
  region: string;
  objectPrefix: string;
  secretId: string;
  secretKey: string;
  client?: CosMaterialStorageClient;
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

const normalizeObjectPrefix = (value: string) => {
  const prefix = value.trim().replace(/^\/+/, "");
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
};

const objectNotFound = (error: unknown) => {
  if (typeof error !== "object" || !error) return false;
  const code = "code" in error ? error.code : undefined;
  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  return code === "NoSuchKey" || code === "NoSuchObject" || statusCode === 404;
};

export const createCosMaterialStorage = (options: CosMaterialStorageOptions): MaterialStorage => {
  const prefix = normalizeObjectPrefix(options.objectPrefix);
  if (!prefix) throw new Error("COS_OBJECT_PREFIX_INVALID");
  const client =
    options.client ??
    new COS({
      SecretId: options.secretId,
      SecretKey: options.secretKey,
    });
  const objectKey = (key: string) => {
    assertStorageKey(key);
    return `${prefix}${key}`;
  };
  const requestBase = { Bucket: options.bucket, Region: options.region };

  return {
    async beginWrite(key) {
      objectKey(key);
    },
    async endWrite(key) {
      objectKey(key);
    },
    async put(key, bytes) {
      await client.putObject({
        ...requestBase,
        Key: objectKey(key),
        Body: Buffer.from(bytes),
        ContentLength: bytes.byteLength,
      });
    },
    async get(key) {
      try {
        const result = await client.getObject({
          ...requestBase,
          Key: objectKey(key),
        });
        return new Uint8Array(result.Body);
      } catch (error) {
        if (objectNotFound(error)) throw new Error("STORAGE_OBJECT_NOT_FOUND");
        throw error;
      }
    },
    async delete(key) {
      await client.deleteObject({
        ...requestBase,
        Key: objectKey(key),
      });
    },
    async listKeys(olderThan) {
      const keys: string[] = [];
      let marker: string | undefined;
      do {
        const params: COS.GetBucketParams = {
          ...requestBase,
          Prefix: prefix,
          MaxKeys: 1_000,
          ...(marker ? { Marker: marker } : {}),
        };
        const result = await client.getBucket(params);
        for (const item of result.Contents ?? []) {
          if (!item.Key.startsWith(prefix)) continue;
          const key = item.Key.slice(prefix.length);
          if (!/^[0-9a-f-]{36}$/i.test(key)) continue;
          if (olderThan && new Date(item.LastModified) >= olderThan) continue;
          keys.push(key);
        }
        marker = result.IsTruncated === "true" ? result.NextMarker : undefined;
      } while (marker);
      return keys;
    },
    async cleanupTemporary() {
      // COS simple PUT 不会在应用端创建临时文件或锁目录；未完成分片由桶生命周期规则负责。
      return [];
    },
  };
};
