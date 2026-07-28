import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const runSeed = async (initialPassword: string) => {
  const child = Bun.spawn([process.execPath, "packages/db/scripts/seed.ts"], {
    cwd: resolve(import.meta.dir, "../../.."),
    env: {
      ...Bun.env,
      DATABASE_URL: "not-a-postgres-url",
      SEED_INITIAL_PASSWORD: initialPassword,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr };
};

describe("database seed password boundary", () => {
  test("rejects seven characters before configuration and accepts eight", async () => {
    const sevenCharacters = await runSeed("1234567");
    const eightCharacters = await runSeed("12345678");

    expect(sevenCharacters.exitCode).not.toBe(0);
    expect(sevenCharacters.stderr).toContain("SEED_INITIAL_PASSWORD");
    expect(eightCharacters.exitCode).not.toBe(0);
    expect(eightCharacters.stderr).not.toContain("SEED_INITIAL_PASSWORD");
    expect(eightCharacters.stderr).toContain("DATABASE_URL");
  });
});
