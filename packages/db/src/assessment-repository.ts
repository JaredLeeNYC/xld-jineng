import type {
  AssessmentMethod,
  SkillAssessmentView,
  SkillLevel,
} from "@jineng/skill-matrix-shared";
import type { Pool, PoolClient } from "pg";
import { emitInAppNotification, enqueueManagementWebhook } from "./notification-repository";

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

const audit = (
  client: PoolClient,
  actorAccountId: string,
  action: string,
  id: string,
  summary: unknown = {},
) =>
  client.query(
    "insert into audit_logs (actor_account_id,action,object_type,object_id,summary) values ($1,$2,'skill_assessment',$3,$4)",
    [actorAccountId, action, id, summary],
  );

export type AssessmentActor = {
  accountId: string;
  employeeId: string;
  role: "employee" | "department_manager" | "hr_admin" | "executive_viewer";
  departmentId?: string;
};

type Evidence = {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
};

type AssessmentInput = {
  employeeId: string;
  skillId: string;
  method: AssessmentMethod;
  level: SkillLevel;
  passed: boolean;
  reason?: string;
  remediation?: string;
  assessedAt: Date;
  replacesAssessmentId?: string;
  evidence: Evidence;
};

const selectAssessment = `select a.id,a.employee_id as "employeeId",e.employee_number as "employeeNumber",
 e.display_name as "employeeName",e.department_id as "departmentId",d.name as "departmentName",
 a.skill_id as "skillId",s.code as "skillCode",s.name as "skillName",
 assessor.employee_id as "assessorEmployeeId",assessor_employee.display_name as "assessorName",
 a.method,a.level,a.passed,a.reason,a.remediation,a.assessed_at as "assessedAt",a.valid_until as "validUntil",
 a.status,a.return_reason as "returnReason",a.void_reason as "voidReason",
 a.evidence_original_filename as "evidenceFilename",a.evidence_mime_type as "evidenceMimeType",
 a.evidence_size_bytes as "evidenceSizeBytes",a.replaces_assessment_id as "replacesAssessmentId",
 a.archived_at as "archivedAt",a.created_at as "createdAt"
 from skill_assessments a join employees e on e.id=a.employee_id join departments d on d.id=e.department_id
 join skills s on s.id=a.skill_id left join user_accounts assessor on assessor.id=a.assessor_account_id
 left join employees assessor_employee on assessor_employee.id=assessor.employee_id`;

const normalize = (row: any): SkillAssessmentView => ({
  id: row.id,
  employeeId: row.employeeId,
  employeeNumber: row.employeeNumber,
  employeeName: row.employeeName,
  departmentId: row.departmentId,
  departmentName: row.departmentName,
  skillId: row.skillId,
  skillCode: row.skillCode,
  skillName: row.skillName,
  ...(row.assessorEmployeeId ? { assessorEmployeeId: row.assessorEmployeeId } : {}),
  ...(row.assessorName ? { assessorName: row.assessorName } : {}),
  ...(row.method ? { method: row.method } : {}),
  level: row.level,
  passed: row.passed,
  ...(row.reason ? { reason: row.reason } : {}),
  ...(row.remediation ? { remediation: row.remediation } : {}),
  assessedAt: new Date(row.assessedAt).toISOString(),
  ...(row.validUntil ? { validUntil: new Date(row.validUntil).toISOString() } : {}),
  status: row.status,
  ...(row.returnReason ? { returnReason: row.returnReason } : {}),
  ...(row.voidReason ? { voidReason: row.voidReason } : {}),
  ...(row.evidenceFilename
    ? {
        evidence: {
          filename: row.evidenceFilename,
          mimeType: row.evidenceMimeType,
          sizeBytes: row.evidenceSizeBytes,
        },
      }
    : {}),
  ...(row.replacesAssessmentId ? { replacesAssessmentId: row.replacesAssessmentId } : {}),
  ...(row.archivedAt ? { archivedAt: new Date(row.archivedAt).toISOString() } : {}),
  createdAt: new Date(row.createdAt).toISOString(),
});

