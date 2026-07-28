import { createApp } from "../apps/server/src/app";

const fail = (message: string): never => {
  throw new Error(message);
};

const openApiResponse = await createApp().handle(new Request("http://localhost/openapi/json"));
if (!openApiResponse.ok) {
  fail(`OpenAPI 生成失败：HTTP ${openApiResponse.status}`);
}

const specification = (await openApiResponse.json()) as {
  info?: { title?: string };
  paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
};

if (specification.info?.title !== "技能矩阵系统 API") {
  fail("OpenAPI 标题与项目不一致");
}
if (!specification.paths?.["/api/health"]?.get?.responses?.["200"]) {
  fail("OpenAPI 缺少 /api/health 的 200 响应契约");
}
if (
  !specification.paths?.["/api/ready"]?.get?.responses?.["200"] ||
  !specification.paths?.["/api/ready"]?.get?.responses?.["503"]
) {
  fail("OpenAPI 缺少 /api/ready 的 200/503 响应契约");
}
for (const [path, method, statuses] of [
  ["/api/auth/login", "post", ["200", "401", "423"]],
  ["/api/auth/session", "get", ["200", "401"]],
  ["/api/auth/change-password", "post", ["200", "401", "409"]],
  ["/api/auth/logout", "post", ["200"]],
  ["/api/employees/{employeeId}/profile", "get", ["200", "403"]],
  ["/api/admin/accounts", "get", ["200", "403"]],
  ["/api/admin/accounts/{accountId}/reset-password", "post", ["200", "403"]],
  ["/api/organization/departments", "get", ["200", "403"]],
  ["/api/organization/departments", "post", ["200", "403", "409"]],
  ["/api/organization/positions", "get", ["200", "403"]],
  ["/api/organization/positions", "post", ["200", "403", "409"]],
  ["/api/organization/employees", "get", ["200", "403"]],
  ["/api/organization/employees", "post", ["200", "403", "409"]],
  ["/api/organization/employees/{id}/assignment", "post", ["200", "403", "409"]],
  ["/api/organization/employees/import/dry-run", "post", ["200", "403"]],
  ["/api/organization/employees/import/{previewId}/confirm", "post", ["200", "403", "409"]],
  ["/api/skills", "get", ["200", "403"]],
  ["/api/skills", "post", ["200", "403", "409"]],
  ["/api/skills/{id}", "patch", ["200", "403", "404"]],
  ["/api/skills/{id}/deactivate", "post", ["200", "403", "404"]],
  ["/api/position-skill-requirements", "get", ["200", "403"]],
  ["/api/position-skill-requirements", "put", ["200", "403", "409"]],
  ["/api/position-skill-requirements/copy", "post", ["200", "403", "409"]],
  ["/api/skill-baselines/import/dry-run", "post", ["200", "403"]],
  ["/api/skill-baselines/import/{previewId}/confirm", "post", ["200", "403", "409"]],
  ["/api/skill-matrix", "get", ["200", "403"]],
  ["/api/reports/dashboard", "get", ["200", "403"]],
  ["/api/notifications", "get", ["200", "403"]],
  ["/api/admin/audit", "get", ["200", "403"]],
  ["/api/training-materials", "get", ["200", "403"]],
  ["/api/training-materials/link", "post", ["200", "403", "409"]],
  ["/api/training-materials/upload", "post", ["200", "403", "409"]],
  ["/api/training-materials/{id}", "patch", ["200", "403", "404"]],
  ["/api/training-materials/{id}/deactivate", "post", ["200", "403", "404"]],
  ["/api/training-materials/{id}/content", "get", ["200", "403", "404"]],
  ["/api/training-plans", "get", ["200", "403"]],
  ["/api/training-plans", "post", ["200", "403", "409"]],
  ["/api/training-plans/{id}", "patch", ["200", "403", "409"]],
  ["/api/training-plans/{id}/publish", "post", ["200", "403", "409"]],
  ["/api/training-plans/{id}/cancel", "post", ["200", "403", "409"]],
  ["/api/training-tasks", "get", ["200", "403"]],
  ["/api/training-tasks/{id}/submit", "post", ["200", "403", "409"]],
  ["/api/training-tasks/{id}/confirm", "post", ["200", "403", "409"]],
  ["/api/training-tasks/{id}/return", "post", ["200", "403", "409"]],
  ["/api/training-plans/{id}/batch-confirm", "post", ["200", "403", "409"]],
  ["/api/training-evidence/{id}/content", "get", ["200", "403", "404"]],
] as const) {
  const responses = specification.paths?.[path]?.[method]?.responses;
  if (!responses || statuses.some((status) => !responses[status])) {
    fail(`OpenAPI 缺少 ${method.toUpperCase()} ${path} 的严格响应契约`);
  }
}

