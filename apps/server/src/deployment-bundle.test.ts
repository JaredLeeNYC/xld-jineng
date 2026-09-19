import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const posix = (path: string) =>
  path
    .replaceAll("\\", "/")
    .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
const run = async (cmd: string[], cwd: string, env: Record<string, string> = {}) => {
  const child = Bun.spawn({
    cmd,
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
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
const git = async (cwd: string, ...args: string[]) => {
  const result = await run(["git", ...args], cwd);
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
function workflowBlock(workflow: string, step: string, key: "run" | "script") {
  const lines = workflow.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${step}`);
  if (start < 0) throw new Error(`Missing workflow step: ${step}`);
  const blockStart = lines.findIndex((line, index) => index > start && line.trim() === `${key}: |`);
  if (blockStart < 0) throw new Error(`Missing workflow block: ${step}`);
  const indent = lines[blockStart]!.search(/\S/) + 2;
  const body: string[] = [];
  for (const line of lines.slice(blockStart + 1)) {
    if (line.trim() && line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

describe("actual workflow release bundle gates", () => {
  for (const scenario of [
    "complete",
    "wrong-sha",
    "damaged",
    "missing-ref",
    "missing-prerequisite",
    "wrong-checkout",
  ] as const) {
    test(`${scenario}: imports only the pinned complete commit before invoking deployment`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "jineng-bundle-test-"));
      try {
        const source = join(directory, "source");
        const target = join(directory, "target");
        const transfer = join(directory, "transfer");
        await Promise.all([mkdir(source), mkdir(target), mkdir(transfer)]);
        await git(source, "init", "--quiet");
        await git(source, "config", "user.name", "Bundle test");
        await git(source, "config", "user.email", "bundle-test@example.invalid");
        await mkdir(join(source, "deploy"));
        await Bun.write(
          join(source, "deploy", "auto-deploy.sh"),
          'set -euo pipefail\nprintf "%s" "$1" > "$DEPLOY_MARKER"\n',
        );
        await git(source, "add", "deploy/auto-deploy.sh");
        await git(source, "commit", "--quiet", "-m", "fixture deployment");
        const parent = await git(source, "rev-parse", "HEAD");
        await Bun.write(join(source, "release.txt"), "pinned release\n");
        await git(source, "add", "release.txt");
        await git(source, "commit", "--quiet", "-m", "fixture release");
        const expected = await git(source, "rev-parse", "HEAD");
        await git(target, "init", "--quiet");
        const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
        const builder = join(directory, "build.sh");
        await Bun.write(builder, workflowBlock(workflow, "Create complete release bundle", "run"));
        const built = await run([bash, posix(builder)], source, {
          EXPECTED_SHA: scenario === "wrong-checkout" ? parent : expected,
        });
        if (scenario === "wrong-checkout") {
          expect(built.exitCode).not.toBe(0);
          expect(await Bun.file(join(source, "release.bundle")).exists()).toBe(false);
          return;
        }
        expect(built.exitCode, built.stderr).toBe(0);
        const bundle = join(transfer, "release.bundle");
        if (scenario === "missing-ref") {
          await git(source, "bundle", "create", bundle, "HEAD");
        } else if (scenario === "missing-prerequisite") {
          await git(source, "bundle", "create", bundle, "refs/deploy/release", `^${parent}`);
        } else {
          await copyFile(join(source, "release.bundle"), bundle);
          if (scenario === "damaged") await Bun.write(bundle, "invalid bundle\n");
        }
        const marker = join(directory, "deployment-invoked");
        const ssh = workflowBlock(workflow, "Deploy via SSH", "script");
        // Execute the production import, SHA checks, git-show and invocation;
        // the committed fixture replaces only the actual deployment payload.
        const boundary = ssh.indexOf('test "$(cat /opt/skill-matrix/current/.deployed-sha)"');
        if (boundary < 0) throw new Error("Deployment readback boundary missing");
        const gate = ssh
          .slice(0, boundary)
          .replaceAll("${{ github.sha }}", scenario === "wrong-sha" ? parent : expected)
          .replaceAll("${{ github.run_id }}", "123")
          .replaceAll("${{ github.run_attempt }}", "2")
          .replaceAll("/tmp/skill-matrix-transfer-123-2/release.bundle", posix(bundle))
          .replaceAll("/opt/skill-matrix/repo", posix(target))
          .replaceAll("/tmp/skill-matrix-deploy", posix(join(directory, "script")));
        const wrapper = join(directory, "import.sh");
        await Bun.write(wrapper, gate);
        const imported = await run([bash, posix(wrapper)], directory, {
          DEPLOY_MARKER: posix(marker),
        });
        if (scenario === "complete") {
          expect(imported.exitCode, imported.stderr).toBe(0);
          expect(await readFile(marker, "utf8")).toBe(expected);
          expect(await git(target, "rev-parse", "FETCH_HEAD")).toBe(expected);
          expect(await git(target, "cat-file", "-t", parent)).toBe("commit");
          expect(await git(target, "show", `${expected}:release.txt`)).toBe("pinned release");
        } else {
          expect(imported.exitCode).not.toBe(0);
          expect(await Bun.file(marker).exists()).toBe(false);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }, 30000);
  }
});
