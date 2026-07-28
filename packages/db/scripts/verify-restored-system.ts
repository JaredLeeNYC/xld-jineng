import { createFilesystemMaterialStorage } from "../../../apps/server/src/material-storage";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.RESTORE_DATABASE_URL;
const materialDirectory = process.env.RESTORE_MATERIAL_DIR;
const employeeNumber = process.env.RESTORE_EMPLOYEE_NUMBER;
const password = process.env.RESTORE_PASSWORD;
if (!databaseUrl || !materialDirectory || !employeeNumber || !password)
  throw new Error(
    "RESTORE_DATABASE_URL、RESTORE_MATERIAL_DIR、RESTORE_EMPLOYEE_NUMBER、RESTORE_PASSWORD 必须显式设置",
  );

const pool = new Pool({ connectionString: databaseUrl });
try {
  const account = await pool.query<{ passwordHash: string }>(
    `select a.password_hash as "passwordHash" from user_accounts a
     join employees e on e.id=a.employee_id
     where e.employee_number=$1 and e.active=true and a.active=true`,
    [employeeNumber.trim().toUpperCase()],
  );
  if (!account.rows[0] || !(await Bun.password.verify(password, account.rows[0].passwordHash)))
    throw new Error("恢复库登录凭证验证失败");
  const evidence = await pool.query<{ storageKey: string; checksum: string }>(
    `select storage_key::text as "storageKey",checksum from training_evidence
     union all
     select evidence_storage_key::text as "storageKey",evidence_checksum as checksum
       from skill_assessments where evidence_storage_key is not null
     union all
     select storage_key::text as "storageKey",checksum from training_materials where storage_key is not null
     limit 1`,
  );
  const sample = evidence.rows[0];
  if (!sample) throw new Error("恢复库没有可用于下载读回的证据或资料文件");
  const bytes = await createFilesystemMaterialStorage(materialDirectory).get(sample.storageKey);
  if (createHash("sha256").update(bytes).digest("hex") !== sample.checksum)
    throw new Error("恢复附件下载后的 SHA-256 与数据库不一致");
  console.log("恢复系统登录凭证与证据文件下载读回通过");
} finally {
  await pool.end();
}
