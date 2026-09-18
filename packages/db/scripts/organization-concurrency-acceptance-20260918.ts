import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { Client, Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migrationsFolder } from "../src/readiness";
import { createPostgresOrganizationRepository } from "../src/organization-repository";

const adminUrl =
  process.env.POSTGRES_CONTRACT_ADMIN_URL ??
  "postgres://skill_matrix:skill_matrix_dev@localhost:5433/postgres";
const database = `skill_matrix_org_race_${process.pid}_${Date.now()}`;
const admin = new Client({ connectionString: adminUrl });
const pools: Pool[] = [];
const results: string[] = [];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

// Pause only after PostgreSQL has acquired the real row lock. All SQL and
// transaction boundaries still execute through the production repository.
function gatedRepository(client: PoolClient, pattern: string) {
  const reached = deferred();
  const release = deferred();
  let intercepted = false;
  const proxy = new Proxy(client, {
    get(target, property) {
      if (property === "release") return () => undefined;
      if (property === "query")
        return async (sql: string, parameters?: unknown[]) => {
          const result = await target.query(sql, parameters);
          if (!intercepted && sql.includes(pattern)) {
            intercepted = true;
            reached.resolve();
            await release.promise;
          }
          return result;
        };
      return Reflect.get(target, property);
    },
  });
  const repository = createPostgresOrganizationRepository({ connect: async () => proxy } as Pool);
  return { repository, reached: reached.promise, release: release.resolve };
}

await admin.connect();
try {
  await admin.query(`create database "${database}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  const makePool = (name: string) => {
    const pool = new Pool({
      connectionString: url.toString(),
      application_name: name,
      statement_timeout: 15000,
    });
    pools.push(pool);
    return pool;
  };
  const observer = makePool("org_race_observer");
  await migrate(drizzle(observer), { migrationsFolder });
  const deptA = randomUUID(),
    deptB = randomUUID(),
    actorEmployee = randomUUID(),
    actorAccount = randomUUID();
  await observer.query(
    "insert into departments(id,code,name) values($1,'RACE_A','并发甲'),($2,'RACE_B','并发乙')",
    [deptA, deptB],
  );
  await observer.query(
    "insert into employees(id,employee_number,display_name,department_id) values($1,'RACE_HR','测试HR',$2)",
    [actorEmployee, deptA],
  );
  await observer.query(
    "insert into user_accounts(id,employee_id,password_hash,role) values($1,$2,'unused','hr_admin')",
    [actorAccount, actorEmployee],
  );

  for (const operation of ["assignment", "import"] as const) {
    for (const first of ["assignment", "move"] as const) {
      const label = `${operation}_${first}_first`;
      const positionId = randomUUID(),
        employeeId = randomUUID(),
        previewId = randomUUID();
      const positionCode = `P_${label}`.toUpperCase();
      await observer.query(
        "insert into positions(id,code,name,department_id) values($1,$2,'并发岗位',$3)",
        [positionId, positionCode, deptA],
      );
      if (operation === "assignment") {
        await observer.query(
          "insert into employees(id,employee_number,display_name,department_id) values($1,$2,'测试员工',$3)",
          [employeeId, label.toUpperCase(), deptA],
        );
      } else {
        await observer.query(
          "insert into import_previews(id,actor_account_id,rows,errors,expires_at) values($1,$2,'[]','[]',now()+interval '1 hour')",
          [previewId, actorAccount],
        );
      }
      const mover = await makePool(`${label}_move`).connect();
      const writer = await makePool(`${label}_write`).connect();
      const move = gatedRepository(
        mover,
        first === "move" ? "select id from positions where id=$1 for update" : "NEVER_PAUSE",
      );
      const write = gatedRepository(
        writer,
        first === "assignment" ? "for share of p,d" : "NEVER_PAUSE",
      );
      const doMove = () =>
        move.repository.updatePosition({
          id: positionId,
          name: "已迁岗位",
          departmentId: deptB,
          actorAccountId: actorAccount,
        });
      const doWrite = async () => {
        try {
          if (operation === "assignment")
            return await write.repository.changeAssignment({
              employeeId,
              positionId,
              departmentId: deptA,
              reason: "并发验收",
              effectiveAt: new Date(),
              actorAccountId: actorAccount,
            });
          const credentials = await write.repository.confirmImport({
            previewId,
            actorAccountId: actorAccount,
            rows: [
              {
                rowNumber: 2,
                employeeNumber: label.toUpperCase(),
                displayName: "导入员工",
                departmentCode: "RACE_A",
                positionCode,
                passwordHash: "unused",
                temporaryPassword: "unused",
                role: "employee",
              },
            ],
            now: new Date(),
          });
          return credentials?.length === 1;
        } catch (error) {
          if (
            operation === "import" &&
            error instanceof Error &&
            error.message === "IMPORT_REFERENCE_CHANGED:2"
          )
            return false;
          throw error;
        }
      };
      let movePromise: Promise<boolean> | undefined;
      let writePromise: Promise<boolean> | undefined;
      try {
        const gate = first === "move" ? move : write;
        if (first === "move") movePromise = doMove();
        else writePromise = doWrite();
        await Promise.race([
          gate.reached,
          sleep(5000).then(() => {
            throw new Error(`${label}: lock gate not reached`);
          }),
        ]);
        if (first === "move") writePromise = doWrite();
        else movePromise = doMove();
        const blockedName = `${label}_${first === "move" ? "write" : "move"}`;
        let blocked = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          const waiting = await observer.query(
            "select 1 from pg_stat_activity where datname=$1 and application_name=$2 and wait_event_type='Lock'",
            [database, blockedName],
          );
          if (waiting.rowCount) {
            blocked = true;
            break;
          }
          await sleep(50);
        }
        assert.ok(
          blocked,
          `${label}: competing production transaction must wait for PostgreSQL row lock`,
        );
        gate.release();
        const [moved, assigned] = await Promise.all([movePromise!, writePromise!]);
        assert.equal(moved, first === "move", `${label}: move result`);
        assert.equal(assigned, first === "assignment", `${label}: assignment result`);
        const inconsistent = await observer.query(
          "select pa.id from position_assignments pa join positions p on p.id=pa.position_id join employees e on e.id=pa.employee_id where pa.ended_at is null and (pa.department_id<>p.department_id or e.department_id<>p.department_id)",
        );
        assert.equal(inconsistent.rowCount, 0, `${label}: no cross-department current assignment`);
        const occupants = await observer.query(
          "select id from position_assignments where position_id=$1 and ended_at is null",
          [positionId],
        );
        assert.equal(occupants.rowCount, first === "assignment" ? 1 : 0);
        if (operation === "import" && first === "move") {
          const preview = await observer.query(
            "select confirmed_at from import_previews where id=$1",
            [previewId],
          );
          assert.equal(
            preview.rows[0].confirmed_at,
            null,
            "failed import must roll back preview claim",
          );
          assert.equal(
            (
              await observer.query("select id from employees where employee_number=$1", [
                label.toUpperCase(),
              ])
            ).rowCount,
            0,
          );
        }
        results.push(label);
      } finally {
        move.release();
        write.release();
        await Promise.allSettled(
          [movePromise, writePromise].filter(
            (promise): promise is Promise<boolean> => promise !== undefined,
          ),
        );
        mover.release();
        writer.release();
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        database,
        passed: results.length,
        scenarios: results,
        invariant: "zero cross-department current assignments",
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.all(pools.map((pool) => pool.end()));
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [
    database,
  ]);
  await admin.query(`drop database if exists "${database}"`);
  await admin.end();
}
