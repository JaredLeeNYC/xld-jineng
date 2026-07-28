import { describe, expect, test } from "bun:test";
import { createNotificationService } from "./notification-service";
import { parseWecomWebhookUrl } from "./webhook-url";

const admin = {
  accountId: "admin",
  employeeId: "employee-admin",
  employeeNumber: "A001",
  displayName: "管理员",
  role: "system_admin" as const,
  mustChangePassword: false,
};

describe("notification service", () => {
  test("accepts only official WeCom robot HTTPS URLs", () => {
    expect(
      parseWecomWebhookUrl("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1234567890-abcd"),
    ).toBeTruthy();
    expect(
      parseWecomWebhookUrl("http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1234567890"),
    ).toBeUndefined();
    expect(
      parseWecomWebhookUrl("https://127.0.0.1/cgi-bin/webhook/send?key=1234567890"),
    ).toBeUndefined();
    expect(
      parseWecomWebhookUrl(
        "https://qyapi.weixin.qq.com.evil.test/cgi-bin/webhook/send?key=1234567890",
      ),
    ).toBeUndefined();
  });

  test("records non-zero WeCom codes as retryable failures without throwing", async () => {
    const completed: Array<{ success: boolean; error?: string }> = [];
    const repository = {
      enqueueTest: async () => "delivery-1",
      claim: async () => ({
        id: "delivery-1",
        leaseToken: "lease-1",
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1234567890-abcd",
        payload: { title: "测试", message: "内容" },
      }),
      complete: async (
        _id: string,
        _leaseToken: string,
        result: { success: boolean; error?: string },
      ) => {
        completed.push(result);
      },
    };
    const service = createNotificationService({
      repository: repository as any,
      fetcher: async () =>
        new Response(JSON.stringify({ errcode: 40001, errmsg: "invalid key" }), {
          status: 200,
        }),
      now: () => new Date("2026-07-28T00:00:00.000Z"),
      idSource: () => "event-1",
    });
    const result = await service.testChannel(admin, "channel-1");
    expect(result.ok).toBeFalse();
    expect(completed).toEqual([{ success: false, error: "invalid key" }]);
  });

  test("treats transport failure as delivery failure rather than business failure", async () => {
    const completed: Array<{ success: boolean; error?: string }> = [];
    let claimed = false;
    const repository = {
      scan: async () => ({ skills: 1, overdue: 0 }),
      claim: async () => {
        if (claimed) return undefined;
        claimed = true;
        return {
          id: "delivery-1",
          leaseToken: "lease-1",
          webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1234567890-abcd",
          payload: { title: "到期", message: "技能即将到期" },
        };
      },
      complete: async (
        _id: string,
        _leaseToken: string,
        result: { success: boolean; error?: string },
      ) => completed.push(result),
    };
    const service = createNotificationService({
      repository: repository as any,
      fetcher: async () => {
        throw new Error("network unavailable");
      },
      now: () => new Date("2026-07-28T00:00:00.000Z"),
    });
    expect(await service.runScheduled()).toBe(1);
    expect(completed[0]?.success).toBeFalse();
  });
});
