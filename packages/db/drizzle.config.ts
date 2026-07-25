export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://skill_matrix:skill_matrix_dev@localhost:5433/skill_matrix",
  },
};
