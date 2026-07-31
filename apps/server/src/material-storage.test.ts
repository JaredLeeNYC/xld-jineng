import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createCosMaterialStorage,
  createFilesystemMaterialStorage,
  createMemoryMaterialStorage,
  type CosMaterialStorageClient,
} from "./material-storage";

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

  test("filesystem adapter removes interrupted uploads only after the retention period", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-material-temp-"));
    directories.push(directory);
    directories.push(`${directory}.upload-locks`);
    const temporary = join(directory, `${key}.uploading`);
    const lock = join(`${directory}.upload-locks`, key);
    await mkdir(`${directory}.upload-locks`, { recursive: true });
    await Bun.write(temporary, new Uint8Array([1]));
    await Bun.write(lock, "uploading");
    const old = new Date("2026-01-01T00:00:00.000Z");
    await utimes(temporary, old, old);
    await utimes(lock, old, old);
    const storage = createFilesystemMaterialStorage(directory);
    expect(await storage.cleanupTemporary(new Date("2026-01-02T00:00:00.000Z"))).toEqual([
      `${key}.uploading`,
      `.upload-locks/${key}`,
    ]);
    expect(await Bun.file(temporary).exists()).toBe(false);
    expect(await Bun.file(lock).exists()).toBe(false);
  });

  test("COS adapter maps logical keys to a private prefix and reconciles pages", async () => {
    const requests: { method: string; key?: string; marker?: string }[] = [];
    const client: CosMaterialStorageClient = {
      async putObject(params) {
        requests.push({ method: "put", key: params.Key });
        return {} as never;
      },
      async getObject(params) {
        requests.push({ method: "get", key: params.Key });
        return { Body: Buffer.from([4, 5, 6]) } as never;
      },
      async deleteObject(params) {
        requests.push({ method: "delete", key: params.Key });
        return {} as never;
      },
      async getBucket(params) {
        requests.push({
          method: "list",
          ...(params.Marker ? { marker: params.Marker } : {}),
        });
        if (!params.Marker) {
          return {
            Contents: [
              {
                Key: `skill-matrix/${key}`,
                LastModified: "2026-01-01T00:00:00.000Z",
              },
              { Key: "skill-matrix/not-a-storage-key", LastModified: "2026-01-01T00:00:00.000Z" },
            ],
            IsTruncated: "true",
            NextMarker: `skill-matrix/${key}`,
          } as never;
        }
        return {
          Contents: [
            {
              Key: "skill-matrix/22222222-2222-4222-8222-222222222222",
              LastModified: "2026-01-03T00:00:00.000Z",
            },
          ],
          IsTruncated: "false",
        } as never;
      },
    };
    const storage = createCosMaterialStorage({
      bucket: "skill-matrix-materials-1442183788",
      region: "ap-guangzhou",
      objectPrefix: "/skill-matrix",
      secretId: "secret-id",
      secretKey: "secret-key",
      client,
    });

    await storage.beginWrite(key);
    await storage.put(key, new Uint8Array([1, 2, 3]));
    expect(await storage.get(key)).toEqual(new Uint8Array([4, 5, 6]));
    expect(
      await storage.listKeys(new Date("2026-01-02T00:00:00.000Z")),
    ).toEqual([key]);
    await storage.delete(key);
    await storage.endWrite(key);
    expect(requests).toEqual([
      { method: "put", key: `skill-matrix/${key}` },
      { method: "get", key: `skill-matrix/${key}` },
      { method: "list" },
      { method: "list", marker: `skill-matrix/${key}` },
      { method: "delete", key: `skill-matrix/${key}` },
    ]);
  });

  test("backup and restore scripts reproduce the exact verified snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-material-backup-"));
    directories.push(directory);
    const source = join(directory, "source");
    const target = join(directory, "target");
    const archive = join(directory, "materials.tar.gz");
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await Bun.write(join(source, key), new Uint8Array([7, 8, 9]));
    await Bun.write(join(target, "stale-file"), "must disappear");
    await mkdir(`${target}.upload-locks`, { recursive: true });
    await Bun.write(join(`${target}.upload-locks`, "active-writer"), "uploading");
    const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
    const bashPath = (path: string) => {
      if (process.platform !== "win32") return path;
      const converted = Bun.spawnSync({
        cmd: [bash, "-lc", 'cygpath -u "$1"', "convert", path],
        stdout: "pipe",
      });
      return converted.stdout.toString().trim();
    };
    const repositoryRoot = resolve(import.meta.dir, "../../..");
    const backup = Bun.spawnSync({
      cmd: [bash, "deploy/backup-materials.sh", bashPath(source), bashPath(archive)],
      cwd: repositoryRoot,
      stderr: "pipe",
    });
    if (!backup.success) throw new Error(`backup failed: ${backup.stderr.toString()}`);
    const unapprovedRestore = Bun.spawnSync({
      cmd: [bash, "deploy/restore-materials.sh", bashPath(archive), bashPath(target)],
      cwd: repositoryRoot,
      stderr: "pipe",
    });
    expect(unapprovedRestore.success).toBe(false);
    expect(unapprovedRestore.stderr.toString()).toContain("RESTORE_APPROVED");
    const blockedRestore = Bun.spawnSync({
      cmd: [bash, "deploy/restore-materials.sh", bashPath(archive), bashPath(target)],
      cwd: repositoryRoot,
      env: {
        ...process.env,
        RESTORE_APPROVED: "YES",
        ALLOW_UNSAFE_TEST_RESTORE: "YES",
        RESTORE_TEST_ROOT: bashPath(directory),
      },
      stderr: "pipe",
    });
    expect(blockedRestore.success).toBe(false);
    expect(blockedRestore.stderr.toString()).toContain("active material upload");
    await rm(`${target}.upload-locks`, { recursive: true, force: true });
    await appendFile(archive, "tampered");
    const tamperedRestore = Bun.spawnSync({
      cmd: [bash, "deploy/restore-materials.sh", bashPath(archive), bashPath(target)],
      cwd: repositoryRoot,
      env: {
        ...process.env,
        RESTORE_APPROVED: "YES",
        ALLOW_UNSAFE_TEST_RESTORE: "YES",
        RESTORE_TEST_ROOT: bashPath(directory),
      },
      stderr: "pipe",
    });
    expect(tamperedRestore.success).toBe(false);
    expect(tamperedRestore.stderr.toString()).toContain("did NOT match");
    const freshBackup = Bun.spawnSync({
      cmd: [bash, "deploy/backup-materials.sh", bashPath(source), bashPath(archive)],
      cwd: repositoryRoot,
      stderr: "pipe",
    });
    if (!freshBackup.success)
      throw new Error(`fresh backup failed: ${freshBackup.stderr.toString()}`);
    const restore = Bun.spawnSync({
      cmd: [bash, "deploy/restore-materials.sh", bashPath(archive), bashPath(target)],
      cwd: repositoryRoot,
      env: {
        ...process.env,
        RESTORE_APPROVED: "YES",
        ALLOW_UNSAFE_TEST_RESTORE: "YES",
        RESTORE_TEST_ROOT: bashPath(directory),
      },
      stderr: "pipe",
    });
    if (!restore.success) throw new Error(`restore failed: ${restore.stderr.toString()}`);
    expect(await Bun.file(join(target, key)).arrayBuffer()).toEqual(
      new Uint8Array([7, 8, 9]).buffer,
    );
    expect(await Bun.file(join(target, "stale-file")).exists()).toBe(false);
  }, 45_000);
});
