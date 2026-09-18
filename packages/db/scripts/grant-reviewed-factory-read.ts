import { Pool } from "pg";
import { grantReviewedFactoryRead } from "../src/reviewed-factory-access";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  console.log(JSON.stringify(await grantReviewedFactoryRead(pool)));
} finally {
  await pool.end();
}
