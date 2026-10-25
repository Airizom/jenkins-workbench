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
      handleBuildCompleted: () => undefined,
      postStateUpdate: () => undefined,
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

  it("forwards completion to handleBuildCompleted only for the current token", () => {
    const handleBuildCompleted = vi.fn();
    let currentToken = 7;
    const callbacks = createBuildDetailsPollingCallbacks(new BuildDetailsPanelState(), 7, {
      postMessage: () => undefined,
      setTitle: () => undefined,
      publishErrors: () => undefined,
      isTokenCurrent: (token) => token === currentToken,
      handleBuildCompleted,
      postStateUpdate: () => undefined
    });
    const details = { number: 1, building: false } as Parameters<typeof callbacks.onComplete>[0];

    callbacks.onComplete(details);
    currentToken = 8;
    callbacks.onComplete(details);

    assert.deepEqual(handleBuildCompleted.mock.calls, [[details, 7]]);
  });

  it("routes state changes through postStateUpdate instead of building messages itself", () => {
    const messages: unknown[] = [];
    const postStateUpdate = vi.fn();
    const state = new BuildDetailsPanelState();
    let currentToken = 3;
    const callbacks = createBuildDetailsPollingCallbacks(state, 3, {
      postMessage: (message) => messages.push(message),
      setTitle: () => undefined,
      publishErrors: () => undefined,
      isTokenCurrent: (token) => token === currentToken,
      handleBuildCompleted: () => undefined,
      postStateUpdate
    });
    const details = { number: 1, building: true } as Parameters<typeof callbacks.onDetails>[0];

    callbacks.onDetails(details);
    callbacks.onWorkflowRun(undefined);
    callbacks.onWorkflowError(new Error("boom"));
    callbacks.onPendingInputs([]);
    currentToken = 4;
    callbacks.onDetails(details);

    assert.equal(postStateUpdate.mock.calls.length, 4);
    assert.deepEqual(messages, []);
    assert.equal(state.currentDetails, details);
  });
});
