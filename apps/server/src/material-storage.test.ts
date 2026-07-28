import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
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
    const blockedRestore = Bun.spawnSync({
      cmd: [bash, "deploy/restore-materials.sh", bashPath(archive), bashPath(target)],
      cwd: repositoryRoot,
      stderr: "pipe",
    });
    expect(blockedRestore.success).toBe(false);
    expect(blockedRestore.stderr.toString()).toContain("active material upload");
    await rm(`${target}.upload-locks`, { recursive: true, force: true });
    const restore = Bun.spawnSync({
      cmd: [bash, "deploy/restore-materials.sh", bashPath(archive), bashPath(target)],
      cwd: repositoryRoot,
      stderr: "pipe",
    });
    if (!restore.success) throw new Error(`restore failed: ${restore.stderr.toString()}`);
    expect(await Bun.file(join(target, key)).arrayBuffer()).toEqual(
      new Uint8Array([7, 8, 9]).buffer,
    );
    expect(await Bun.file(join(target, "stale-file")).exists()).toBe(false);
  }, 15_000);
});
