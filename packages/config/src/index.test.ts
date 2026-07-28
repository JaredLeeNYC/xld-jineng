import { describe, expect, test } from "bun:test";
import { parseServerConfig } from "./index";

describe("server configuration", () => {
  test("provides safe local defaults", () => {
    expect(parseServerConfig({})).toEqual({
      appUrl: "http://localhost:3101",
      databaseUrl: "postgres://skill_matrix:skill_matrix_dev@localhost:5433/skill_matrix",
      host: "0.0.0.0",
      port: 3000,
      materialStorageDir: ".data/materials",
    });
  });

  test("rejects an invalid database URL before startup", () => {
    expect(() => parseServerConfig({ DATABASE_URL: "not-a-url" })).toThrow();
  });
});
