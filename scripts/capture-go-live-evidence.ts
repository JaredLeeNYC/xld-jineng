import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { parseWecomWebhookUrl } from "../apps/server/src/webhook-url";

type Environment = Record<string, string | undefined>;

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

type Delivery = {
  id: string;
  eventType: string;
  channelName: string;
  status: string;
  attempts: number;
  lastAttemptAt?: string;
  sentAt?: string;
  errorMessage?: string;
  createdAt: string;
};

type Notification = {
  id: string;
  type: string;
  entityType?: string;
  createdAt: string;
};

type AuditEntry = {
  action: string;
  objectId?: string;
  occurredAt?: string;
  createdAt?: string;
};

export type AcceptanceConfig = {
  baseUrl: URL;
  adminEmployeeNumber: string;
  adminPassword: string;
  employeeNumber: string;
  employeePassword: string;
  webhookUrl: string;
  evidenceDirectory: string;
  expectedNotificationTypes: string[];
};

const required = (environment: Environment, name: string) => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
};

const isInside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

export const parseAcceptanceConfig = (
  environment: Environment,
  repositoryDirectory = process.cwd(),
): AcceptanceConfig => {
  if (environment.ACCEPTANCE_APPROVED !== "YES") {
    throw new Error("真实验收必须显式设置 ACCEPTANCE_APPROVED=YES");
  }

  const baseUrl = new URL(required(environment, "ACCEPTANCE_BASE_URL"));
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    throw new Error("ACCEPTANCE_BASE_URL 必须是无凭证、查询参数和子路径的 HTTPS 站点根地址");
  }

  const webhookUrl = required(environment, "ACCEPTANCE_WECOM_WEBHOOK_URL");
  if (!parseWecomWebhookUrl(webhookUrl)) {
    throw new Error("ACCEPTANCE_WECOM_WEBHOOK_URL 不是安全的企业微信群机器人地址");
  }

  const evidenceInput = required(environment, "ACCEPTANCE_EVIDENCE_DIR");
  if (!isAbsolute(evidenceInput)) throw new Error("ACCEPTANCE_EVIDENCE_DIR 必须是绝对路径");
  const evidenceDirectory = resolve(evidenceInput);
  if (isInside(resolve(repositoryDirectory), evidenceDirectory)) {
    throw new Error("验收证据目录必须位于代码仓库之外");
  }

  const expectedNotificationTypes = required(environment, "ACCEPTANCE_EXPECTED_NOTIFICATION_TYPES")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (expectedNotificationTypes.length === 0) {
    throw new Error("至少需要一种预期站内通知类型");
  }

  return {
    baseUrl,
    adminEmployeeNumber: required(environment, "ACCEPTANCE_ADMIN_EMPLOYEE_NUMBER"),
    adminPassword: required(environment, "ACCEPTANCE_ADMIN_PASSWORD"),
    employeeNumber: required(environment, "ACCEPTANCE_EMPLOYEE_NUMBER"),
    employeePassword: required(environment, "ACCEPTANCE_EMPLOYEE_PASSWORD"),
    webhookUrl,
    evidenceDirectory,
    expectedNotificationTypes: [...new Set(expectedNotificationTypes)],
  };
};

const createClient = (baseUrl: URL) => {
  let cookie: string | undefined;
  const request = async <T>(
    path: string,
    init: RequestInit = {},
    allowedStatuses = [200],
  ): Promise<{ status: number; data?: T; errorCode?: string }> => {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as Envelope<T>;
    if (!allowedStatuses.includes(response.status)) {
      const detail = payload.ok
        ? "响应状态不符合预期"
        : `${payload.error.code}: ${payload.error.message}`;
      throw new Error(`${init.method ?? "GET"} ${path} 失败（HTTP ${response.status}，${detail}）`);
    }
    return payload.ok
      ? { status: response.status, data: payload.data }
      : { status: response.status, errorCode: payload.error.code };
  };
  return {
    request,
    async login(employeeNumber: string, password: string) {
      const response = await fetch(new URL("/api/auth/login", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ employeeNumber, password }),
      });
      const payload = (await response.json()) as Envelope<{ role: string }>;
      if (!response.ok || !payload.ok) {
        const code = payload.ok ? `HTTP_${response.status}` : payload.error.code;
        throw new Error(`验收账号登录失败（${code}）`);
      }
      const setCookie = response.headers.get("set-cookie");
      cookie = setCookie?.split(";", 1)[0];
      if (!cookie) throw new Error("登录响应缺少会话 Cookie");
      return payload.data;
    },
  };
};

