import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveIconClassName } from "../src/panels/shared/webview/icons/IconBase";

describe("resolveIconClassName", () => {
  it("keeps default icon colors when callers add text size classes", () => {
    assert.equal(
      resolveIconClassName("h-8 w-8 text-success", "text-sm"),
      "h-8 w-8 text-success text-sm"
    );
    assert.equal(
      resolveIconClassName("h-4 w-4 text-muted-foreground", "text-xs"),
      "h-4 w-4 text-muted-foreground text-xs"
    );
    assert.equal(
      resolveIconClassName("h-4 w-4 text-warning", "text-[11px]"),
      "h-4 w-4 text-warning text-[11px]"
    );
  });

  it("drops default icon colors when callers provide a project color class", () => {
    assert.equal(
      resolveIconClassName("h-8 w-8 text-success", "text-failure"),
      "h-8 w-8 text-failure"
    );
    assert.equal(
      resolveIconClassName("h-4 w-4 text-muted-foreground", "text-foreground"),
      "h-4 w-4 text-foreground"
    );
  });
});
