import type { NotificationRepository } from "@jineng/skill-matrix-db";
import { randomUUID } from "node:crypto";
import type { SessionView } from "./auth-contract";
import { parseWecomWebhookUrl } from "./webhook-url";

const fail = (code: string, message: string, status: 400 | 403 | 404 | 409 | 500) => ({
  ok: false as const,
  error: { code, message, status },
});

export const createNotificationService = (dependencies: {
  repository: NotificationRepository;
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => Date;
  idSource?: () => string;
}) => {
  const { repository, fetcher = fetch, now, idSource = randomUUID } = dependencies;
  const dispatchOne = async (onlyId?: string) => {
    const delivery = await repository.claim(now(), onlyId);
    if (!delivery) return undefined;
    const safeUrl = parseWecomWebhookUrl(delivery.webhookUrl);
    let result: { success: boolean; error?: string };
    if (!safeUrl) {
      result = { success: false, error: "Webhook 地址不符合企业微信安全规则" };
    } else {
      try {
        const response = await fetcher(safeUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          redirect: "error",
          body: JSON.stringify({
            msgtype: "markdown",
            markdown: {
              content: `### ${delivery.payload.title}\n${delivery.payload.message}`,
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await response.json()) as { errcode?: number; errmsg?: string };
        result =
          response.ok && body.errcode === 0
            ? { success: true }
            : { success: false, error: (body.errmsg || `HTTP ${response.status}`).slice(0, 500) };
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.message.slice(0, 500) : "网络请求失败",
        };
      }
    }
    await repository.complete(delivery.id, delivery.leaseToken, result, now());
    return result.success;
  };
  return {
    async list(actor: SessionView) {
      if (actor.role === "system_admin") return fail("FORBIDDEN", "系统管理员无业务通知", 403);
      return { ok: true as const, data: await repository.list(actor.accountId) };
    },
    async markRead(actor: SessionView, id?: string) {
      if (actor.role === "system_admin") return fail("FORBIDDEN", "系统管理员无业务通知", 403);
      return {
        ok: true as const,
        data: { updated: await repository.markRead(actor.accountId, id) },
      };
    },
    async listChannels(actor: SessionView) {
      if (actor.role !== "system_admin")
        return fail("FORBIDDEN", "仅系统管理员可配置 Webhook", 403);
      return { ok: true as const, data: await repository.listChannels() };
    },
    async createChannel(
      actor: SessionView,
      input: { name: string; webhookUrl: string; active: boolean },
    ) {
      if (actor.role !== "system_admin")
        return fail("FORBIDDEN", "仅系统管理员可配置 Webhook", 403);
      const webhookUrl = parseWecomWebhookUrl(input.webhookUrl);
      if (!input.name.trim() || input.name.trim().length > 100 || !webhookUrl)
        return fail("INVALID_WEBHOOK", "请输入有效的企业微信群机器人 HTTPS 地址", 400);
      try {
        const id = await repository.createChannel({
          name: input.name.trim(),
          webhookUrl,
          active: input.active,
          actorAccountId: actor.accountId,
        });
        return { ok: true as const, data: { id } };
      } catch {
        return fail("WEBHOOK_NAME_CONFLICT", "Webhook 名称已存在", 409);
      }
    },
    async updateChannel(
      actor: SessionView,
      id: string,
      input: { name?: string; webhookUrl?: string; active?: boolean },
    ) {
      if (actor.role !== "system_admin")
        return fail("FORBIDDEN", "仅系统管理员可配置 Webhook", 403);
      const webhookUrl =
        input.webhookUrl !== undefined ? parseWecomWebhookUrl(input.webhookUrl) : undefined;
      if (
        (input.webhookUrl !== undefined && !webhookUrl) ||
        (input.name !== undefined && !input.name.trim())
      )
        return fail("INVALID_WEBHOOK", "Webhook 配置无效", 400);
      return (await repository.updateChannel({
        id,
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(webhookUrl ? { webhookUrl } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        actorAccountId: actor.accountId,
      }))
        ? { ok: true as const, data: { id } }
        : fail("WEBHOOK_NOT_FOUND", "Webhook 不存在", 404);
    },
    async testChannel(actor: SessionView, id: string) {
      if (actor.role !== "system_admin")
        return fail("FORBIDDEN", "仅系统管理员可测试 Webhook", 403);
      const outboxId = await repository.enqueueTest(id, `webhook_test:${id}:${idSource()}`);
      if (!outboxId) return fail("WEBHOOK_NOT_FOUND", "Webhook 不存在或已停用", 404);
      return (await dispatchOne(outboxId))
        ? { ok: true as const, data: { id: outboxId, status: "sent" as const } }
        : fail("WEBHOOK_TEST_FAILED", "测试发送失败，可在发送记录中重试", 409);
    },
    async listDeliveries(actor: SessionView) {
      if (actor.role !== "system_admin")
        return fail("FORBIDDEN", "仅系统管理员可查看发送记录", 403);
      return { ok: true as const, data: await repository.listDeliveries() };
    },
    async retry(actor: SessionView, id: string) {
      if (actor.role !== "system_admin") return fail("FORBIDDEN", "仅系统管理员可重试通知", 403);
      if (!(await repository.retry(id, actor.accountId)))
        return fail("DELIVERY_NOT_RETRYABLE", "发送记录不可重试", 409);
      await dispatchOne(id);
      return { ok: true as const, data: { id } };
    },
    async runScheduled() {
      await repository.scan(now());
      let dispatched = 0;
      while (dispatched < 20) {
        const result = await dispatchOne();
        if (result === undefined) break;
        dispatched += 1;
      }
      return dispatched;
    },
  };
};

export type NotificationService = ReturnType<typeof createNotificationService>;
