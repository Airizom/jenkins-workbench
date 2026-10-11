import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { afterEach, describe, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
});

describe("SectionCard", () => {
  it("toggles uncontrolled state and notifies onOpenChange on each toggle", async () => {
    let open = true;
    const actualReact = await vi.importActual<typeof import("react")>("react");
    vi.doMock("react", () => ({
      ...actualReact,
      useId: () => "section-card",
      useState: () => [open, (next: boolean) => (open = next)]
    }));
    const { SectionCard } = await import(
      "../src/panels/buildCompare/webview/components/buildCompare/shared/SectionCard"
    );
    const onOpenChange = vi.fn();
    const render = () =>
      SectionCard({
        title: "Parameter Diff",
        summary: "Comparison summary",
        status: "available",
        onOpenChange,
        children: "Changed parameter"
      }).props.children as ReactElement<{
        open: boolean;
        onOpenChange: (next: boolean) => void;
      }>;

    assert.equal(render().props.open, true);

    render().props.onOpenChange(false);
    assert.equal(render().props.open, false);
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);

    render().props.onOpenChange(true);
    assert.equal(render().props.open, true);
    assert.deepEqual(onOpenChange.mock.calls, [[false], [true]]);
  });
});
