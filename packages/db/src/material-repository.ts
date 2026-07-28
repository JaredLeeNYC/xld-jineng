import type { TrainingMaterialView } from "@jineng/skill-matrix-shared";
import type { Pool, PoolClient } from "pg";

type MaterialRecord = TrainingMaterialView & { storageKey?: string };

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

const selectMaterials = `select m.id, m.title, m.category, m.description, m.kind,
  m.external_url as "externalUrl", m.storage_key as "storageKey",
  m.original_filename as "originalFilename", m.mime_type as "mimeType",
  m.size_bytes as "sizeBytes", m.checksum, m.active, m.created_at as "createdAt",
  coalesce(array_agg(s.id) filter (where s.id is not null), '{}') as "skillIds",
  coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name))
    filter (where s.id is not null), '[]') as skills
 from training_materials m
 left join training_material_skills ms on ms.material_id = m.id and ms.active = true
 left join skills s on s.id = ms.skill_id`;

const normalize = (row: MaterialRecord): MaterialRecord => ({
  ...row,
  createdAt: new Date(row.createdAt).toISOString(),
  ...(row.description ? { description: row.description } : {}),
  ...(row.externalUrl ? { externalUrl: row.externalUrl } : {}),
  ...(row.originalFilename ? { originalFilename: row.originalFilename } : {}),
  ...(row.mimeType ? { mimeType: row.mimeType } : {}),
  ...(row.sizeBytes ? { sizeBytes: row.sizeBytes } : {}),
  ...(row.checksum ? { checksum: row.checksum } : {}),
  ...(row.storageKey ? { storageKey: row.storageKey } : {}),
});