const requireData = <T>(value: T | undefined, step: string): T => {
  if (value === undefined) throw new Error(`${step} 未返回数据`);
  return value;
};

const sanitizeDelivery = (delivery: Delivery) => ({
  id: delivery.id,
  eventType: delivery.eventType,
  channelName: delivery.channelName,
  status: delivery.status,
  attempts: delivery.attempts,
  lastAttemptAt: delivery.lastAttemptAt,
  sentAt: delivery.sentAt,
  hasError: Boolean(delivery.errorMessage),
  createdAt: delivery.createdAt,
});

export const runAcceptance = async (config: AcceptanceConfig) => {
  const timestamp = new Date();
  const suffix = timestamp.toISOString().replaceAll(/[:.]/g, "-");
  const realChannelName = `上线验收-真实-${suffix}`;
  const failureChannelName = `上线验收-受控失败-${suffix}`;
  const admin = createClient(config.baseUrl);
  const employee = createClient(config.baseUrl);
  const createdChannelIds: string[] = [];

  const adminSession = await admin.login(config.adminEmployeeNumber, config.adminPassword);
  if (adminSession.role !== "system_admin") throw new Error("验收管理账号不是系统管理员");
  const employeeSession = await employee.login(config.employeeNumber, config.employeePassword);
  if (employeeSession.role === "system_admin") throw new Error("站内通知验收账号不能是系统管理员");

  try {
    const createReal = await admin.request<{ id: string }>("/api/admin/webhook-channels", {
      method: "POST",
      body: JSON.stringify({ name: realChannelName, webhookUrl: config.webhookUrl, active: true }),
    });
    const realChannelId = requireData(createReal.data, "创建真实验收通道").id;
    createdChannelIds.push(realChannelId);
    const realTest = await admin.request<{ id: string; status: string }>(
      `/api/admin/webhook-channels/${realChannelId}/test`,
      { method: "POST" },
    );
    const realDeliveryId = requireData(realTest.data, "真实企业微信测试").id;

    const invalidWebhook =
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=acceptance-invalid-key-000000000000";
    const createFailure = await admin.request<{ id: string }>("/api/admin/webhook-channels", {
      method: "POST",
      body: JSON.stringify({
        name: failureChannelName,
        webhookUrl: invalidWebhook,
        active: true,
      }),
    });
    const failureChannelId = requireData(createFailure.data, "创建受控失败通道").id;
    createdChannelIds.push(failureChannelId);
    const failedTest = await admin.request<never>(
      `/api/admin/webhook-channels/${failureChannelId}/test`,
      { method: "POST" },
      [409],
    );
    if (failedTest.errorCode !== "WEBHOOK_TEST_FAILED") {
      throw new Error("受控失败没有返回 WEBHOOK_TEST_FAILED");
    }

    const beforeRetryResponse = await admin.request<Delivery[]>(
      "/api/admin/notification-deliveries",
    );
    const beforeRetry = requireData(beforeRetryResponse.data, "读取失败发送记录").find(
      (item) => item.channelName === failureChannelName,
    );
    if (!beforeRetry || beforeRetry.status !== "failed" || beforeRetry.attempts !== 1) {
      throw new Error("未找到首次尝试为 1 的受控失败记录");
    }
    await admin.request(`/api/admin/notification-deliveries/${beforeRetry.id}/retry`, {
      method: "POST",
    });
    const afterRetryResponse = await admin.request<Delivery[]>(
      "/api/admin/notification-deliveries",
    );
    const afterRetry = requireData(afterRetryResponse.data, "读取重试发送记录").find(
      (item) => item.id === beforeRetry.id,
    );
    if (!afterRetry || afterRetry.status !== "failed" || afterRetry.attempts < 2) {
      throw new Error("受控失败记录没有完成第二次发送尝试");
    }

    const notificationResponse = await employee.request<Notification[]>("/api/notifications");
    const notifications = requireData(notificationResponse.data, "读取站内通知");
    const matchedNotifications = config.expectedNotificationTypes.map((type) => {
      const match = notifications.find((item) => item.type === type);
      if (!match) throw new Error(`站内通知缺少验收类型 ${type}`);
      return {
        id: match.id,
        type: match.type,
        entityType: match.entityType,
        createdAt: match.createdAt,
      };
    });

    const auditsResponse = await admin.request<AuditEntry[]>(
      "/api/admin/audit?action=notification_delivery.retried&limit=50",
    );
    const retryAudit = requireData(auditsResponse.data, "读取通知重试审计").find(
      (entry) => entry.objectId === beforeRetry.id,
    );
    if (!retryAudit) throw new Error("审计日志中缺少本次通知重试记录");

    const deliveriesResponse = await admin.request<Delivery[]>(
      "/api/admin/notification-deliveries",
    );
    const realDelivery = requireData(deliveriesResponse.data, "读取真实发送记录").find(
      (item) => item.id === realDeliveryId,
    );
    if (!realDelivery || realDelivery.status !== "sent") {
      throw new Error("真实企业微信测试记录不是 sent 状态");
    }

    const evidence = {
      schemaVersion: 1,
      executedAt: timestamp.toISOString(),
      siteOrigin: config.baseUrl.origin,
      operator: {
        adminEmployeeNumber: `***${config.adminEmployeeNumber.slice(-4)}`,
        employeeNumber: `***${config.employeeNumber.slice(-4)}`,
      },
      wecom: {
        realDelivery: sanitizeDelivery(realDelivery),
        controlledFailureBeforeRetry: sanitizeDelivery(beforeRetry),
        controlledFailureAfterRetry: sanitizeDelivery(afterRetry),
        retryAudit: {
          action: retryAudit.action,
          objectId: retryAudit.objectId,
          occurredAt: retryAudit.occurredAt ?? retryAudit.createdAt,
        },
        groupReceiptConfirmedByHuman: false,
        groupReceiptScreenshot: "待现场人员填写",
      },
      inAppNotifications: matchedNotifications,
      conclusion:
        "API 发送、受控失败、人工重试、审计和站内通知记录已验证；群内实际接收仍需现场人员截图确认。",
    };
    await mkdir(config.evidenceDirectory, { recursive: true, mode: 0o700 });
    const evidencePath = resolve(config.evidenceDirectory, `wecom-acceptance-${suffix}.json`);
    await Bun.write(evidencePath, `${JSON.stringify(evidence, undefined, 2)}\n`, {
      mode: 0o600,
    });
    return evidencePath;
  } finally {
    for (const channelId of createdChannelIds) {
      try {
        await admin.request(`/api/admin/webhook-channels/${channelId}`, {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        });
      } catch (error) {
        console.error(
          `警告：验收临时通道 ${channelId} 自动停用失败，请人工停用。`,
          error instanceof Error ? error.message : "未知错误",
        );
      }
    }
  }
};

if (import.meta.main) {
  try {
    const config = parseAcceptanceConfig(process.env);
    const evidencePath = await runAcceptance(config);
    console.log(`企业微信与站内通知验收步骤通过，脱敏证据：${evidencePath}`);
    console.log("请现场人员核对管理群消息并将接收截图登记到一期上线验收清单。");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "企业微信验收执行失败");
    process.exitCode = 1;
  }
}
