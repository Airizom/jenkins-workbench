import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it, vi } from "vitest";
import type { BuildCompareChangesetItem } from "../src/panels/buildCompare/shared/BuildCompareContracts";
import { ChangesetColumn } from "../src/panels/buildCompare/webview/components/buildCompare/ChangesetColumn";

describe("ChangesetColumn", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders repeated commits without duplicate React keys", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const items = [
      { author: "bot", message: "Merge branch main" },
      { author: "bot", message: "Merge branch main" },
      { author: "dev", message: "Fix", commitId: "abc123" },
      { author: "dev", message: "Fix", commitId: "abc123" }
    ] as BuildCompareChangesetItem[];

    const html = renderToStaticMarkup(createElement(ChangesetColumn, { title: "Baseline", items }));

    assert.equal(html.match(/Merge branch main/g)?.length, 2);
    assert.equal(html.match(/ · <span class="font-mono">abc123<\/span>/g)?.length, 2);
    const keyWarnings = errorSpy.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === "string" && arg.includes("same key"))
    );
    assert.deepEqual(keyWarnings, []);
  });
});