const requiredDeploymentContent = new Map([
  [
    "deploy/skill-matrix-server.service",
    [
      "WorkingDirectory=/opt/skill-matrix/current",
      "ExecStart=/usr/local/bin/bun apps/server/src/index.ts",
      "ReadWritePaths=/opt/skill-matrix /var/lib/skill-matrix",
    ],
  ],
  [
    "deploy/nginx-skill-matrix.conf",
    [
      "root /opt/skill-matrix/current/apps/web/dist;",
      "proxy_pass http://127.0.0.1:3000;",
      "try_files $uri $uri/ /index.html;",
    ],
  ],
  [
    "deploy/compose.postgres.yaml",
    ["postgres:17-alpine", "127.0.0.1:5432:5432", "skill-matrix-postgres"],
  ],
  [
    "deploy/validate-release.sh",
    ["set -euo pipefail", "/opt/skill-matrix/releases/*", "bun run check"],
  ],
  ["deploy/server.env.example", ["MATERIAL_STORAGE_DIR=/var/lib/skill-matrix/materials"]],
  ["deploy/backup-materials.sh", ["umask 077", "sha256sum", "tar -tzf", "-links +1"]],
  [
    "deploy/restore-materials.sh",
    ["sha256sum -c", "target_dir", "RESTORE_APPROVED", "tar -tvzf", "-links +1"],
  ],
  ["deploy/backup-database.sh", ["pg_dump --format=custom", "sha256sum"]],
  ["deploy/restore-database.sh", ["RESTORE_APPROVED", "pg_restore --exit-on-error"]],
  ["deploy/smoke-test.sh", ["/api/health", "/api/ready", "/api/auth/login"]],
  [
    "deploy/release.sh",
    [
      "RELEASE_APPROVED",
      "DATABASE_URL",
      "server.env permissions",
      "backup-database.sh",
      "bun run db:migrate",
      "smoke-test.sh",
    ],
  ],
  [
    "packages/db/scripts/verify-restored-system.ts",
    ["Bun.password.verify", "createFilesystemMaterialStorage", "sha256"],
  ],
]);

for (const [path, requiredParts] of requiredDeploymentContent) {
  const content = await Bun.file(path).text();
  for (const requiredPart of requiredParts) {
    if (!content.includes(requiredPart)) {
      fail(`${path} 缺少发布约束：${requiredPart}`);
    }
  }
}

const bash =
  process.platform === "win32" && (await Bun.file("C:/Program Files/Git/bin/bash.exe").exists())
    ? "C:/Program Files/Git/bin/bash.exe"
    : "bash";
const syntaxCheck = Bun.spawnSync({
  cmd: [
    bash,
    "-n",
    "deploy/validate-release.sh",
    "deploy/backup-materials.sh",
    "deploy/restore-materials.sh",
    "deploy/backup-database.sh",
    "deploy/restore-database.sh",
    "deploy/smoke-test.sh",
    "deploy/release.sh",
  ],
  stderr: "pipe",
  stdout: "pipe",
});
if (!syntaxCheck.success) {
  fail(`发布脚本语法错误：${syntaxCheck.stderr.toString()}`);
}

const serviceFile = await Bun.file("deploy/skill-matrix-server.service").text();
if (serviceFile.includes("ExecStartPre") || serviceFile.includes("db:migrate")) {
  fail("systemd 普通重启不得隐式执行数据库迁移");
}

console.log("OpenAPI 与部署契约校验通过");
