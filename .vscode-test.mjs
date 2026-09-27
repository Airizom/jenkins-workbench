import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out-test/integration/**/*.test.js",
  version: "stable",
  launchArgs: process.env.JENKINS_HISTORY_LIVE
    ? [process.cwd(), ...(process.env.JENKINS_HISTORY_MANUAL_SMOKE ? ["--remote-debugging-port=9235", "--force-renderer-accessibility"] : [])]
    : [],
  mocha: {
    ui: "bdd",
    timeout: 20000
  }
});
