import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tooling/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
    ],
  },
});
