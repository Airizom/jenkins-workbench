import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { BuildDetailsPanelState } from "../src/panels/buildDetails/BuildDetailsPanelState";
import { createBuildDetailsPollingCallbacks } from "../src/panels/buildDetails/BuildDetailsPollingCallbacks";

describe("BuildDetailsPollingCallbacks", () => {
  it("notifies diagnostic offset tracking for HTML appends and resets", () => {
    const messages: unknown[] = [];
    const onConsoleHtmlChanged = vi.fn();
    const callbacks = createBuildDetailsPollingCallbacks(new BuildDetailsPanelState(), 4, {
      postMessage: (message) => messages.push(message),
      setTitle: () => undefined,
      publishErrors: () => undefined,
      isTokenCurrent: (token) => token === 4,
      showCompletionToast: () => undefined,
      onConsoleHtmlChanged
    });

    callbacks.onConsoleHtmlAppend(
      "<span>append</span>",
      { start: 0, end: 6 },
      { start: 4, end: 6 }
    );
    callbacks.onConsoleHtmlSet({
      html: "<b>reset</b>",
      truncated: true,
      textRange: { start: 12, end: 20 }
    });

    assert.deepEqual(
      messages.map((message) => (message as { type: string }).type),
      ["appendConsoleHtml", "setConsoleHtml"]
    );
    assert.deepEqual(onConsoleHtmlChanged.mock.calls, [
      [
        { start: 0, end: 6 },
        { start: 4, end: 6 }
      ],
      [{ start: 12, end: 20 }]
    ]);
  });
});
