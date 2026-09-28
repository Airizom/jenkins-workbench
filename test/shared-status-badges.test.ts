import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { resolveCoverageStatusBadgeClass } from "../src/panels/shared/TestStatusStyles";
import { ToneBadge } from "../src/panels/shared/webview/components/ToneBadge";
import {
  resolveBuildResultConnectorColor,
  resolveBuildResultStageNodeClass,
  resolveNodeStatusAccentClass,
  resolveNodeStatusBadgeClass,
  resolveNodeStatusIconClass,
  resolveResultBadgeClass,
  resolveResultIconTextClass,
  resolveSeverityBadgeClass
} from "../src/panels/shared/webview/lib/statusStyles";

describe("shared status badges", () => {
  it("renders coverage status classes through the shared badge", () => {
    const html = renderToStaticMarkup(
      createElement(ToneBadge, {
        label: "Passed",
        className: resolveCoverageStatusBadgeClass("success")
      })
    );

    assert.match(html, />Passed</);
    assert.match(html, /border-success-border/);
  });

  it("renders node status classes through the shared badge", () => {
    const html = renderToStaticMarkup(
      createElement(ToneBadge, {
        label: "Online",
        className: resolveNodeStatusBadgeClass("online")
      })
    );

    assert.match(html, />Online</);
    assert.match(html, /border-success-border/);
  });

  it("renders severity classes through the shared badge", () => {
    const html = renderToStaticMarkup(
      createElement(ToneBadge, {
        label: "Critical",
        className: resolveSeverityBadgeClass("critical")
      })
    );

    assert.match(html, />Critical</);
    assert.match(html, /border-failure-border/);
  });

  it("styles running builds with the info tone so they never match unstable", () => {
    assert.notEqual(resolveResultBadgeClass("running"), resolveResultBadgeClass("unstable"));
    assert.match(resolveResultBadgeClass("running"), /bg-info-soft text-info-foreground/);
    assert.equal(resolveResultIconTextClass("running"), "text-info");
    assert.equal(resolveBuildResultConnectorColor("running"), "var(--info)");
    assert.match(resolveBuildResultStageNodeClass("running"), /border-info-border/);
    assert.doesNotMatch(resolveBuildResultStageNodeClass("running"), /warning/);
    assert.match(resolveResultBadgeClass("unstable"), /bg-warning-soft text-warning-foreground/);
  });

  it("keeps idle nodes neutral and reserves amber for temporarily offline nodes", () => {
    assert.doesNotMatch(resolveNodeStatusBadgeClass("idle"), /warning/);
    assert.match(resolveNodeStatusBadgeClass("idle"), /text-muted-foreground/);
    assert.equal(resolveNodeStatusIconClass("idle"), "text-muted-foreground");
    assert.doesNotMatch(resolveNodeStatusAccentClass("idle"), /warning/);
    assert.match(resolveNodeStatusBadgeClass("temporary"), /border-warning-border/);
    assert.equal(resolveNodeStatusAccentClass("temporary"), "bg-warning");
  });

  it("uses contrast-safe text tokens on tinted node badges", () => {
    assert.match(resolveNodeStatusBadgeClass("online"), /text-success-foreground/);
    assert.match(resolveNodeStatusBadgeClass("temporary"), /text-warning-foreground/);
    assert.match(resolveNodeStatusBadgeClass("offline"), /text-failure-foreground/);
    for (const statusClass of ["online", "temporary", "offline"] as const) {
      assert.doesNotMatch(
        resolveNodeStatusBadgeClass(statusClass),
        /text-(success|warning|failure)(?!-foreground)/
      );
    }
  });
});
