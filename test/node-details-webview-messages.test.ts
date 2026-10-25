import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, it, vi } from "vitest";
import { nodeDetailsScenarios } from "../dev/webview-preview/fixtures/nodeDetails";
import { emptyNodeAgentLogState } from "../src/panels/nodeDetails/shared/NodeAgentLogContracts";
import type { NodeDetailsOutgoingMessage } from "../src/panels/nodeDetails/shared/NodeDetailsPanelMessages";
import type { NodeDetailsAction } from "../src/panels/nodeDetails/webview/state/nodeDetailsState";

type ReduceMessage = (
  message: NodeDetailsOutgoingMessage,
  dispatch: (action: NodeDetailsAction) => void
) => void;
let reduceMessage: ReduceMessage;
const toast = vi.fn();
vi.doMock("../src/panels/shared/webview/hooks/usePanelMessages", () => ({
  usePanelMessages: (_parse: unknown, _dispatch: unknown, reduce: ReduceMessage) => {
    reduceMessage = reduce;
  }
}));
vi.doMock("../src/panels/shared/webview/hooks/useToast", () => ({ toast }));
const { useNodeDetailsMessages } = await import(
  "../src/panels/nodeDetails/webview/hooks/useNodeDetailsMessages"
);
const dispatch = vi.fn<(action: NodeDetailsAction) => void>();
function Probe(): null {
  useNodeDetailsMessages(dispatch);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  renderToStaticMarkup(createElement(Probe));
});

describe("node details webview messages", () => {
  it("dispatches loading, node details, and independent agent log updates", () => {
    const payload = nodeDetailsScenarios.online;
    const log = { ...emptyNodeAgentLogState(), text: "Connected" };
    reduceMessage({ type: "setLoading", value: true }, dispatch);
    reduceMessage({ type: "updateNodeDetails", payload }, dispatch);
    reduceMessage({ type: "updateNodeAgentLog", payload: log }, dispatch);
    assert.deepEqual(
      dispatch.mock.calls.map(([action]) => action),
      [
        { type: "setLoading", value: true },
        { type: "updateNodeDetails", payload: { type: "updateNodeDetails", payload } },
        { type: "updateNodeAgentLog", payload: log }
      ]
    );
    assert.equal(toast.mock.calls.length, 0);
  });

  it.each([
    ["copyNodeAgentLogResult", "Displayed agent log copied to clipboard."],
    ["copyNodeJsonResult", "Node JSON copied to clipboard."]
  ] as const)("reports only successful clipboard results: %s", (type, description) => {
    reduceMessage({ type, success: false }, dispatch);
    assert.equal(toast.mock.calls.length, 0);
    reduceMessage({ type, success: true }, dispatch);
    assert.deepEqual(toast.mock.calls, [[{ title: "Copied", description, variant: "success" }]]);
    assert.equal(dispatch.mock.calls.length, 0);
  });
});
