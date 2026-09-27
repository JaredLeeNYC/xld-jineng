import { strict as assert } from "node:assert";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  migrationsFolder,
  createPostgresOrganizationRepository,
  createPostgresSkillRepository,
} from "../src";
const adminUrl =
  process.env.POSTGRES_CONTRACT_ADMIN_URL ??
  "postgres://skill_matrix:skill_matrix_dev@localhost:5433/postgres";
const databaseName = `skill_matrix_area_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: adminUrl });
let pool: Pool | undefined;
try {
  await admin.query(`create database "${databaseName}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  pool = new Pool({ connectionString: url.toString() });
  await migrate(drizzle(pool), { migrationsFolder });
  const d1 = (
    await pool.query(`insert into departments(code,name) values ('A','部门A') returning id`)
  ).rows[0].id;
  const d2 = (
    await pool.query(`insert into departments(code,name) values ('B','部门B') returning id`)
  ).rows[0].id;
  const p1 = (
    await pool.query(
      `insert into positions(code,name,department_id) values ('P1','岗位A',$1) returning id`,
      [d1],
    )
  ).rows[0].id;
  const p2 = (
    await pool.query(
      `insert into positions(code,name,department_id) values ('P2','岗位B',$1) returning id`,
      [d2],
    )
  ).rows[0].id;
  const e1 = (
    await pool.query(
      `insert into employees(employee_number,display_name,department_id) values ('E1','员工A',$1) returning id`,
      [d1],
    )
  ).rows[0].id;
  const e2 = (
    await pool.query(
      `insert into employees(employee_number,display_name,department_id) values ('E2','员工B',$1) returning id`,
      [d1],
    )
  ).rows[0].id;
  const actor = (
    await pool.query(
      `insert into user_accounts(employee_id,password_hash,role) values ($1,'hash','hr_admin') returning id`,
      [e1],
    )
  ).rows[0].id;
  await pool.query(
    `insert into user_accounts(employee_id,password_hash,role) values ($1,'hash','employee')`,
    [e2],
  );
  await pool.query(
    `insert into position_assignments(employee_id,department_id,position_id,started_at,reason) values ($1,$2,$3,'2026-01-01','初始'),($4,$2,$3,'2026-01-01','初始')`,
    [e1, d1, p1, e2],
  );
  const sk = (
    await pool.query(
      `insert into skills(code,name,category) values ('S1','技能','general') returning id`,
    )
  ).rows[0].id;
  await pool.query(
    `insert into position_skill_requirements(position_id,skill_id,required_level) values ($1,$2,2)`,
    [p1, sk],
  );
  const repo = createPostgresOrganizationRepository(pool);
  const skills = createPostgresSkillRepository(pool);
  const a = await repo.createArea({ name: "区域A", departmentId: d1, actorAccountId: actor });
  const b = await repo.createArea({ name: "区域B", departmentId: d2, actorAccountId: actor });
  assert(a && b);
  assert.equal(
    await repo.setEmployeeArea({ employeeId: e1, areaId: b.id, actorAccountId: actor }),
    false,
  );
  assert.equal(
    await repo.setEmployeeArea({ employeeId: e1, areaId: a.id, actorAccountId: actor }),
    true,
  );
  assert.equal((await repo.listEmployees({ employeeId: e1 }))[0]?.areaName, "区域A");
  const matrix = await skills.listMatrix({ areaId: a.id, now: new Date() });
  assert.equal(matrix.length, 1);
  assert.equal(matrix[0]?.employeeId, e1);
  assert.equal(matrix[0]?.areaId, a.id);
  assert.equal((await skills.listMatrix({ areaId: b.id, now: new Date() })).length, 0);
  await repo.deactivateArea({ id: a.id, actorAccountId: actor });
  assert.equal(
    await repo.setEmployeeArea({ employeeId: e2, areaId: a.id, actorAccountId: actor }),
    false,
  );
  assert.equal((await skills.listMatrix({ areaId: a.id, now: new Date() })).length, 1);
  assert.equal(
    (await repo.listAreas()).some((row) => row.id === a.id),
    false,
  );
  assert.equal(
    await repo.changeAssignment({
      employeeId: e1,
      departmentId: d2,
      positionId: p2,
      reason: "调部门",
      effectiveAt: new Date("2026-02-01"),
      actorAccountId: actor,
    }),
    true,
  );
  assert.equal((await repo.listEmployees({ employeeId: e1 }))[0]?.areaId, undefined);
  assert.equal(
    await repo.setEmployeeArea({ employeeId: e1, areaId: b.id, actorAccountId: actor }),
    true,
  );
  assert.equal(
    await repo.setEmployeeArea({ employeeId: e1, areaId: null, actorAccountId: actor }),
    true,
  );
  assert.equal((await pool.query(`select count(*)::int as total from areas`)).rows[0].total, 2);
  console.log(
    "区域 PostgreSQL 验收通过：跨部门拒绝、正确归属、矩阵筛选、停用保留、调部门清空、显式清空。",
  );
} finally {
  await pool?.end();
  await admin.query(`drop database if exists "${databaseName}"`);
  await admin.end();
}
