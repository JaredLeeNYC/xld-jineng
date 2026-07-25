import { describe, expect, test } from "bun:test";
import { createDatabaseReadinessProbe } from "./readiness";

describe("PostgreSQL readiness probe", () => {
  test("is ready when PostgreSQL responds and all migrations exist", async () => {
    const responses = [
      { rows: [{ "?column?": 1 }] },
      { rows: [{ hash: "expected-hash", createdAt: "1000" }] },
    ];
    const probe = createDatabaseReadinessProbe(
      {
        query: async () => responses.shift() ?? { rows: [] },
      },
      [{ hash: "expected-hash", createdAt: "1000" }],
    );

    expect(await probe()).toEqual({ ok: true });
  });

  test("classifies a connection error as database unavailable", async () => {
    const probe = createDatabaseReadinessProbe({
      query: async () => {
        throw new Error("connection refused");
      },
    });

    expect(await probe()).toEqual({
      ok: false,
      reason: "database-unavailable",
      message: "数据库暂不可用",
    });
  });

  test("classifies a migration count mismatch separately", async () => {
    const responses = [{ rows: [{ "?column?": 1 }] }, { rows: [] }];
    const probe = createDatabaseReadinessProbe(
      {
        query: async () => responses.shift() ?? { rows: [] },
      },
      [{ hash: "expected-hash", createdAt: "1000" }],
    );

    expect(await probe()).toEqual({
      ok: false,
      reason: "migration-mismatch",
      message: "数据库结构未升级到当前版本",
    });
  });

  test("rejects a same-sized migration history with a different hash", async () => {
    const responses = [
      { rows: [{ "?column?": 1 }] },
      { rows: [{ hash: "wrong-hash", createdAt: "1000" }] },
    ];
    const probe = createDatabaseReadinessProbe(
      {
        query: async () => responses.shift() ?? { rows: [] },
      },
      [{ hash: "expected-hash", createdAt: "1000" }],
    );

    expect(await probe()).toEqual({
      ok: false,
      reason: "migration-mismatch",
      message: "数据库结构未升级到当前版本",
    });
  });
});
