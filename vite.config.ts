import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 100,
    semi: true,
    singleQuote: false,
    ignorePatterns: ["**/dist/**", "packages/db/drizzle/**", "docs/**", ".scratch/**"],
  },
  lint: {
    ignorePatterns: ["**/dist/**", "packages/db/drizzle/**", "docs/**", ".scratch/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