export const createPostgresAssessmentRepository = (pool: Pool) => ({
  async list(actor: AssessmentActor): Promise<SkillAssessmentView[]> {
    const result = await pool.query(
      `${selectAssessment}
       where ($1='hr_admin' or $1='executive_viewer'
         or ($1='department_manager' and e.department_id=$2::uuid)
         or ($1='employee' and e.id=$3::uuid))
       order by a.created_at desc`,
      [actor.role, actor.departmentId ?? null, actor.employeeId],
    );
    return result.rows.map(normalize);
  },

  async create(actor: AssessmentActor, input: AssessmentInput): Promise<string | undefined> {
    return transaction(pool, async (client) => {
      const target = await client.query<{
        reassessmentRequired: boolean;
        validityMonths: number | null;
      }>(
        `select s.reassessment_required as "reassessmentRequired",s.validity_months as "validityMonths"
         from employees e join skills s on s.id=$2 and s.active=true
         where e.id=$1 and e.active=true
           and ($3='hr_admin' or ($3='department_manager' and e.department_id=$4::uuid))`,
        [input.employeeId, input.skillId, actor.role, actor.departmentId ?? null],
      );
      if (!target.rows[0]) return undefined;
      if (input.replacesAssessmentId) {
        const replaced = await client.query(
          "select 1 from skill_assessments where id=$1 and employee_id=$2 and skill_id=$3 and status='voided'",
          [input.replacesAssessmentId, input.employeeId, input.skillId],
        );
        if (!replaced.rowCount) return undefined;
      }
      const result = await client.query<{ id: string }>(
        `insert into skill_assessments
          (employee_id,skill_id,level,status,passed,method,assessor_account_id,reason,remediation,
           source_type,source_reference,assessed_at,evidence_storage_key,evidence_original_filename,
           evidence_mime_type,evidence_size_bytes,evidence_checksum,replaces_assessment_id)
         values ($1,$2,$3,'draft',$4,$5,$6,$7,$8,'manual_assessment','线下评定',$9,$10,$11,$12,$13,$14,$15)
         returning id`,
        [
          input.employeeId,
          input.skillId,
          input.level,
          input.passed,
          input.method,
          actor.accountId,
          input.reason ?? null,
          input.remediation ?? null,
          input.assessedAt,
          input.evidence.storageKey,
          input.evidence.originalFilename,
          input.evidence.mimeType,
          input.evidence.sizeBytes,
          input.evidence.checksum,
          input.replacesAssessmentId ?? null,
        ],
      );
      await audit(client, actor.accountId, "skill_assessment.created", result.rows[0]!.id);
      return result.rows[0]!.id;
    });
  },

  async update(actor: AssessmentActor, id: string, input: Omit<AssessmentInput, "evidence">) {
    return transaction(pool, async (client) => {
      const result = await client.query(
        `update skill_assessments a set level=$3,passed=$4,method=$5,reason=$6,remediation=$7,
           assessed_at=$8,status='draft',return_reason=null,returned_by_account_id=null,updated_at=now()
         from employees e where a.id=$1 and e.id=a.employee_id and a.assessor_account_id=$2
           and a.status in ('draft','returned')
           and ($9='hr_admin' or ($9='department_manager' and e.department_id=$10::uuid))
         returning a.id`,
        [
          id,
          actor.accountId,
          input.level,
          input.passed,
          input.method,
          input.reason ?? null,
          input.remediation ?? null,
          input.assessedAt,
          actor.role,
          actor.departmentId ?? null,
        ],
      );
      if (!result.rowCount) return false;
      await audit(client, actor.accountId, "skill_assessment.updated", id);
      return true;
    });
  },

  async submit(actor: AssessmentActor, id: string) {
    return transaction(pool, async (client) => {
      const result = await client.query<{
        status: "pending_manager" | "pending_hr";
        transitionedAt: Date;
      }>(
        `update skill_assessments a
         set status=case when assessor.role='department_manager' then 'pending_hr' else 'pending_manager' end,
           updated_at=now()
         from user_accounts assessor
         where a.id=$1 and a.assessor_account_id=$2 and assessor.id=$2
           and assessor.role in ('department_manager','hr_admin')
           and a.status in ('draft','returned')
           and a.method is not null and a.evidence_storage_key is not null
         returning a.status,a.updated_at as "transitionedAt"`,
        [id, actor.accountId],
      );
      const transitioned = result.rows[0];
      if (!transitioned) return undefined;
      await audit(client, actor.accountId, "skill_assessment.submitted", id, {
        status: transitioned.status,
      });
      const awaitingHr = transitioned.status === "pending_hr";
      await enqueueManagementWebhook(client, {
        eventKey: `${awaitingHr ? "assessment_pending_hr" : "assessment_pending_manager"}:${id}:${transitioned.transitionedAt.toISOString()}`,
        eventType: awaitingHr ? "assessment_pending_hr" : "assessment_pending_manager",
        title: awaitingHr ? "技能评定待 HR 归档" : "技能评定待主管确认",
        message: awaitingHr
          ? "主管已完成技能评定，请 HR 复核归档"
          : "有新的技能评定等待部门主管确认",
      });
      return transitioned.status;
    });
  },

  async managerConfirm(actor: AssessmentActor, id: string, now: Date) {
    return transaction(pool, async (client) => {
      const result = await client.query<{ transitionedAt: Date }>(
        `update skill_assessments a set status='pending_hr',manager_confirmed_by_account_id=$2,
           manager_confirmed_at=$3,updated_at=now() from employees e
         where a.id=$1 and e.id=a.employee_id and a.status='pending_manager'
           and e.department_id=$4::uuid and a.assessor_account_id<>$2
         returning a.updated_at as "transitionedAt"`,
        [id, actor.accountId, now, actor.departmentId ?? null],
      );
      if (!result.rowCount) return false;
      await audit(client, actor.accountId, "skill_assessment.manager_confirmed", id);
      await enqueueManagementWebhook(client, {
        eventKey: `assessment_pending_hr:${id}:${result.rows[0]!.transitionedAt.toISOString()}`,
        eventType: "assessment_pending_hr",
        title: "技能评定待 HR 归档",
        message: "主管已确认技能评定，请 HR 归档",
      });
      return true;
    });
  },

  async returnAssessment(actor: AssessmentActor, id: string, reason: string) {
    return transaction(pool, async (client) => {
      const expected = actor.role === "department_manager" ? "pending_manager" : "pending_hr";
      const result = await client.query<{ employeeId: string; returnedAt: Date }>(
        `update skill_assessments a set status='returned',returned_by_account_id=$2,return_reason=$3,
           updated_at=now() from employees e where a.id=$1 and e.id=a.employee_id and a.status=$4
           and ($5='hr_admin' or ($5='department_manager' and e.department_id=$6::uuid))
         returning a.employee_id as "employeeId",a.updated_at as "returnedAt"`,
        [id, actor.accountId, reason, expected, actor.role, actor.departmentId ?? null],
      );
      if (!result.rowCount) return false;
      await audit(client, actor.accountId, "skill_assessment.returned", id, { reason });
      await emitInAppNotification(client, {
        employeeId: result.rows[0]!.employeeId,
        eventKey: `assessment_returned:${id}:${result.rows[0]!.returnedAt.toISOString()}`,
        type: "assessment_returned",
        title: "技能评定已退回",
        message: `评定已退回：${reason}`.slice(0, 500),
        entityType: "skill_assessment",
        entityId: id,
      });
      return true;
    });
  },

  async archive(actor: AssessmentActor, id: string, now: Date) {
    return transaction(pool, async (client) => {
      const assessment = await client.query<{
        employeeId: string;
        skillId: string;
        assessedAt: Date;
        passed: boolean;
        reassessmentRequired: boolean;
        validityMonths: number | null;
      }>(
        `select a.employee_id as "employeeId",a.skill_id as "skillId",a.assessed_at as "assessedAt",a.passed,
           s.reassessment_required as "reassessmentRequired",s.validity_months as "validityMonths"
         from skill_assessments a join skills s on s.id=a.skill_id
         where a.id=$1 and a.status='pending_hr'
           and (a.assessor_account_id<>$2 or
             (a.manager_confirmed_by_account_id is not null
               and a.manager_confirmed_by_account_id<>a.assessor_account_id))
         for update of a`,
        [id, actor.accountId],
      );
      const row = assessment.rows[0];
      if (!row) return false;
      await client.query("select 1 from employees where id=$1 for update", [row.employeeId]);
      const validUntil =
        row.reassessmentRequired && row.validityMonths
          ? new Date(
              Date.UTC(
                row.assessedAt.getUTCFullYear(),
                row.assessedAt.getUTCMonth() + row.validityMonths,
                row.assessedAt.getUTCDate(),
              ),
            )
          : null;
      await client.query(
        `update skill_assessments set status='archived',archived_by_account_id=$2,archived_at=$3,
           valid_until=$4,updated_at=now() where id=$1`,
        [id, actor.accountId, now, validUntil],
      );
      if (row.passed) {
        const current = await client.query<{ assessedAt: Date }>(
          `select a.assessed_at as "assessedAt" from employee_current_skills cs
           join skill_assessments a on a.id=cs.assessment_id
           where cs.employee_id=$1 and cs.skill_id=$2 for update of cs`,
          [row.employeeId, row.skillId],
        );
        if (!current.rows[0] || current.rows[0].assessedAt <= row.assessedAt) {
          await client.query(
            `insert into employee_current_skills (employee_id,skill_id,assessment_id)
             values ($1,$2,$3) on conflict (employee_id,skill_id)
             do update set assessment_id=excluded.assessment_id,updated_at=now()`,
            [row.employeeId, row.skillId, id],
          );
        }
      }
      await audit(client, actor.accountId, "skill_assessment.archived", id, {
        passed: row.passed,
      });
      await emitInAppNotification(client, {
        employeeId: row.employeeId,
        eventKey: `assessment_archived:${id}`,
        type: "assessment_archived",
        title: "技能评定结果已归档",
        message: row.passed ? "技能评定已通过并更新技能档案" : "技能评定未通过，请查看整改建议",
        entityType: "skill_assessment",
        entityId: id,
      });
      return true;
    });
  },

  async voidAssessment(actor: AssessmentActor, id: string, reason: string, now: Date) {
    return transaction(pool, async (client) => {
      const claimed = await client.query<{ employeeId: string; skillId: string }>(
        `select employee_id as "employeeId",skill_id as "skillId"
         from skill_assessments where id=$1 and status='archived' for update`,
        [id],
      );
      const target = claimed.rows[0];
      if (!target) return false;
      const removedCurrent = await client.query(
        "delete from employee_current_skills where assessment_id=$1 returning id",
        [id],
      );
      await client.query(
        `update skill_assessments set status='voided',voided_by_account_id=$2,void_reason=$3,
         voided_at=$4,updated_at=now() where id=$1`,
        [id, actor.accountId, reason, now],
      );
      if (removedCurrent.rowCount) {
        const previous = await client.query<{ id: string }>(
          `select a.id from skill_assessments a
           where a.employee_id=$1 and a.skill_id=$2 and a.status='archived' and a.passed=true
             and a.voided_at is null and a.id<>$3
           order by a.assessed_at desc,a.archived_at desc limit 1`,
          [target.employeeId, target.skillId, id],
        );
        if (previous.rows[0]) {
          await client.query(
            `insert into employee_current_skills (employee_id,skill_id,assessment_id)
             values ($1,$2,$3)`,
            [target.employeeId, target.skillId, previous.rows[0].id],
          );
        }
      }
      await audit(client, actor.accountId, "skill_assessment.voided", id, { reason });
      return true;
    });
  },

  async evidence(actor: AssessmentActor, id: string) {
    const result = await pool.query<{
      storageKey: string;
      originalFilename: string;
      mimeType: string;
      checksum: string;
    }>(
      `select a.evidence_storage_key as "storageKey",a.evidence_original_filename as "originalFilename",
         a.evidence_mime_type as "mimeType",a.evidence_checksum as checksum
       from skill_assessments a join employees e on e.id=a.employee_id
       where a.id=$1 and a.evidence_storage_key is not null
         and ($2='hr_admin' or $2='executive_viewer'
           or ($2='department_manager' and e.department_id=$3::uuid)
           or ($2='employee' and e.id=$4::uuid))`,
      [id, actor.role, actor.departmentId ?? null, actor.employeeId],
    );
    return result.rows[0];
  },
});

export type AssessmentRepository = ReturnType<typeof createPostgresAssessmentRepository>;
