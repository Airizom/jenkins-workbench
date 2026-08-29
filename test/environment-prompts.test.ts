import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

let inputBoxOptions: { value?: string } | undefined;

vi.doMock("vscode", () => ({
  window: {
    showInputBox: async (options: { value?: string }) => {
      inputBoxOptions = options;
      return options.value;
    }
  }
}));

const { promptBrowserSsoLoginUrl } = await import("../src/commands/environment/EnvironmentPrompts");

describe("promptBrowserSsoLoginUrl", () => {
  it.each([
    ["https://example.test/jenkins", "https://example.test/jenkins/__sso/login"],
    ["https://example.test", "https://example.test/__sso/login"],
    ["https://example.test/jenkins/", "https://example.test/jenkins/__sso/login"]
  ])("defaults %s to %s", async (environmentUrl, expectedLoginUrl) => {
    const loginUrl = await promptBrowserSsoLoginUrl(environmentUrl);

    assert.equal(inputBoxOptions?.value, expectedLoginUrl);
    assert.equal(loginUrl, expectedLoginUrl);
  });
});
