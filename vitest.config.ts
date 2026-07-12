import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The real `vscode` module only exists inside the extension host.
      // Unit tests resolve it to a lightweight stub; individual test files
      // override it with `vi.doMock("vscode", ...)` when they need custom
      // behavior.
      vscode: path.resolve(__dirname, "test/helpers/vscodeStub.ts")
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      // Ratchet, not target: set just below the measured baseline so CI
      // fails on regressions. Raise these as coverage grows; if a
      // legitimate change dips below one, lower it in the same PR and
      // explain why.
      thresholds: {
        statements: 30,
        branches: 25,
        functions: 28,
        lines: 30
      }
    }
  }
});
