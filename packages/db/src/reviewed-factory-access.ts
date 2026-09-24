import type { Pool } from "pg";

// The requirements identify one person, not a role-wide permission change.
export async function grantReviewedFactoryRead(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ id: string; employeeNumber: string; factoryRead: boolean }>(
      `select a.id,e.employee_number as "employeeNumber",a.factory_read as "factoryRead"
       from user_accounts a join employees e on e.id=a.employee_id
       where e.display_name=$1 and e.employee_number=$2 and a.active=true and e.active=true
       and a.role in ('department_manager','hr_admin','executive_viewer') for update of a,e`,
      ["邓华明", "10032"],
    );
    if (found.rowCount !== 1)
      throw new Error("邓华明（10032）有效管理账号必须唯一；未更改任何权限");
    const account = found.rows[0]!;
    if (!account.factoryRead) {
      await client.query(
        "update user_accounts set factory_read=true,session_version=session_version+1,updated_at=now() where id=$1",
        [account.id],
      );
      await client.query(
        `insert into audit_logs(action,object_type,object_id,summary)
         values ('account.factory_read_granted','user_account',$1,$2)`,
        [
          account.id,
          {
            employeeNumber: account.employeeNumber,
            source: "2026-09-18 requirements",
            scope: "factory_read_only",
          },
        ],
      );
    }
    const verified = await client.query("select factory_read from user_accounts where id=$1", [
      account.id,
    ]);
    if (verified.rows[0]?.factory_read !== true) throw new Error("全厂查看权限读回失败");
    await client.query("commit");
    return {
      employeeNumber: account.employeeNumber,
      factoryRead: true,
      status: account.factoryRead ? "already_granted" : "granted",
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
