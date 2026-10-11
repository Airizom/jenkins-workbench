import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { NodeStatusClass } from "../src/panels/nodeDetails/shared/NodeDetailsContracts";
import { resolveCoverageStatusBadgeClass } from "../src/panels/shared/TestStatusStyles";
import { ResultBadge } from "../src/panels/shared/webview/components/ResultBadge";
import { ToneBadge } from "../src/panels/shared/webview/components/ToneBadge";
import {
  resolveBuildResultStageNodeClass,
  resolveBuildResultStyle,
  resolveNodeStatusStyle,
  resolveSeverityBadgeClass
} from "../src/panels/shared/webview/lib/statusStyles";

const resolveResultBadgeClass = (resultClass?: string) =>
  resolveBuildResultStyle(resultClass).badge;
const resolveNodeStatusBadgeClass = (statusClass: NodeStatusClass) =>
  resolveNodeStatusStyle(statusClass).badge;

describe("resolveBuildResultStyle", () => {
  it.each([
    ["success", "success"],
    ["failure", "failure"],
    ["unstable", "warning"],
    ["aborted", "aborted"],
    ["running", "info"]
  ])("maps %s to the %s tone across every style field", (resultClass, tone) => {
    const style = resolveBuildResultStyle(resultClass);
    assert.equal(style.badge, `border-${tone}-border bg-${tone}-soft text-${tone}-foreground`);
    assert.equal(style.text, `text-${tone}-foreground`);
    assert.equal(style.iconText, `text-${tone}`);
    assert.equal(style.accent, `bg-${tone}`);
    assert.ok(style.stageNode.startsWith(`border-${tone}-border bg-${tone}-soft text-${tone}`));
    assert.equal(style.connectorColor, `var(--${tone})`);
    assert.match(style.graphBackground, new RegExp(`var\\(--${tone}-soft\\)`));
    assert.equal(style.borderColor, `var(--${tone}-border)`);
  });

  it.each([undefined, "", "neutral", "bogus"])("falls back to neutral for %j", (resultClass) => {
    const neutral = resolveBuildResultStyle("neutral");
    assert.equal(resolveBuildResultStyle(resultClass), neutral);
    assert.equal(neutral.badge, "border-border bg-muted text-muted-foreground");
    assert.equal(neutral.accent, "bg-border");
    assert.equal(neutral.borderColor, "var(--border)");
  });
});

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
    assert.equal(resolveBuildResultStyle("running").iconText, "text-info");
    assert.equal(resolveBuildResultStyle("running").connectorColor, "var(--info)");
    assert.match(resolveBuildResultStageNodeClass("running"), /border-info-border/);
    assert.doesNotMatch(resolveBuildResultStageNodeClass("running"), /warning/);
    assert.match(resolveResultBadgeClass("unstable"), /bg-warning-soft text-warning-foreground/);
  });

  it("styles ResultBadge from its status prop", () => {
    const html = renderToStaticMarkup(
      createElement(ResultBadge, { label: "Failed", status: "failure" })
    );

    assert.match(html, />Failed</);
    assert.match(html, /bg-failure-soft text-failure-foreground/);
  });

  it("keeps idle nodes neutral and reserves amber for temporarily offline nodes", () => {
    assert.doesNotMatch(resolveNodeStatusBadgeClass("idle"), /warning/);
    assert.match(resolveNodeStatusBadgeClass("idle"), /text-muted-foreground/);
    assert.equal(resolveNodeStatusStyle("idle").icon, "text-muted-foreground");
    assert.doesNotMatch(resolveNodeStatusStyle("idle").accent, /warning/);
    assert.match(resolveNodeStatusBadgeClass("temporary"), /border-warning-border/);
    assert.equal(resolveNodeStatusStyle("temporary").accent, "bg-warning");
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