export const createPostgresMaterialRepository = (pool: Pool) => ({
  async list(input: {
    includeInactive?: boolean;
    query?: string;
    role: "employee" | "department_manager" | "hr_admin" | "executive_viewer";
    employeeId: string;
    departmentId?: string;
  }) {
    const result = await pool.query<MaterialRecord>(
      `${selectMaterials}
       where (m.active = true or $1 = true)
         and ($2::text is null or m.title ilike '%' || $2 || '%' or m.category ilike '%' || $2 || '%')
         and (
           $3 = 'hr_admin' or $3 = 'executive_viewer' or exists (
             select 1 from training_material_skills access_ms
             join position_skill_requirements psr on psr.skill_id = access_ms.skill_id
             join position_assignments pa on pa.position_id = psr.position_id and pa.ended_at is null
             where access_ms.material_id = m.id and access_ms.active = true
               and (($3 = 'employee' and pa.employee_id = $4::uuid)
                 or ($3 = 'department_manager' and pa.department_id = $5::uuid))
           )
         )
       group by m.id order by m.created_at desc`,
      [
        input.includeInactive ?? false,
        input.query ?? null,
        input.role,
        input.employeeId,
        input.departmentId ?? null,
      ],
    );
    return result.rows.map(normalize);
  },
  async get(id: string) {
    const result = await pool.query<MaterialRecord>(
      `${selectMaterials} where m.id = $1 group by m.id`,
      [id],
    );
    return result.rows[0] ? normalize(result.rows[0]) : undefined;
  },
  async create(input: {
    id: string;
    title: string;
    category: string;
    description?: string;
    kind: "file" | "link";
    externalUrl?: string;
    storageKey?: string;
    originalFilename?: string;
    mimeType?: string;
    sizeBytes?: number;
    checksum?: string;
    skillIds: string[];
    actorAccountId: string;
  }) {
    return transaction(pool, async (client) => {
      const valid = await client.query(
        "select count(*)::int as count from skills where id = any($1::uuid[]) and active = true",
        [input.skillIds],
      );
      if (valid.rows[0]?.count !== input.skillIds.length) return undefined;
      await client.query(
        `insert into training_materials
         (id, title, category, description, kind, external_url, storage_key, original_filename,
          mime_type, size_bytes, checksum, created_by_account_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          input.id,
          input.title,
          input.category,
          input.description ?? null,
          input.kind,
          input.externalUrl ?? null,
          input.storageKey ?? null,
          input.originalFilename ?? null,
          input.mimeType ?? null,
          input.sizeBytes ?? null,
          input.checksum ?? null,
          input.actorAccountId,
        ],
      );
      for (const skillId of input.skillIds)
        await client.query(
          "insert into training_material_skills (material_id, skill_id) values ($1,$2)",
          [input.id, skillId],
        );
      await client.query(
        `insert into audit_logs (actor_account_id, action, object_type, object_id, summary)
         values ($1,'training_material.created','training_material',$2,$3)`,
        [input.actorAccountId, input.id, { kind: input.kind, skillIds: input.skillIds }],
      );
      return input.id;
    });
  },
  async update(input: {
    id: string;
    title: string;
    category: string;
    description?: string;
    skillIds: string[];
    actorAccountId: string;
  }) {
    return transaction(pool, async (client) => {
      const valid = await client.query(
        "select count(*)::int as count from skills where id = any($1::uuid[]) and active = true",
        [input.skillIds],
      );
      if (valid.rows[0]?.count !== input.skillIds.length) return false;
      const result = await client.query(
        "update training_materials set title=$2, category=$3, description=$4, updated_at=now() where id=$1 returning id",
        [input.id, input.title, input.category, input.description ?? null],
      );
      if (!result.rowCount) return false;
      await client.query(
        "update training_material_skills set active=false, updated_at=now() where material_id=$1 and active=true",
        [input.id],
      );
      for (const skillId of input.skillIds)
        await client.query(
          `insert into training_material_skills (material_id, skill_id) values ($1,$2)
           on conflict (material_id, skill_id) do update set active=true, updated_at=now()`,
          [input.id, skillId],
        );
      await client.query(
        "insert into audit_logs (actor_account_id,action,object_type,object_id) values ($1,'training_material.updated','training_material',$2)",
        [input.actorAccountId, input.id],
      );
      return true;
    });
  },
  async deactivate(id: string, actorAccountId: string) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        "update training_materials set active=false,updated_at=now() where id=$1 and active=true returning id",
        [id],
      );
      if (!result.rowCount) return false;
      await client.query(
        "insert into audit_logs (actor_account_id,action,object_type,object_id) values ($1,'training_material.deactivated','training_material',$2)",
        [actorAccountId, id],
      );
      return true;
    });
  },
  async storageKeys() {
    const result = await pool.query<{ storageKey: string }>(
      `select storage_key as "storageKey" from training_materials where storage_key is not null
       union select storage_key::text as "storageKey" from training_evidence`,
    );
    return result.rows.map((row) => row.storageKey);
  },
  async canRead(input: {
    materialId: string;
    role: "employee" | "department_manager" | "hr_admin" | "executive_viewer";
    employeeId: string;
    departmentId?: string;
  }) {
    if (input.role === "hr_admin" || input.role === "executive_viewer") return true;
    const result = await pool.query(
      `select 1 from training_material_skills ms
       join position_skill_requirements psr on psr.skill_id = ms.skill_id
       join position_assignments pa on pa.position_id = psr.position_id and pa.ended_at is null
       where ms.material_id = $1 and ms.active = true
         and (($2 = 'employee' and pa.employee_id = $3::uuid)
           or ($2 = 'department_manager' and pa.department_id = $4::uuid))
       limit 1`,
      [input.materialId, input.role, input.employeeId, input.departmentId ?? null],
    );
    return Boolean(result.rowCount);
  },
  async hasHistoricalAccess(materialId: string, employeeId: string) {
    const result = await pool.query(
      `select 1 from training_material_access_grants g
       where g.material_id=$1 and g.employee_id=$2 and
         (g.source_type<>'training_task' or exists (
           select 1 from training_tasks t where t.id::text=g.source_reference and t.status<>'cancelled'
         )) limit 1`,
      [materialId, employeeId],
    );
    return Boolean(result.rowCount);
  },
  async grantHistoricalAccess(input: {
    materialId: string;
    employeeId: string;
    sourceType: string;
    sourceReference: string;
  }) {
    await pool.query(
      `insert into training_material_access_grants
       (material_id, employee_id, source_type, source_reference) values ($1,$2,$3,$4)
       on conflict do nothing`,
      [input.materialId, input.employeeId, input.sourceType, input.sourceReference],
    );
  },
});

export type MaterialRepository = ReturnType<typeof createPostgresMaterialRepository>;
