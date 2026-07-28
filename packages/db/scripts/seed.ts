import { parseServerConfig } from "@jineng/skill-matrix-config";
import {
  maximumPasswordLength,
  minimumPasswordLength,
  passwordLengthIsValid,
} from "@jineng/skill-matrix-shared";
import { Pool } from "pg";

const initialPassword = process.env.SEED_INITIAL_PASSWORD;
if (!initialPassword || !passwordLengthIsValid(initialPassword)) {
  throw new Error(
    `SEED_INITIAL_PASSWORD 必须显式设置且长度为 ${minimumPasswordLength}–${maximumPasswordLength} 位`,
  );
}

const config = parseServerConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
const client = await pool.connect();

const accounts = [
  ["EMP001", "演示员工", "employee"],
  ["MGR001", "演示主管", "department_manager"],
  ["HR001", "演示 HR", "hr_admin"],
  ["VIEW001", "演示高层", "executive_viewer"],
  ["ADMIN001", "演示管理员", "system_admin"],
] as const;

try {
  await client.query("begin");
  const department = await client.query<{ id: string }>(
    `insert into departments (code, name)
     values ('DEMO', '示范制造工厂')
     on conflict (code) do update set
       name = excluded.name,
       active = true,
       updated_at = now()
     returning id`,
  );

  for (const [employeeNumber, displayName, role] of accounts) {
    const passwordHash = await Bun.password.hash(initialPassword, {
      algorithm: "argon2id",
      memoryCost: 65_536,
      timeCost: 3,
    });
    const employee = await client.query<{ id: string }>(
      `insert into employees (
         employee_number, display_name, department_id
       ) values ($1, $2, $3)
       on conflict (employee_number) do update set
         display_name = excluded.display_name,
         department_id = excluded.department_id,
         active = true,
         updated_at = now()
       returning id`,
      [employeeNumber, displayName, department.rows[0]!.id],
    );
    await client.query(
      `insert into user_accounts (
         employee_id, password_hash, role, must_change_password
       ) values ($1, $2, $3, true)
       on conflict (employee_id) do nothing`,
      [employee.rows[0]!.id, passwordHash, role],
    );
  }

  await client.query("commit");
  console.log(`已准备 ${accounts.length} 个首次改密演示账号`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
