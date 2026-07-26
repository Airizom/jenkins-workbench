import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

const openedUrls: string[] = [];
const warningMessages: string[] = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  env: {
    openExternal: async (uri: vscodeStub.Uri) => {
      openedUrls.push(uri.toString());
      return true;
    }
  },
  window: {
    showWarningMessage: async (message: string) => {
      warningMessages.push(message);
      return undefined;
    }
  }
}));

const { openExternalHttpUrlWithWarning, openJenkinsWorkbenchUrl } = await import(
  "../src/ui/OpenExternalUrl"
);

beforeEach(() => {
  openedUrls.length = 0;
  warningMessages.length = 0;
});

describe("external HTTP URL opening", () => {
  it.each(["http://jenkins.example/job/app", "https://jenkins.example/job/app"])(
    "opens supported URL %s without a warning",
    async (url) => {
      const result = await openExternalHttpUrlWithWarning(url);

      assert.deepEqual(result, { ok: true, opened: true });
      assert.deepEqual(openedUrls, [url]);
      assert.deepEqual(warningMessages, []);
    }
  );

  it.each([
    {
      name: "invalid syntax",
      url: "https://[",
      reason: "invalidUrl" as const,
      expectedMessage: "Unable to open external URL because it is invalid."
    },
    {
      name: "unsupported scheme",
      url: "file:///tmp/jenkins",
      reason: "unsupportedScheme" as const,
      expectedMessage: "Blocked a non-http(s) external URL."
    }
  ])("warns for $name", async ({ url, reason, expectedMessage }) => {
    const result = await openExternalHttpUrlWithWarning(url);

    assert.deepEqual(result, { ok: false, reason });
    assert.deepEqual(openedUrls, []);
    assert.deepEqual(warningMessages, [expectedMessage]);
  });

  it.each([
    {
      url: "https://[",
      options: { invalidUrlMessage: "Custom invalid URL warning." },
      reason: "invalidUrl" as const,
      expectedMessage: "Custom invalid URL warning."
    },
    {
      url: "mailto:admin@jenkins.example",
      options: { unsupportedSchemeMessage: "Custom scheme warning." },
      reason: "unsupportedScheme" as const,
      expectedMessage: "Custom scheme warning."
    }
  ])("uses custom warning text for $reason", async ({ url, options, reason, expectedMessage }) => {
    const result = await openExternalHttpUrlWithWarning(url, options);

    assert.deepEqual(result, { ok: false, reason });
    assert.deepEqual(warningMessages, [expectedMessage]);
  });

  it("builds the default Jenkins warning from normalized labels", async () => {
    const result = await openJenkinsWorkbenchUrl("file:///tmp/jenkins", " Node Details ");

    assert.deepEqual(result, { ok: false, reason: "unsupportedScheme" });
    assert.deepEqual(warningMessages, ["Blocked a non-http(s) Jenkins URL in Node Details."]);
  });
});
