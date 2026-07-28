import type {
  ExpiryMetricFact,
  SkillMatrixCell,
  TrainingTaskMetricFact,
} from "@jineng/skill-matrix-shared";
import type { Pool } from "pg";
import type { SkillRepository } from "./skill-repository";

export type ReportFactFilters = {
  departmentId?: string;
  positionId?: string;
  employeeId?: string;
  skillId?: string;
  dateFrom?: Date;
  dateToExclusive?: Date;
  now: Date;
};

export type ReportFacts = {
  matrix: SkillMatrixCell[];
  trainingTasks: TrainingTaskMetricFact[];
  expiryFacts: ExpiryMetricFact[];
};

export const createPostgresReportRepository = (pool: Pool, skills: SkillRepository) => ({
  async loadFacts(filters: ReportFactFilters): Promise<ReportFacts> {
    const params = [
      filters.departmentId ?? null,
      filters.positionId ?? null,
      filters.employeeId ?? null,
      filters.skillId ?? null,
    ];
    const client = await pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      const matrix = await skills.listMatrix(
        {
          ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
          ...(filters.positionId ? { positionId: filters.positionId } : {}),
          ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
          ...(filters.skillId ? { skillId: filters.skillId } : {}),
          now: filters.now,
        },
        client,
      );
      const training = await client.query<TrainingTaskMetricFact>(
        `select t.status, t.created_at as "assignedAt", t.confirmed_at as "confirmedAt"
         from training_tasks t
         join training_plans pl on pl.id=t.plan_id and pl.published_at is not null
         join employees e on e.id=t.employee_id
         join position_assignments pa on pa.employee_id=e.id and pa.ended_at is null
         where e.active=true
           and ($1::uuid is null or e.department_id=$1)
           and ($2::uuid is null or pa.position_id=$2)
           and ($3::uuid is null or e.id=$3)
           and ($4::uuid is null or exists (
             select 1 from training_material_skills ms where ms.material_id=pl.material_id and ms.skill_id=$4
           ))`,
        params,
      );
      const expiry = await client.query<ExpiryMetricFact>(
        `select e.id as "employeeId", cs.skill_id as "skillId", a.valid_until as "validUntil"
         from employee_current_skills cs
         join employees e on e.id=cs.employee_id and e.active=true
         join position_assignments pa on pa.employee_id=e.id and pa.ended_at is null
         join skill_assessments a on a.id=cs.assessment_id
           and a.status='archived' and a.passed=true and a.voided_at is null and a.valid_until is not null
         where ($1::uuid is null or e.department_id=$1)
           and ($2::uuid is null or pa.position_id=$2)
           and ($3::uuid is null or e.id=$3)
           and ($4::uuid is null or cs.skill_id=$4)`,
        params,
      );
      await client.query("commit");
      return {
        matrix,
        trainingTasks: training.rows.map((row) => ({
          ...row,
          assignedAt: new Date(row.assignedAt).toISOString(),
          ...(row.confirmedAt ? { confirmedAt: new Date(row.confirmedAt).toISOString() } : {}),
        })),
        expiryFacts: expiry.rows.map((row) => ({
          ...row,
          validUntil: new Date(row.validUntil).toISOString(),
        })),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },

  async recordExport(input: { actorAccountId: string; filters: unknown; rowCount: number }) {
    await pool.query(
      `insert into audit_logs (actor_account_id,action,object_type,object_id,summary)
       values ($1,'reports.exported','report_export',gen_random_uuid(),$2)`,
      [input.actorAccountId, { filters: input.filters, rowCount: input.rowCount }],
    );
  },
});

export type ReportRepository = ReturnType<typeof createPostgresReportRepository>;
