import { Client } from "pg";

// Read-only verification of disposable browser acceptance fixtures; no production URL accepted.
const client = new Client({
  connectionString:
    "postgres://skill_matrix:skill_matrix_dev@localhost:5433/jineng_acceptance_20260918",
});
await client.connect();
try {
  await client.query("begin read only");
  const result =
    await client.query(`select d.id as department_id,d.code as department_code,d.active as department_active,
    p.id as position_id,p.code as position_code,p.active as position_active,
    r.id as requirement_id,r.active as requirement_active,r.required_level,r.required,s.code as skill_code
    from departments d left join positions p on p.department_id=d.id
    left join position_skill_requirements r on r.position_id=p.id left join skills s on s.id=r.skill_id
    where d.code='QAUI03' order by p.code,r.id`);
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        database: "jineng_acceptance_20260918",
        rows: result.rows,
      },
      null,
      2,
    ),
  );
  await client.query("rollback");
} finally {
  await client.end();
}
