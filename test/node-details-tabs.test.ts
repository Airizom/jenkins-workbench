import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, vi } from "vitest";
import { NODE_DETAILS_TABS } from "../src/panels/nodeDetails/webview/nodeDetailsTabValues";
import type { NodeDetailsState } from "../src/panels/nodeDetails/webview/state/nodeDetailsState";

let handleTabValueChange: ((value: string) => void) | undefined;

vi.doMock("../src/panels/shared/webview/components/ui/tabs", () => {
  const Container = ({ children }: React.PropsWithChildren) =>
    React.createElement("div", undefined, children);

  return {
    Tabs: ({
      children,
      onValueChange
    }: React.PropsWithChildren<{ onValueChange: (value: string) => void }>) => {
      handleTabValueChange = onValueChange;
      return React.createElement("div", undefined, children);
    },
    TabsContent: Container,
    TabsList: Container,
    TabsTrigger: Container
  };
});

for (const modulePath of [
  "../src/panels/nodeDetails/webview/components/nodeDetails/NodeDetailsAdvancedSection",
  "../src/panels/nodeDetails/webview/components/nodeDetails/NodeDetailsExecutorsSection",
  "../src/panels/nodeDetails/webview/components/nodeDetails/NodeDetailsOverviewSection",
  "../src/panels/nodeDetails/webview/components/nodeDetails/NodeDetailsQueuedWorkSection"
]) {
  vi.doMock(modulePath, () => ({
    NodeDetailsAdvancedSection: () => null,
    NodeDetailsExecutorsSection: () => null,
    NodeDetailsOverviewSection: () => null,
    NodeDetailsQueuedWorkSection: () => null
  }));
}

const { NodeDetailsTabs } = await import(
  "../src/panels/nodeDetails/webview/components/nodeDetails/NodeDetailsTabs"
);

describe("NodeDetailsTabs", () => {
  it("reports the shared Diagnostics value when that tab is activated", () => {
    const values: string[] = [];
    const state = {
      executors: [],
      oneOffExecutors: [],
      queuedWork: {
        matchingQueueItems: [],
        anyQueueItems: [],
        selfLabelQueueItems: []
      }
    } as unknown as NodeDetailsState;

    renderToStaticMarkup(
      React.createElement(NodeDetailsTabs, {
        state,
        overviewRows: [],
        onDiagnosticsToggle: (value) => values.push(value),
        onCopyJson: () => undefined,
        onOpenExternal: () => undefined
      })
    );

    const activateTab = handleTabValueChange;
    assert.ok(activateTab);
    activateTab(NODE_DETAILS_TABS.DIAGNOSTICS);

    assert.deepEqual(values, [NODE_DETAILS_TABS.DIAGNOSTICS]);
  });
});
