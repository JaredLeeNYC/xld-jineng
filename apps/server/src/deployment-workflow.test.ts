import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const posix = (path: string) =>
  path
    .replaceAll("\\", "/")
    .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const sha = "a".repeat(40);
const run = async (cmd: string[], stdin?: string) => {
  const child = Bun.spawn({
    cmd,
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};
describe("SSH deployment completion", () => {
  test("reproduces successful premature exit when a child consumes a stdin script", async () => {
    const result = await run(
      [bash, "-s"],
      "set -euo pipefail\necho backup\ncat >/dev/null\necho deployment-complete\n",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("backup");
    expect(result.stdout).not.toContain("deployment-complete");
  });
  for (const scenario of [
    "success",
    "wrong-sha",
    "missing-account-marker",
    "missing-factory-read-marker",
    "child-failure",
    "missing-account-log",
  ]) {
    test(`executes workflow readback and cleanup: ${scenario}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "jineng-workflow-test-"));
      try {
        const root = posix(directory);
        await mkdir(join(directory, "current"));
        const fixture = join(directory, "release.sh");
        const accountLines = ["0341", "10032", "3761", "4243"]
          .filter((number) => scenario !== "missing-account-log" || number !== "4243")
          .map((number) => `echo '"employeeNumber": "${number}"'`)
          .join("\n");
        await Bun.write(
          fixture,
          `set -euo pipefail\necho backup\ncat >/dev/null\necho migration\necho current\necho health\n${scenario === "child-failure" ? "exit 9\n" : ""}${accountLines}\n${scenario === "missing-factory-read-marker" ? "" : `echo '==> factory read permission verified ${sha}'`}\n${scenario === "missing-account-marker" ? "" : `echo '==> reviewed accounts verified ${sha}'`}\nprintf '%s' '${scenario === "wrong-sha" ? "b".repeat(40) : sha}' > ${quote(root + "/current/.deployed-sha")}\n`,
        );
        const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
        let script = workflow.split("          script: |\n")[1]?.replace(/^            /gm, "");
        if (!script) throw new Error("Workflow SSH script not found");
        script = script
          .replaceAll("${{ github.sha }}", sha)
          .replace(/^git .* fetch origin .*$/m, "true")
          .replace(
            /^git .* show .* > "\$DEPLOY_SCRIPT"$/m,
            `cat ${quote(posix(fixture))} > "$DEPLOY_SCRIPT"`,
          )
          .replaceAll("/tmp/skill-matrix-", root + "/skill-matrix-")
          .replaceAll("/opt/skill-matrix/current", root + "/current");
        const wrapper = join(directory, "workflow.sh");
        await Bun.write(wrapper, script);
        const result = await run([bash, posix(wrapper)]);
        if (scenario === "success") {
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain(`deployment readback verified ${sha}`);
          expect(result.stdout).toContain("migration");
          expect(result.stdout).toContain('"employeeNumber": "4243"');
        } else {
          expect(result.exitCode).not.toBe(0);
          expect(result.stdout).not.toContain("deployment readback verified");
        }
        expect(
          (await readdir(directory)).filter((name) => name.startsWith("skill-matrix-")),
        ).toEqual([]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
