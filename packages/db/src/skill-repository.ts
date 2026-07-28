import type {
  PositionSkillRequirementView,
  SkillBaselineImportRow,
  SkillCategory,
  SkillImportError,
  SkillLevel,
  SkillMatrixCell,
  SkillView,
} from "@jineng/skill-matrix-shared";
import { calculateSkillStatus } from "@jineng/skill-matrix-shared";
import { calculateCurrentSkillValidity } from "@jineng/skill-matrix-shared";
import type { Pool, PoolClient } from "pg";

const transaction = async <T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

const audit = async (
  client: Pool | PoolClient,
  input: {
    actorAccountId: string;
    action: string;
    objectType: string;
    objectId: string;
    summary?: unknown;
  },
) => {
  await client.query(
    `insert into audit_logs (actor_account_id, action, object_type, object_id, summary)
     values ($1, $2, $3, $4, $5)`,
    [input.actorAccountId, input.action, input.objectType, input.objectId, input.summary ?? {}],
  );
};

export const createPostgresSkillRepository = (pool: Pool) => ({
  async listSkills(
    input: { includeInactive?: boolean; query?: string } = {},
  ): Promise<SkillView[]> {
    const result = await pool.query<SkillView>(
      `select id, code, name, category,
              reassessment_required as "reassessmentRequired",
              validity_months as "validityMonths", active
       from skills
       where (active = true or $1 = true)
         and ($2::text is null or code ilike '%' || $2 || '%' or name ilike '%' || $2 || '%')
       order by category, code`,
      [input.includeInactive ?? false, input.query ?? null],
    );
    return result.rows.map((row) => ({
      ...row,
      ...(row.validityMonths ? { validityMonths: row.validityMonths } : {}),
    }));
  },

  async createSkill(input: {
    code: string;
    name: string;
    category: SkillCategory;
    reassessmentRequired: boolean;
    validityMonths?: number;
    actorAccountId: string;
  }): Promise<SkillView> {
    return transaction(pool, async (client) => {
      const result = await client.query<SkillView>(
        `insert into skills (code, name, category, reassessment_required, validity_months)
         values ($1, $2, $3, $4, $5)
         returning id, code, name, category, reassessment_required as "reassessmentRequired",
                   validity_months as "validityMonths", active`,
        [
          input.code,
          input.name,
          input.category,
          input.reassessmentRequired,
          input.validityMonths ?? null,
        ],
      );
      const skill = result.rows[0]!;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "skill.created",
        objectType: "skill",
        objectId: skill.id,
        summary: { code: skill.code },
      });
      return skill;
    });
  },

  async updateSkill(input: {
    id: string;
    name: string;
    category: SkillCategory;
    reassessmentRequired: boolean;
    validityMonths?: number;
    actorAccountId: string;
  }): Promise<boolean> {
    return transaction(pool, async (client) => {
      const result = await client.query(
        `update skills set name = $2, category = $3, reassessment_required = $4,
           validity_months = $5, updated_at = now() where id = $1 returning id`,
        [
          input.id,
          input.name,
          input.category,
          input.reassessmentRequired,
          input.validityMonths ?? null,
        ],
      );
      if (result.rowCount === 0) return false;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "skill.updated",
        objectType: "skill",
        objectId: input.id,
      });
      return true;
    });
  },

  async deactivateSkill(input: { id: string; actorAccountId: string }): Promise<boolean> {
    return transaction(pool, async (client) => {
      const result = await client.query(
        "update skills set active = false, updated_at = now() where id = $1 and active = true returning id",
        [input.id],
      );
      if (result.rowCount === 0) return false;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "skill.deactivated",
        objectType: "skill",
        objectId: input.id,
      });
      return true;
    });
  },

  async listRequirements(positionId?: string): Promise<PositionSkillRequirementView[]> {
    const result = await pool.query<PositionSkillRequirementView>(
      `select r.id, r.position_id as "positionId", p.code as "positionCode", p.name as "positionName",
              r.skill_id as "skillId", s.code as "skillCode", s.name as "skillName",
              s.category as "skillCategory", r.required_level as "requiredLevel", r.required
       from position_skill_requirements r
       join positions p on p.id = r.position_id
       join skills s on s.id = r.skill_id
       where ($1::uuid is null or r.position_id = $1)
       order by p.code, s.category, s.code`,
      [positionId ?? null],
    );
    return result.rows;
  },

  async upsertRequirement(input: {
    positionId: string;
    skillId: string;
    requiredLevel: SkillLevel;
    required: boolean;
    actorAccountId: string;
  }): Promise<boolean> {
    return transaction(pool, async (client) => {
      const result = await client.query<{ id: string }>(
        `insert into position_skill_requirements (position_id, skill_id, required_level, required)
         select p.id, s.id, $3, $4 from positions p cross join skills s
         where p.id = $1 and s.id = $2 and p.active = true and s.active = true
         on conflict (position_id, skill_id) do update set
           required_level = excluded.required_level, required = excluded.required, updated_at = now()
         returning id`,
        [input.positionId, input.skillId, input.requiredLevel, input.required],
      );
      const id = result.rows[0]?.id;
      if (!id) return false;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "position_skill_requirement.saved",
        objectType: "position_skill_requirement",
        objectId: id,
        summary: { requiredLevel: input.requiredLevel, required: input.required },
      });
      return true;
    });
  },

  async copyRequirements(input: {
    sourcePositionId: string;
    targetPositionId: string;
    levelDelta: number;
    actorAccountId: string;
  }): Promise<number | undefined> {
    return transaction(pool, async (client) => {
      const targets = await client.query(
        `select 1 from positions where id in ($1, $2) and active = true`,
        [input.sourcePositionId, input.targetPositionId],
      );
      if (targets.rowCount !== 2 || input.sourcePositionId === input.targetPositionId)
        return undefined;
      const result = await client.query(
        `insert into position_skill_requirements (position_id, skill_id, required_level, required)
         select $2, skill_id, greatest(0, least(4, required_level + $3)), required
         from position_skill_requirements where position_id = $1
         on conflict (position_id, skill_id) do update set
           required_level = excluded.required_level, required = excluded.required, updated_at = now()`,
        [input.sourcePositionId, input.targetPositionId, input.levelDelta],
      );
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "position_skill_requirements.copied",
        objectType: "position",
        objectId: input.targetPositionId,
        summary: {
          sourcePositionId: input.sourcePositionId,
          levelDelta: input.levelDelta,
          count: result.rowCount,
        },
      });
      return result.rowCount ?? 0;
    });
  },

  async findBaselineReferences() {
    const [employees, skills, current] = await Promise.all([
      pool.query<{ id: string; employeeNumber: string }>(
        `select id, employee_number as "employeeNumber" from employees where active = true`,
      ),
      pool.query<{
        id: string;
        code: string;
        reassessmentRequired: boolean;
        validityMonths: number | null;
      }>(
        `select id, code, reassessment_required as "reassessmentRequired", validity_months as "validityMonths" from skills where active = true`,
      ),
      pool.query<{ employeeId: string; skillId: string }>(
        `select employee_id as "employeeId", skill_id as "skillId" from employee_current_skills`,
      ),
    ]);
    return { employees: employees.rows, skills: skills.rows, current: current.rows };
  },

  async storeBaselinePreview(input: {
    id: string;
    actorAccountId: string;
    rows: SkillBaselineImportRow[];
    errors: SkillImportError[];
    expiresAt: Date;
  }) {
    await pool.query(
      `insert into skill_import_previews (id, actor_account_id, rows, errors, expires_at) values ($1, $2, $3, $4, $5)`,
      [
        input.id,
        input.actorAccountId,
        JSON.stringify(input.rows),
        JSON.stringify(input.errors),
        input.expiresAt,
      ],
    );
  },

  async loadBaselinePreview(id: string, actorAccountId: string) {
    const result = await pool.query<{
      rows: SkillBaselineImportRow[];
      errors: SkillImportError[];
      expiresAt: Date;
      confirmedAt: Date | null;
    }>(
      `select rows, errors, expires_at as "expiresAt", confirmed_at as "confirmedAt" from skill_import_previews where id = $1 and actor_account_id = $2`,
      [id, actorAccountId],
    );
    return result.rows[0];
  },

  async confirmBaselineImport(input: {
    previewId: string;
    actorAccountId: string;
    rows: SkillBaselineImportRow[];
    now: Date;
  }): Promise<number | undefined> {
    return transaction(pool, async (client) => {
      const claimed = await client.query(
        `update skill_import_previews set confirmed_at = $3 where id = $1 and actor_account_id = $2 and confirmed_at is null and expires_at > $3 returning id`,
        [input.previewId, input.actorAccountId, input.now],
      );
      if (claimed.rowCount === 0) return undefined;
      let count = 0;
      for (const row of input.rows) {
        const reference = await client.query<{
          employeeId: string;
          skillId: string;
          reassessmentRequired: boolean;
          validityMonths: number | null;
        }>(
          `select e.id as "employeeId", s.id as "skillId", s.reassessment_required as "reassessmentRequired", s.validity_months as "validityMonths"
           from employees e cross join skills s where e.employee_number = $1 and s.code = $2 and e.active = true and s.active = true`,
          [row.employeeNumber, row.skillCode],
        );
        const target = reference.rows[0];
        if (!target) throw new Error(`BASELINE_REFERENCE_CHANGED:${row.rowNumber}`);
        const assessedAt = new Date(`${row.assessedAt}T00:00:00.000Z`);
        const validUntil =
          target.reassessmentRequired && target.validityMonths
            ? new Date(
                Date.UTC(
                  assessedAt.getUTCFullYear(),
                  assessedAt.getUTCMonth() + target.validityMonths,
                  assessedAt.getUTCDate(),
                ),
              )
            : null;
        const assessment = await client.query<{ id: string }>(
          `insert into skill_assessments (employee_id, skill_id, level, status, passed, source_type, source_reference, assessed_at, valid_until, archived_at)
           values ($1, $2, $3, 'archived', true, 'baseline_import', $4, $5, $6, $7) returning id`,
          [
            target.employeeId,
            target.skillId,
            row.level,
            row.sourceReference,
            assessedAt,
            validUntil,
            input.now,
          ],
        );
        await client.query(
          `insert into employee_current_skills (employee_id, skill_id, assessment_id)
           values ($1, $2, $3)`,
          [target.employeeId, target.skillId, assessment.rows[0]!.id],
        );
        count += 1;
      }
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "skill_baselines.imported",
        objectType: "skill_import_preview",
        objectId: input.previewId,
        summary: { imported: count },
      });
      return count;
    });
  },

  async listMatrix(input: {
    departmentId?: string;
    employeeId?: string;
    positionId?: string;
    skillId?: string;
    now: Date;
  }): Promise<SkillMatrixCell[]> {
    const result = await pool.query<{
      employeeId: string;
      employeeNumber: string;
      employeeName: string;
      departmentId: string;
      departmentName: string;
      positionId: string;
      positionName: string;
      skillId: string;
      skillCode: string;
      skillName: string;
      requiredLevel: SkillLevel;
      required: boolean;
      currentLevel: SkillLevel | null;
      validUntil: Date | null;
      assessmentId: string | null;
    }>(
      `select e.id as "employeeId", e.employee_number as "employeeNumber", e.display_name as "employeeName",
              d.id as "departmentId", d.name as "departmentName", p.id as "positionId", p.name as "positionName",
              s.id as "skillId", s.code as "skillCode", s.name as "skillName", r.required_level as "requiredLevel", r.required,
              a.level as "currentLevel", a.valid_until as "validUntil", a.id as "assessmentId"
       from employees e
       join departments d on d.id = e.department_id
       join position_assignments pa on pa.employee_id = e.id and pa.ended_at is null
       join positions p on p.id = pa.position_id
       join position_skill_requirements r on r.position_id = p.id
       join skills s on s.id = r.skill_id and s.active = true
       left join employee_current_skills cs on cs.employee_id = e.id and cs.skill_id = s.id
       left join skill_assessments a on a.id = cs.assessment_id and a.status = 'archived' and a.passed = true and a.voided_at is null
       where e.active = true
         and ($1::uuid is null or e.department_id = $1)
         and ($2::uuid is null or e.id = $2)
         and ($3::uuid is null or p.id = $3)
         and ($4::uuid is null or s.id = $4)
       order by e.employee_number, s.code`,
      [
        input.departmentId ?? null,
        input.employeeId ?? null,
        input.positionId ?? null,
        input.skillId ?? null,
      ],
    );
    return result.rows.map((row) => {
      const currentLevel = row.currentLevel ?? undefined;
      const validUntil = row.validUntil?.toISOString();
      return {
        employeeId: row.employeeId,
        employeeNumber: row.employeeNumber,
        employeeName: row.employeeName,
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        positionId: row.positionId,
        positionName: row.positionName,
        skillId: row.skillId,
        skillCode: row.skillCode,
        skillName: row.skillName,
        requiredLevel: row.requiredLevel,
        required: row.required,
        ...(currentLevel !== undefined ? { currentLevel } : {}),
        ...(validUntil ? { validUntil } : {}),
        ...(currentLevel !== undefined
          ? {
              validityStatus: calculateCurrentSkillValidity({
                ...(validUntil ? { validUntil } : {}),
                now: input.now,
              }) as "effective" | "expiring_soon" | "expired",
            }
          : {}),
        ...(row.assessmentId ? { assessmentId: row.assessmentId } : {}),
        ...calculateSkillStatus({
          requiredLevel: row.requiredLevel,
          ...(currentLevel !== undefined ? { currentLevel } : {}),
          ...(validUntil ? { validUntil } : {}),
          now: input.now,
        }),
      };
    });
  },
});

export type SkillRepository = ReturnType<typeof createPostgresSkillRepository>;
