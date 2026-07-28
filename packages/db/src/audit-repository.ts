import type { Pool } from "pg";

export type AuditRecord = {
  id: string;
  source: "business" | "security";
  actorAccountId?: string;
  actorName?: string;
  action: string;
  objectType: string;
  objectId: string;
  summary: Record<string, unknown>;
  createdAt: string;
};

const sensitiveKey = /password|secret|token|webhook|credential|authorization|cookie|key/i;
const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitize);
  if (
    typeof value === "string" &&
    (/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook/i.test(value) || /[?&]key=/i.test(value))
  )
    return "[已脱敏]";
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[已脱敏]" : sanitize(item),
    ]),
  );
};

export const createPostgresAuditRepository = (pool: Pool) => ({
  async list(input: { source?: "business" | "security"; action?: string; limit: number }) {
    const result = await pool.query<{
      id: string;
      source: "business" | "security";
      actorAccountId: string | null;
      actorName: string | null;
      action: string;
      objectType: string;
      objectId: string;
      summary: Record<string, unknown>;
      createdAt: Date;
    }>(
      `select * from (
         select 'business'::text as source, a.id::text as id,
           a.actor_account_id as "actorAccountId", e.display_name as "actorName",
           a.action, a.object_type as "objectType", a.object_id as "objectId",
           a.summary, a.created_at as "createdAt"
         from audit_logs a
         left join user_accounts ua on ua.id=a.actor_account_id
         left join employees e on e.id=ua.employee_id
         union all
         select 'security'::text as source, s.id::text as id,
           s.account_id as "actorAccountId", e.display_name as "actorName",
           s.type as action, 'security_event'::text as "objectType", s.id::text as "objectId",
           s.detail as summary, s.created_at as "createdAt"
         from security_events s
         left join user_accounts ua on ua.id=s.account_id
         left join employees e on e.id=ua.employee_id
       ) events
       where ($1::text is null or source=$1)
         and ($2::text is null or action ilike '%' || $2 || '%')
       order by "createdAt" desc, id desc limit $3`,
      [input.source ?? null, input.action ?? null, input.limit],
    );
    return result.rows.map(
      (row): AuditRecord => ({
        id: `${row.source}:${row.id}`,
        source: row.source,
        ...(row.actorAccountId ? { actorAccountId: row.actorAccountId } : {}),
        ...(row.actorName ? { actorName: row.actorName } : {}),
        action: row.action,
        objectType: row.objectType,
        objectId: row.objectId,
        summary: sanitize(row.summary) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      }),
    );
  },
});

export type AuditRepository = ReturnType<typeof createPostgresAuditRepository>;
