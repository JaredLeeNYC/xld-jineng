import type { Pool, PoolClient } from "pg";

const transaction = async <T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await operation(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

export const emitInAppNotification = async (
  client: PoolClient,
  input: {
    employeeId: string;
    eventKey: string;
    type: string;
    title: string;
    message: string;
    entityType?: string;
    entityId?: string;
  },
) => {
  await client.query(
    `insert into in_app_notifications
      (recipient_account_id,event_key,type,title,message,entity_type,entity_id)
     select a.id,$2,$3,$4,$5,$6,$7 from user_accounts a
     where a.employee_id=$1 and a.active=true
     on conflict (recipient_account_id,event_key) do nothing`,
    [
      input.employeeId,
      input.eventKey,
      input.type,
      input.title,
      input.message,
      input.entityType ?? null,
      input.entityId ?? null,
    ],
  );
};

export const enqueueManagementWebhook = async (
  client: PoolClient,
  input: { eventKey: string; eventType: string; title: string; message: string },
) => {
  await client.query(
    `insert into notification_outbox (event_key,event_type,channel_id,payload)
     select $1,$2,c.id,$3 from webhook_channels c where c.active=true
     on conflict (event_key,channel_id) do nothing`,
    [input.eventKey, input.eventType, { title: input.title, message: input.message }],
  );
};

const maskUrl = (value: string) => {
  try {
    const url = new URL(value);
    const key = url.searchParams.get("key") ?? "";
    return `${url.origin}${url.pathname}?key=***${key.slice(-4)}`;
  } catch {
    return "***";
  }
};

export const createPostgresNotificationRepository = (pool: Pool) => ({
  async list(accountId: string) {
    const result = await pool.query(
      `select id,event_key as "eventKey",type,title,message,entity_type as "entityType",
         entity_id as "entityId",read_at as "readAt",created_at as "createdAt"
       from in_app_notifications where recipient_account_id=$1 order by created_at desc limit 200`,
      [accountId],
    );
    return result.rows.map((row) => ({
      ...row,
      ...(row.readAt ? { readAt: new Date(row.readAt).toISOString() } : {}),
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  },
  async markRead(accountId: string, id?: string) {
    const result = await pool.query(
      `update in_app_notifications set read_at=coalesce(read_at,now())
       where recipient_account_id=$1 and ($2::uuid is null or id=$2) returning id`,
      [accountId, id ?? null],
    );
    return result.rowCount ?? 0;
  },
  async listChannels() {
    const result = await pool.query(
      `select id,name,webhook_url as "webhookUrl",active,created_at as "createdAt",updated_at as "updatedAt"
       from webhook_channels order by name`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      maskedUrl: maskUrl(row.webhookUrl),
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    }));
  },
  async createChannel(input: {
    name: string;
    webhookUrl: string;
    active: boolean;
    actorAccountId: string;
  }) {
    return transaction(pool, async (client) => {
      const result = await client.query<{ id: string }>(
        `insert into webhook_channels (name,webhook_url,active,created_by_account_id)
         values ($1,$2,$3,$4) returning id`,
        [input.name, input.webhookUrl, input.active, input.actorAccountId],
      );
      await client.query(
        `insert into audit_logs (actor_account_id,action,object_type,object_id,summary)
         values ($1,'webhook_channel.created','webhook_channel',$2,$3)`,
        [input.actorAccountId, result.rows[0]!.id, { name: input.name, active: input.active }],
      );
      return result.rows[0]!.id;
    });
  },
  async updateChannel(input: {
    id: string;
    name?: string;
    webhookUrl?: string;
    active?: boolean;
    actorAccountId: string;
  }) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        `update webhook_channels set name=coalesce($2,name),webhook_url=coalesce($3,webhook_url),
           active=coalesce($4,active),updated_at=now() where id=$1 returning id`,
        [input.id, input.name ?? null, input.webhookUrl ?? null, input.active ?? null],
      );
      if (!result.rowCount) return false;
      await client.query(
        `insert into audit_logs (actor_account_id,action,object_type,object_id,summary)
         values ($1,'webhook_channel.updated','webhook_channel',$2,$3)`,
        [input.actorAccountId, input.id, { active: input.active }],
      );
      return true;
    });
  },
  async enqueueTest(channelId: string, eventKey: string) {
    const result = await pool.query<{ id: string }>(
      `insert into notification_outbox (event_key,event_type,channel_id,payload)
       select $2,'webhook_test',id,$3 from webhook_channels where id=$1 and active=true
       returning id`,
      [channelId, eventKey, { title: "技能矩阵系统测试", message: "企业微信群机器人连接正常" }],
    );
    return result.rows[0]?.id;
  },
  async listDeliveries() {
    const result = await pool.query(
      `select o.id,o.event_key as "eventKey",o.event_type as "eventType",c.name as "channelName",
         o.status,o.attempts,o.last_attempt_at as "lastAttemptAt",o.sent_at as "sentAt",
         o.error_message as "errorMessage",o.created_at as "createdAt"
       from notification_outbox o join webhook_channels c on c.id=o.channel_id
       order by o.created_at desc limit 200`,
    );
    return result.rows.map((row) => ({
      ...row,
      ...(row.lastAttemptAt ? { lastAttemptAt: new Date(row.lastAttemptAt).toISOString() } : {}),
      ...(row.sentAt ? { sentAt: new Date(row.sentAt).toISOString() } : {}),
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  },
  async retry(id: string, actorAccountId: string) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        `update notification_outbox set status='pending',next_attempt_at=now(),error_message=null,
           updated_at=now() where id=$1 and status='failed'
             and exists (select 1 from webhook_channels c where c.id=channel_id and c.active=true)
           returning id`,
        [id],
      );
      if (!result.rowCount) return false;
      await client.query(
        `insert into audit_logs (actor_account_id,action,object_type,object_id)
         values ($1,'notification_delivery.retried','notification_delivery',$2)`,
        [actorAccountId, id],
      );
      return true;
    });
  },
  async claim(now: Date, onlyId?: string) {
    return transaction(pool, async (client) => {
      const result = await client.query<{
        id: string;
        webhookUrl: string;
        payload: { title: string; message: string };
      }>(
        `select o.id,c.webhook_url as "webhookUrl",o.payload
         from notification_outbox o join webhook_channels c on c.id=o.channel_id and c.active=true
         where (((o.status='pending' or (o.status='failed' and o.attempts<5)) and o.next_attempt_at<=$1)
           or (o.status='sending' and o.last_attempt_at<=$1::timestamptz - interval '5 minutes'))
           and ($2::uuid is null or o.id=$2)
         order by o.created_at for update of o skip locked limit 1`,
        [now, onlyId ?? null],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      const claimed = await client.query<{ leaseToken: string }>(
        `update notification_outbox set status='sending',lease_token=gen_random_uuid(),
           attempts=attempts+1,last_attempt_at=$2,updated_at=now()
         where id=$1 returning lease_token as "leaseToken"`,
        [row.id, now],
      );
      return { ...row, leaseToken: claimed.rows[0]!.leaseToken };
    });
  },
  async complete(
    id: string,
    leaseToken: string,
    result: { success: boolean; error?: string },
    now: Date,
  ) {
    await pool.query(
      `update notification_outbox set status=$3::varchar,lease_token=null,
         sent_at=case when $3::varchar='sent' then $4::timestamptz else null end,
         error_message=$5,next_attempt_at=case when $3::varchar='failed'
           then $4::timestamptz + least(attempts,5) * interval '5 minutes' else next_attempt_at end,
         updated_at=now() where id=$1 and status='sending' and lease_token=$2`,
      [id, leaseToken, result.success ? "sent" : "failed", now, result.error ?? null],
    );
  },
  async scan(now: Date) {
    return transaction(pool, async (client) => {
      const skills = await client.query<{
        assessmentId: string;
        employeeId: string;
        employeeName: string;
        skillName: string;
        validUntil: Date;
      }>(
        `select a.id as "assessmentId",a.employee_id as "employeeId",e.display_name as "employeeName",
           s.name as "skillName",a.valid_until as "validUntil"
         from employee_current_skills cs join skill_assessments a on a.id=cs.assessment_id
         join employees e on e.id=a.employee_id join skills s on s.id=a.skill_id
         where a.valid_until is not null and a.valid_until <= $1::timestamptz + interval '30 days'`,
        [now],
      );
      for (const row of skills.rows) {
        const expired = row.validUntil < now;
        const type = expired ? "skill_expired" : "skill_expiring";
        const eventKey = `${type}:${row.assessmentId}:${row.validUntil.toISOString().slice(0, 10)}`;
        const title = expired ? "技能已过期" : "技能即将到期";
        const message = `${row.employeeName}的“${row.skillName}”${expired ? "已过期" : "将在 30 天内到期"}`;
        await emitInAppNotification(client, {
          employeeId: row.employeeId,
          eventKey,
          type,
          title,
          message,
          entityType: "skill_assessment",
          entityId: row.assessmentId,
        });
        await enqueueManagementWebhook(client, { eventKey, eventType: type, title, message });
      }
      const overdue = await client.query<{ id: string; title: string; employeeName: string }>(
        `select t.id,p.title,e.display_name as "employeeName" from training_tasks t
         join training_plans p on p.id=t.plan_id join employees e on e.id=t.employee_id
         where p.due_at<$1::timestamptz and t.status not in ('confirmed','cancelled')`,
        [now],
      );
      for (const row of overdue.rows) {
        await enqueueManagementWebhook(client, {
          eventKey: `training_overdue:${row.id}`,
          eventType: "training_overdue",
          title: "培训任务逾期",
          message: `${row.employeeName}的“${row.title}”已逾期`,
        });
      }
      return { skills: skills.rowCount ?? 0, overdue: overdue.rowCount ?? 0 };
    });
  },
});

export type NotificationRepository = ReturnType<typeof createPostgresNotificationRepository>;
