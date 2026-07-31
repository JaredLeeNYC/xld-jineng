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
      materialStorageProvider: "filesystem",
    });
  });

  test("rejects an invalid database URL before startup", () => {
    expect(() => parseServerConfig({ DATABASE_URL: "not-a-url" })).toThrow();
  });

  test("requires COS credentials when cloud storage is selected", () => {
    expect(() => parseServerConfig({ MATERIAL_STORAGE_PROVIDER: "cos" })).toThrow(
      "COS_STORAGE_CONFIGURATION_MISSING",
    );
  });

  test("parses COS storage settings without exposing a filesystem requirement", () => {
    expect(
      parseServerConfig({
        MATERIAL_STORAGE_PROVIDER: "cos",
        COS_BUCKET: "skill-matrix-materials-1442183788",
        COS_REGION: "ap-guangzhou",
        COS_OBJECT_PREFIX: "skill-matrix/",
        COS_SECRET_ID: "secret-id",
        COS_SECRET_KEY: "secret-key",
      }),
    ).toMatchObject({
      materialStorageProvider: "cos",
      cosBucket: "skill-matrix-materials-1442183788",
      cosRegion: "ap-guangzhou",
      cosObjectPrefix: "skill-matrix/",
      cosSecretId: "secret-id",
      cosSecretKey: "secret-key",
    });
  });
});
