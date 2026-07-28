import { describe, expect, test } from "bun:test";
import { verifyGoLiveAcceptance } from "./verify-go-live-acceptance";

const validRecord = () => ({
  schemaVersion: 1,
  releaseVersion: "2026.07.28-1",
  acceptanceDate: "2026-08-03",
  owner: "验收负责人",
  conclusion: "passed",
  initialization: {
    employeeCount: 50,
    positionCount: 3,
    duplicateEmployeeNumbers: 0,
    fiveRoleChainEvidenceRef: "evidence/five-role-chain.pdf",
  },
  wecom: {
    sentAt: "2026-07-28T01:00:00Z",
    channelName: "生产管理群",
    deliveryId: "delivery-id",
    receiptConfirmed: true,
    receiptScreenshotRef: "evidence/wecom-received.png",
    controlledFailureAttempts: 2,
    retryAuditEvidenceRef: "evidence/wecom-acceptance.json",
  },
  inAppNotificationTypes: ["training_published", "assessment_archived"],
  recovery: {
    databaseEvidenceRef: "evidence/database-restore.log",
    materialEvidenceRef: "evidence/material-restore.log",
    loginAndDownloadEvidenceRef: "evidence/restore-readback.log",
  },
  gates: { bunTest: true, bunCheck: true, webBuild: true, migrationHash: "sha256:example" },
  trialDays: Array.from({ length: 7 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 6, 28 + index)).toISOString().slice(0, 10),
    activeEmployeeCount: 10,
    trainingSubmittedOrConfirmed: 1,
    assessmentsArchived: 1,
    notificationFailures: 0,
    notificationRetries: 0,
    blockingIssueCount: 0,
    owner: "值班负责人",
    evidenceRef: `evidence/day-${index + 1}.log`,
  })),
  unresolvedBlockingIssues: [],
});

describe("go-live acceptance verifier", () => {
  test("accepts a complete seven-day record", () => {
    expect(verifyGoLiveAcceptance(validRecord())).toEqual({ valid: true, stableDays: 7 });
  });

  test("requires human confirmation of the WeCom receipt", () => {
    const record = validRecord();
    record.wecom.receiptConfirmed = false;
    expect(() => verifyGoLiveAcceptance(record)).toThrow("现场人员确认");
  });

  test("rejects a skipped trial day or blocking incident", () => {
    const skipped = validRecord();
    skipped.trialDays[3]!.date = "2026-08-01";
    expect(() => verifyGoLiveAcceptance(skipped)).toThrow("连续排列");

    const blocked = validRecord();
    blocked.trialDays[2]!.blockingIssueCount = 1;
    expect(() => verifyGoLiveAcceptance(blocked)).toThrow("必须为 0");
  });

  test("rejects credentials and complete webhook URLs", () => {
    const leaked = Object.assign(validRecord(), { password: "should-not-be-here" });
    expect(() => verifyGoLiveAcceptance(leaked)).toThrow("禁止保存");
  });
});
