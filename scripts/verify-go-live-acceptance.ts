import { isAbsolute, relative, resolve } from "node:path";

type AcceptanceRecord = {
  schemaVersion?: unknown;
  releaseVersion?: unknown;
  acceptanceDate?: unknown;
  owner?: unknown;
  conclusion?: unknown;
  initialization?: {
    employeeCount?: unknown;
    positionCount?: unknown;
    duplicateEmployeeNumbers?: unknown;
    fiveRoleChainEvidenceRef?: unknown;
  };
  wecom?: {
    sentAt?: unknown;
    channelName?: unknown;
    deliveryId?: unknown;
    receiptConfirmed?: unknown;
    receiptScreenshotRef?: unknown;
    controlledFailureAttempts?: unknown;
    retryAuditEvidenceRef?: unknown;
  };
  inAppNotificationTypes?: unknown;
  recovery?: {
    databaseEvidenceRef?: unknown;
    materialEvidenceRef?: unknown;
    loginAndDownloadEvidenceRef?: unknown;
  };
  gates?: {
    bunTest?: unknown;
    bunCheck?: unknown;
    webBuild?: unknown;
    migrationHash?: unknown;
  };
  trialDays?: unknown;
  unresolvedBlockingIssues?: unknown;
};

const text = (value: unknown, name: string) => {
  if (typeof value !== "string" || !value.trim() || value.includes("待填写")) {
    throw new Error(`${name} 必须填写真实值`);
  }
  return value.trim();
};

const integer = (value: unknown, name: string, minimum: number) => {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${name} 必须是不小于 ${minimum} 的整数`);
  }
  return value as number;
};

const dateOnly = (value: unknown, name: string) => {
  const date = text(value, name);
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`${name} 必须是有效的 YYYY-MM-DD 日期`);
  }
  return date;
};

const instant = (value: unknown, name: string) => {
  const timestamp = text(value, name);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error(`${name} 必须是有效时间`);
  return timestamp;
};

const assertNoSecrets = (value: unknown) => {
  const serialized = JSON.stringify(value);
  if (
    /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook|[?&]key=|"(?:password|cookie|token|webhookUrl)"\s*:/i.test(
      serialized,
    )
  ) {
    throw new Error("验收记录疑似包含密码、Cookie、令牌或完整 Webhook，禁止保存");
  }
};

export const verifyGoLiveAcceptance = (record: AcceptanceRecord) => {
  assertNoSecrets(record);
  if (record.schemaVersion !== 1) throw new Error("schemaVersion 必须为 1");
  text(record.releaseVersion, "releaseVersion");
  dateOnly(record.acceptanceDate, "acceptanceDate");
  text(record.owner, "owner");
  if (record.conclusion !== "passed") throw new Error("conclusion 必须为 passed");

  const initialization = record.initialization;
  if (!initialization) throw new Error("缺少 initialization");
  integer(initialization.employeeCount, "initialization.employeeCount", 50);
  integer(initialization.positionCount, "initialization.positionCount", 3);
  if (initialization.duplicateEmployeeNumbers !== 0) {
    throw new Error("initialization.duplicateEmployeeNumbers 必须为 0");
  }
  text(initialization.fiveRoleChainEvidenceRef, "initialization.fiveRoleChainEvidenceRef");

  const wecom = record.wecom;
  if (!wecom) throw new Error("缺少 wecom");
  instant(wecom.sentAt, "wecom.sentAt");
  text(wecom.channelName, "wecom.channelName");
  text(wecom.deliveryId, "wecom.deliveryId");
  if (wecom.receiptConfirmed !== true) throw new Error("企业微信群内实收必须由现场人员确认");
  text(wecom.receiptScreenshotRef, "wecom.receiptScreenshotRef");
  integer(wecom.controlledFailureAttempts, "wecom.controlledFailureAttempts", 2);
  text(wecom.retryAuditEvidenceRef, "wecom.retryAuditEvidenceRef");

  if (!Array.isArray(record.inAppNotificationTypes)) {
    throw new Error("inAppNotificationTypes 必须是数组");
  }
  for (const requiredType of ["training_published", "assessment_archived"]) {
    if (!record.inAppNotificationTypes.includes(requiredType)) {
      throw new Error(`缺少站内通知证据类型 ${requiredType}`);
    }
  }

  const recovery = record.recovery;
  if (!recovery) throw new Error("缺少 recovery");
  text(recovery.databaseEvidenceRef, "recovery.databaseEvidenceRef");
  text(recovery.materialEvidenceRef, "recovery.materialEvidenceRef");
  text(recovery.loginAndDownloadEvidenceRef, "recovery.loginAndDownloadEvidenceRef");

  const gates = record.gates;
  if (!gates || gates.bunTest !== true || gates.bunCheck !== true || gates.webBuild !== true) {
    throw new Error("bun test、bun run check 和 Web 构建必须全部通过");
  }
  text(gates.migrationHash, "gates.migrationHash");

  if (!Array.isArray(record.trialDays) || record.trialDays.length !== 7) {
    throw new Error("trialDays 必须恰好包含连续 7 天记录");
  }
  let previousTime: number | undefined;
  for (const [index, rawDay] of record.trialDays.entries()) {
    if (!rawDay || typeof rawDay !== "object") throw new Error(`trialDays[${index}] 无效`);
    const day = rawDay as Record<string, unknown>;
    const date = dateOnly(day.date, `trialDays[${index}].date`);
    const time = Date.parse(`${date}T00:00:00Z`);
    if (previousTime !== undefined && time - previousTime !== 86_400_000) {
      throw new Error("trialDays 必须按日期连续排列，不能跳日或重复");
    }
    previousTime = time;
    integer(day.activeEmployeeCount, `trialDays[${index}].activeEmployeeCount`, 0);
    integer(
      day.trainingSubmittedOrConfirmed,
      `trialDays[${index}].trainingSubmittedOrConfirmed`,
      0,
    );
    integer(day.assessmentsArchived, `trialDays[${index}].assessmentsArchived`, 0);
    integer(day.notificationFailures, `trialDays[${index}].notificationFailures`, 0);
    integer(day.notificationRetries, `trialDays[${index}].notificationRetries`, 0);
    if (day.blockingIssueCount !== 0) {
      throw new Error(`trialDays[${index}].blockingIssueCount 必须为 0`);
    }
    text(day.owner, `trialDays[${index}].owner`);
    text(day.evidenceRef, `trialDays[${index}].evidenceRef`);
  }

  if (
    !Array.isArray(record.unresolvedBlockingIssues) ||
    record.unresolvedBlockingIssues.length > 0
  ) {
    throw new Error("unresolvedBlockingIssues 必须是空数组");
  }
  return { valid: true as const, stableDays: 7 };
};

const isInside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

if (import.meta.main) {
  try {
    const input = process.argv[2];
    if (!input || !isAbsolute(input)) throw new Error("请传入仓库外验收 JSON 的绝对路径");
    const resolved = resolve(input);
    if (isInside(resolve(process.cwd()), resolved))
      throw new Error("验收 JSON 必须位于代码仓库之外");
    const record = (await Bun.file(resolved).json()) as AcceptanceRecord;
    const result = verifyGoLiveAcceptance(record);
    console.log(`最终上线验收记录有效：连续稳定 ${result.stableDays} 天`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "最终上线验收记录无效");
    process.exitCode = 1;
  }
}
