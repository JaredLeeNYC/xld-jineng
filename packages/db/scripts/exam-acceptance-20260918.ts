import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { migrationsFolder } from "../src/readiness";
import { createPostgresAssessmentRepository } from "../src/assessment-repository";
import { createPostgresTrainingExamRepository } from "../src/training-exam-repository";
import { createAssessmentService } from "../../../apps/server/src/assessment-service";
import { createTrainingExamService } from "../../../apps/server/src/training-exam-service";
import { createMemoryMaterialStorage } from "../../../apps/server/src/material-storage";
import { createApp } from "../../../apps/server/src/app";
import type { SessionView, AuthHttpService } from "../../../apps/server/src/auth-contract";

const adminUrl =
  process.env.POSTGRES_CONTRACT_ADMIN_URL ??
  "postgres://skill_matrix:skill_matrix_dev@localhost:5433/postgres";
const admin = new Client({ connectionString: adminUrl });
const database = `skill_matrix_exam_qa_${process.pid}_${Date.now()}`;
let pool: Pool | undefined;
const evidence: Array<{ name: string; passed: boolean }> = [];
function check(name: string, condition: unknown) {
  assert.ok(condition, name);
  evidence.push({ name, passed: true });
}
await admin.connect();
try {
  await admin.query(`create database "${database}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString() });
  await migrate(drizzle(pool), { migrationsFolder });
  const dept1 = randomUUID(),
    dept2 = randomUUID(),
    skill = randomUUID(),
    otherSkill = randomUUID();
  await pool.query(
    "insert into departments(id,code,name) values($1,'QA1','甲部门'),($2,'QA2','乙部门')",
    [dept1, dept2],
  );
  await pool.query(
    "insert into skills(id,code,name,category) values($1,'QA1','技能一','general'),($2,'QA2','技能二','general')",
    [skill, otherSkill],
  );
  const actors: Record<string, SessionView> = {};
  for (const [key, role, departmentId] of [
    ["hr", "hr_admin", dept1],
    ["hr2", "hr_admin", dept1],
    ["mgr", "department_manager", dept1],
    ["otherMgr", "department_manager", dept2],
    ["emp", "employee", dept1],
    ["otherEmp", "employee", dept2],
  ] as const) {
    const employeeId = randomUUID(),
      accountId = randomUUID();
    await pool.query(
      "insert into employees(id,employee_number,display_name,department_id) values($1,$2,$3,$4)",
      [employeeId, key.toUpperCase(), key, departmentId],
    );
    await pool.query(
      "insert into user_accounts(id,employee_id,password_hash,role,must_change_password) values($1,$2,'qa-not-used',$3,false)",
      [accountId, employeeId, role],
    );
    actors[key] = {
      accountId,
      employeeId,
      employeeNumber: key.toUpperCase(),
      displayName: key,
      role,
      departmentId,
      mustChangePassword: false,
    };
  }
  const material = randomUUID(),
    plan = randomUUID();
  await pool.query(
    "insert into training_materials(id,title,category,kind,external_url,created_by_account_id) values($1,'QA资料','技能培训','link','https://example.com',$2)",
    [material, actors.hr!.accountId],
  );
  await pool.query("insert into training_material_skills(material_id,skill_id) values($1,$2)", [
    material,
    skill,
  ]);
  await pool.query(
    "insert into training_plans(id,title,status,material_id,material_ids,owner_employee_id,owner_employee_ids,start_at,due_at,location,scope_type,created_by_account_id) values($1,'QA计划','published',$2,$3,$4,$5,'2026-09-01','2026-09-30','工厂','employees',$6)",
    [
      plan,
      material,
      [material],
      actors.mgr!.employeeId,
      [actors.mgr!.employeeId],
      actors.hr!.accountId,
    ],
  );
  for (const person of [actors.emp!, actors.otherEmp!])
    await pool.query(
      "insert into training_tasks(plan_id,employee_id,status) values($1,$2,'assigned')",
      [plan, person.employeeId],
    );
  const now = () => new Date("2026-09-18T06:00:00Z");
  const assessmentService = createAssessmentService({
    repository: createPostgresAssessmentRepository(pool),
    storage: createMemoryMaterialStorage(),
    idSource: randomUUID,
    now,
  });
  const trainingExamService = createTrainingExamService({
    repository: createPostgresTrainingExamRepository(pool),
    now,
  });
  const authService = {
    getSession: async (token: string) =>
      actors[token]
        ? { ok: true, data: actors[token] }
        : { ok: false, error: { code: "UNAUTHORIZED", message: "未登录", status: 401 } },
  } as unknown as AuthHttpService;
  const app = createApp({ assessmentService, trainingExamService, authService });
  async function http(actor: string, path: string, body?: unknown, method = "POST") {
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method: body === undefined && method === "POST" ? "GET" : method,
        headers: { cookie: `skill_matrix_session=${actor}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, ...(await response.json()) };
  }
  const examInput = {
    planId: plan,
    employeeId: actors.emp!.employeeId,
    skillId: skill,
    method: "written_practical" as const,
    score: 82.5,
    passed: true,
    completedAt: "2026-09-10T08:00:00Z",
  };
  const created = await http("mgr", "/api/training-exams", examInput);
  check("HTTP考核创建与真实SQL持久化", created.ok && created.status === 200);
  const stored = (
    await pool.query("select score,completed_at from training_exams where id=$1", [created.data.id])
  ).rows[0];
  check(
    "考核成绩精度和中国时间UTC往返",
    Number(stored.score) === 82.5 &&
      stored.completed_at.toISOString() === examInput.completedAt.replace("Z", ".000Z"),
  );
  check("主管跨部门录入拒绝", !(await http("otherMgr", "/api/training-exams", examInput)).ok);
  check("员工伪造录入拒绝", (await http("emp", "/api/training-exams", examInput)).status === 403);
  check(
    "未来考核时间拒绝",
    !(
      await http("mgr", "/api/training-exams", {
        ...examInput,
        completedAt: "2026-10-01T00:00:00Z",
      })
    ).ok,
  );
  check(
    "计划非关联技能拒绝",
    !(await http("mgr", "/api/training-exams", { ...examInput, skillId: otherSkill })).ok,
  );
  const own = await http("emp", "/api/training-exams"),
    others = await http("otherEmp", "/api/training-exams");
  check("员工仅本人考核档案", own.data.length === 1 && others.data.length === 0);
  const base = {
    employeeId: actors.emp!.employeeId,
    skillId: skill,
    method: "written" as const,
    level: 2,
    passed: true,
    assessedAt: "2026-09-11T08:00:00Z",
  };
  const assessmentForm = new FormData();
  for (const [key, value] of Object.entries(base)) assessmentForm.set(key, String(value));
  const assessmentResponse = await app.handle(
    new Request("http://localhost/api/assessments", {
      method: "POST",
      headers: { cookie: "skill_matrix_session=mgr" },
      body: assessmentForm,
    }),
  );
  const a = await assessmentResponse.json();
  check("HTTP无证据multipart评定创建", assessmentResponse.status === 200 && a.ok);
  check("无证据保存直接待HR归档", a.ok && a.data.status === "pending_hr");
  if (!a.ok) throw new Error("create failed");
  let persisted = (
    await pool.query("select status,score,training_exam_id from skill_assessments where id=$1", [
      a.data.id,
    ])
  ).rows[0];
  check(
    "自动关联最近考核和分数",
    persisted.training_exam_id === created.data.id && Number(persisted.score) === 82.5,
  );
  check(
    "待归档不生成有效技能",
    (
      await pool.query("select 1 from employee_current_skills where employee_id=$1", [
        actors.emp!.employeeId,
      ])
    ).rowCount === 0,
  );
  check("普通主管不可归档", !(await assessmentService.archive(actors.mgr!, a.data.id)).ok);
  check("独立HR无证据归档成功", (await assessmentService.archive(actors.hr!, a.data.id)).ok);
  check(
    "HR归档产生有效技能",
    (await pool.query("select 1 from employee_current_skills where assessment_id=$1", [a.data.id]))
      .rowCount === 1,
  );
  check("新L0评定拒绝", !(await assessmentService.create(actors.mgr!, { ...base, level: 0 })).ok);
  const returnedNew = await assessmentService.create(actors.mgr!, base);
  if (!returnedNew.ok) throw new Error("return regression setup failed");
  await assessmentService.returnAssessment(actors.hr!, returnedNew.data.id, "等级待修订");
  check(
    "新评定退回后不能改为L0",
    !(await assessmentService.update(actors.mgr!, returnedNew.data.id, { ...base, level: 0 })).ok,
  );
  check(
    "拒绝L0后保留原等级",
    (await pool.query("select level from skill_assessments where id=$1", [returnedNew.data.id]))
      .rows[0].level === 2,
  );
  const legacyZero = randomUUID();
  await pool.query(
    "insert into skill_assessments(id,employee_id,skill_id,level,status,passed,method,assessor_account_id,source_type,source_reference,assessed_at) values($1,$2,$3,0,'draft',false,'written',$4,'manual_assessment','历史L0回归','2026-09-12')",
    [legacyZero, actors.emp!.employeeId, skill, actors.mgr!.accountId],
  );
  check(
    "历史L0保持原值可修订",
    (
      await assessmentService.update(actors.mgr!, legacyZero, {
        ...base,
        level: 0,
        passed: false,
        reason: "历史记录补充",
      })
    ).ok,
  );
  const manual = await assessmentService.create(actors.hr!, {
    ...base,
    score: 91,
    trainingExamId: created.data.id,
  });
  if (!manual.ok) throw new Error("manual create failed");
  check(
    "手工覆盖成绩保留关联",
    Number(
      (await pool.query("select score from skill_assessments where id=$1", [manual.data.id]))
        .rows[0].score,
    ) === 91,
  );
  check("HR新评定不可自归档", !(await assessmentService.archive(actors.hr!, manual.data.id)).ok);
  check("另一HR独立归档成功", (await assessmentService.archive(actors.hr2!, manual.data.id)).ok);
  check(
    "员工不能读取他人评定",
    (await assessmentService.list(actors.otherEmp!)).ok &&
      (
        await createPostgresAssessmentRepository(pool).list({
          ...actors.otherEmp!,
          role: "employee",
        })
      ).length === 0,
  );
  check("主管跨部门评定拒绝", !(await assessmentService.create(actors.otherMgr!, base)).ok);
  check(
    "异员工考核关联拒绝",
    !(
      await assessmentService.create(actors.hr!, {
        ...base,
        employeeId: actors.otherEmp!.employeeId,
        trainingExamId: created.data.id,
      })
    ).ok,
  );
  check(
    "晚于评定日期考核关联拒绝",
    !(
      await assessmentService.create(actors.hr!, {
        ...base,
        assessedAt: "2026-09-09T08:00:00Z",
        trainingExamId: created.data.id,
      })
    ).ok,
  );
  // Seed a legacy draft through its supported old state, then test the existing manager-confirm route.
  const legacy = randomUUID();
  await pool.query(
    "insert into skill_assessments(id,employee_id,skill_id,level,status,passed,method,assessor_account_id,source_type,source_reference,assessed_at) values($1,$2,$3,2,'draft',true,'written',$4,'manual_assessment','旧流程测试','2026-09-12')",
    [legacy, actors.emp!.employeeId, skill, actors.hr!.accountId],
  );
  await pool.query("update skill_assessments set status='pending_manager' where id=$1", [legacy]);
  check(
    "旧待主管确认记录仍可流转",
    (await assessmentService.managerConfirm(actors.mgr!, legacy)).ok,
  );
  await assessmentService.returnAssessment(actors.hr!, legacy, "修订分数");
  check(
    "旧退回记录修订成功",
    (await assessmentService.update(actors.hr!, legacy, { ...base, score: 95 })).ok,
  );
  check("修订清除旧独立复核防自归档", !(await assessmentService.archive(actors.hr!, legacy)).ok);
  check("修订后其他HR可归档", (await assessmentService.archive(actors.hr2!, legacy)).ok);
  const declined = await assessmentService.create(actors.mgr!, {
    ...base,
    passed: false,
    level: 1,
    assessedAt: "2026-09-15T00:00:00Z",
  });
  if (!declined.ok) throw new Error("declined create failed");
  await assessmentService.archive(actors.hr!, declined.data.id);
  check(
    "不通过评定归档不升级技能",
    (
      await pool.query("select 1 from employee_current_skills where assessment_id=$1", [
        declined.data.id,
      ])
    ).rowCount === 0,
  );
  await pool.query("update training_material_skills set active=false where material_id=$1", [
    material,
  ]);
  check(
    "未绑定技能的课程允许考核选择有效技能",
    (await http("mgr", "/api/training-exams", { ...examInput, skillId: otherSkill })).ok,
  );
  console.log(JSON.stringify({ database, checks: evidence }, null, 2));
} finally {
  if (pool) await pool.end();
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [
    database,
  ]);
  await admin.query(`drop database if exists "${database}"`);
  await admin.end();
}
