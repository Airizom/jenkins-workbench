import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { EnvironmentAuthMode } from "../src/commands/environment/EnvironmentPrompts";
import type { BrowserSsoAuthenticator } from "../src/services/BrowserSsoAuthenticationService";

const promptRequiredInput = vi.fn<(...args: unknown[]) => Promise<string | undefined>>();
const promptHeadersJson = vi.fn<() => Promise<Record<string, string> | undefined>>();
const promptBrowserSsoLoginUrl = vi.fn<(...args: unknown[]) => Promise<string | undefined>>();
vi.doMock("../src/commands/environment/EnvironmentPrompts", () => ({
  promptRequiredInput,
  promptHeadersJson,
  promptBrowserSsoLoginUrl
}));
const { promptAuthConfig } = await import(
  "../src/commands/environment/EnvironmentAuthConfigPrompt"
);
const url = "https://jenkins.example/";
const authenticate = vi.fn<BrowserSsoAuthenticator["authenticate"]>();
const authenticator: BrowserSsoAuthenticator = { authenticate };

beforeEach(() => vi.resetAllMocks());

describe("promptAuthConfig", () => {
  it("supports unauthenticated environments without prompting for a secret", async () => {
    assert.deepEqual(await promptAuthConfig("none", url, authenticator), { type: "none" });
    assert.equal(promptRequiredInput.mock.calls.length, 0);
  });

  it("prefills the basic username and keeps the token prompt secret", async () => {
    promptRequiredInput.mockResolvedValueOnce("alice").mockResolvedValueOnce("token");
    assert.deepEqual(
      await promptAuthConfig("basic", url, authenticator, { username: "alice", reason: "manual" }),
      { type: "basic", username: "alice", token: "token" }
    );
    assert.deepEqual(promptRequiredInput.mock.calls, [
      ["Username", undefined, false, { value: "alice" }],
      ["API Token", undefined, true]
    ]);
  });

  it.each([
    { mode: "bearer", expected: { type: "bearer", token: "secret" } },
    { mode: "cookie", expected: { type: "cookie", cookie: "secret" } }
  ] as const)("collects $mode credentials", async ({ mode, expected }) => {
    promptRequiredInput.mockResolvedValue("secret");
    assert.deepEqual(await promptAuthConfig(mode, url, authenticator), expected);
    assert.equal(promptRequiredInput.mock.calls[0][2], true);
  });

  it("returns validated custom headers", async () => {
    const headers = { Authorization: "Custom secret" };
    promptHeadersJson.mockResolvedValue(headers);
    assert.deepEqual(await promptAuthConfig("headers", url, authenticator), {
      type: "headers",
      headers
    });
  });

  it.each<EnvironmentAuthMode>(["basic", "bearer", "cookie", "headers", "sso"])(
    "cancels %s without authenticating",
    async (mode) => {
      assert.equal(await promptAuthConfig(mode, url, authenticator), undefined);
      assert.equal(authenticate.mock.calls.length, 0);
    }
  );

  it("cancels basic auth when the token prompt is dismissed", async () => {
    promptRequiredInput.mockResolvedValueOnce("alice").mockResolvedValueOnce(undefined);
    assert.equal(await promptAuthConfig("basic", url, authenticator), undefined);
  });

  it.each([false, true])(
    "passes current SSO credentials only when provided: %s",
    async (hasCurrent) => {
      const loginUrl = "https://login.example/";
      const currentAuthConfig = { type: "none" as const };
      const result = { type: "sso" as const, loginUrl, headers: { Cookie: "session" } };
      promptBrowserSsoLoginUrl.mockResolvedValue(loginUrl);
      authenticate.mockResolvedValue(result);
      const options = {
        reason: "manual" as const,
        loginUrl,
        ...(hasCurrent ? { currentAuthConfig } : {})
      };
      assert.deepEqual(await promptAuthConfig("sso", url, authenticator, options), result);
      assert.deepEqual(
        authenticate.mock.calls,
        [{ ...options, environmentUrl: url }].map((value) => [value])
      );
      assert.deepEqual(promptBrowserSsoLoginUrl.mock.calls, [[url, loginUrl]]);
    }
  );
});
