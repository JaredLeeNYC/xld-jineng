import { Pool } from "pg";

// Explicit allowlist from the signed-off flow review. Never create or reactivate accounts.
const employeeNumbers = ["0341", "10032", "3761", "4243"];
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await client.query("begin");
  const found = await client.query<{
    id: string;
    employeeNumber: string;
    role: string;
    eligible: boolean;
  }>(
    `select a.id, e.employee_number as "employeeNumber", a.role,
       (a.active and e.active and coalesce(d.active,false)) as eligible
     from user_accounts a join employees e on e.id=a.employee_id
     left join departments d on d.id=e.department_id
     where e.employee_number=any($1::text[]) for update of a,e`,
    [employeeNumbers],
  );
  const results: Array<{ employeeNumber: string; status: string }> = [];
  for (const employeeNumber of employeeNumbers) {
    const account = found.rows.find((row) => row.employeeNumber === employeeNumber);
    if (!account) {
      results.push({ employeeNumber, status: "missing" });
      continue;
    }
    if (!account.eligible) {
      results.push({ employeeNumber, status: "inactive_or_missing_department" });
      continue;
    }
    if (account.role === "department_manager") {
      results.push({ employeeNumber, status: "already_manager" });
      continue;
    }
    if (account.role !== "employee") {
      results.push({ employeeNumber, status: "unexpected_role" });
      continue;
    }
    await client.query(
      "update user_accounts set role='department_manager',session_version=session_version+1,updated_at=now() where id=$1",
      [account.id],
    );
    await client.query(
      `insert into audit_logs(action,object_type,object_id,summary)
      values ('account.role_changed','user_account',$1,$2)`,
      [
        account.id,
        {
          employeeNumber,
          previousRole: account.role,
          role: "department_manager",
          source: "2026-09-08 flow-review",
        },
      ],
    );
    results.push({ employeeNumber, status: "promoted" });
  }
  await client.query("commit");
  console.log(JSON.stringify(results, null, 2));
  if (results.some((row) => !["promoted", "already_manager"].includes(row.status)))
    process.exitCode = 2;
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
