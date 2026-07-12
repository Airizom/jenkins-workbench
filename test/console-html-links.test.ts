import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { sanitizeConsoleExternalUrl } from "../src/panels/buildDetails/webview/lib/consoleHtml";

describe("sanitizeConsoleExternalUrl", () => {
  it("allows absolute http and https links", () => {
    assert.equal(
      sanitizeConsoleExternalUrl("https://jenkins.example.com/job/example/1/"),
      "https://jenkins.example.com/job/example/1/"
    );
    assert.equal(
      sanitizeConsoleExternalUrl("http://jenkins.example.com/job/example/1/"),
      "http://jenkins.example.com/job/example/1/"
    );
  });

  it("rejects relative links instead of resolving them against the webview origin", () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
      location: { href: "https://webview.example.invalid/index.html" }
    } as Window & typeof globalThis;
    try {
      assert.equal(sanitizeConsoleExternalUrl("/job/example/1/"), undefined);
      assert.equal(sanitizeConsoleExternalUrl("job/example/1/"), undefined);
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it("rejects non-http external links", () => {
    assert.equal(sanitizeConsoleExternalUrl("javascript:alert(1)"), undefined);
    assert.equal(sanitizeConsoleExternalUrl("file:///tmp/console.log"), undefined);
  });
});
