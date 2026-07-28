import { describe, expect, test } from "bun:test";
import { parseAcceptanceConfig } from "./capture-go-live-evidence";

const validEnvironment = {
  ACCEPTANCE_APPROVED: "YES",
  ACCEPTANCE_BASE_URL: "https://skills.example.com",
  ACCEPTANCE_ADMIN_EMPLOYEE_NUMBER: "ADMIN-001",
  ACCEPTANCE_ADMIN_PASSWORD: "not-a-real-password",
  ACCEPTANCE_EMPLOYEE_NUMBER: "E-001",
  ACCEPTANCE_EMPLOYEE_PASSWORD: "not-a-real-password",
  ACCEPTANCE_WECOM_WEBHOOK_URL:
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=example-key-1234567890",
  ACCEPTANCE_EVIDENCE_DIR: "/var/lib/skill-matrix/acceptance-evidence",
  ACCEPTANCE_EXPECTED_NOTIFICATION_TYPES: "training_published,assessment_archived",
};

describe("go-live evidence configuration", () => {
  test("accepts explicit production-safe inputs", () => {
    const config = parseAcceptanceConfig(validEnvironment, "/opt/skill-matrix/current");
    expect(config.baseUrl.origin).toBe("https://skills.example.com");
    expect(config.expectedNotificationTypes).toEqual(["training_published", "assessment_archived"]);
  });

  test("requires explicit approval", () => {
    expect(() => parseAcceptanceConfig({ ...validEnvironment, ACCEPTANCE_APPROVED: "NO" })).toThrow(
      "ACCEPTANCE_APPROVED=YES",
    );
  });

  test("rejects insecure targets and repository evidence paths", () => {
    expect(() =>
      parseAcceptanceConfig({ ...validEnvironment, ACCEPTANCE_BASE_URL: "http://localhost:3000" }),
    ).toThrow("HTTPS");
    expect(() =>
      parseAcceptanceConfig(
        { ...validEnvironment, ACCEPTANCE_EVIDENCE_DIR: "D:\\dev\\jineng\\evidence" },
        "D:\\dev\\jineng",
      ),
    ).toThrow("代码仓库之外");
  });

  test("rejects non-WeCom webhook targets", () => {
    expect(() =>
      parseAcceptanceConfig({
        ...validEnvironment,
        ACCEPTANCE_WECOM_WEBHOOK_URL: "https://example.com/?key=example-key-1234567890",
      }),
    ).toThrow("安全的企业微信群机器人地址");
  });
});
