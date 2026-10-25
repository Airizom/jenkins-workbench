import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it, vi } from "vitest";
import { nodeDetailsScenarios } from "../dev/webview-preview/fixtures/nodeDetails";
import type { NodeDetailsViewModel } from "../src/panels/nodeDetails/shared/NodeDetailsContracts";
import { NodeDetailsApp } from "../src/panels/nodeDetails/webview/NodeDetailsApp";

function render(model?: NodeDetailsViewModel): string {
  vi.stubGlobal("window", { __INITIAL_STATE__: model });
  return renderToStaticMarkup(createElement(NodeDetailsApp));
}

afterEach(() => vi.unstubAllGlobals());

describe("NodeDetailsApp", () => {
  it("shows initial loading until a node response arrives", () => {
    const html = render();
    assert.match(html, /Loading/);
    assert.doesNotMatch(html, /Node details unavailable/);
  });

  it("renders online and offline nodes with the applicable primary action", () => {
    const online = render(nodeDetailsScenarios.online);
    assert.match(online, /Take offline/);
    const offline = render({
      ...nodeDetailsScenarios.online,
      statusClass: "temporary",
      canTakeOffline: false,
      canBringOnline: true
    });
    assert.match(offline, /Bring online/);
    assert.doesNotMatch(offline, /Take offline/);
    const unavailableActions = render({
      ...nodeDetailsScenarios.online,
      canTakeOffline: false,
      canBringOnline: false,
      updatedAt: "invalid"
    });
    assert.doesNotMatch(unavailableActions, /Take offline|Bring online/);
  });

  it("shows a retryable initial failure without presenting an unknown node", () => {
    const html = render({
      ...nodeDetailsScenarios.online,
      detailsAvailable: false,
      errors: ["Permission denied"]
    });
    assert.match(html, /Node details unavailable/);
    assert.match(html, /Permission denied/);
    assert.match(html, /Retry/);
    assert.match(html, /Open in Jenkins/);
    assert.doesNotMatch(html, /Node actions/);
    assert.doesNotMatch(
      render({
        ...nodeDetailsScenarios.online,
        detailsAvailable: false,
        errors: ["Connection failed"],
        url: undefined
      }),
      /Open in Jenkins/
    );
  });
});
