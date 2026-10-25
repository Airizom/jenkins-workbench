import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["default", ["junit", { outputFile: "reports/junit.xml" }]],
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text-summary", "cobertura", "json-summary"]
    }
  }
});
