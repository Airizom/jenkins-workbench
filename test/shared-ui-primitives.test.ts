import assert from "node:assert/strict";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { PanelErrorList } from "../src/panels/shared/webview/components/PanelErrorList";
import { PanelHeader } from "../src/panels/shared/webview/components/PanelHeader";
import { Alert } from "../src/panels/shared/webview/components/ui/alert";
import { Badge } from "../src/panels/shared/webview/components/ui/badge";
import { Checkbox } from "../src/panels/shared/webview/components/ui/checkbox";
import { ClampedText } from "../src/panels/shared/webview/components/ui/clamped-text";
import { DisclosureChevron } from "../src/panels/shared/webview/components/ui/disclosure-chevron";
import { LoadingSkeleton } from "../src/panels/shared/webview/components/ui/loading-skeleton";
import { Select, SelectTrigger } from "../src/panels/shared/webview/components/ui/select";
import { Switch } from "../src/panels/shared/webview/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "../src/panels/shared/webview/components/ui/tabs";
import { Toggle } from "../src/panels/shared/webview/components/ui/toggle";
import {
  ToggleGroup,
  ToggleGroupItem
} from "../src/panels/shared/webview/components/ui/toggle-group";
import {
  AccessibleTooltip,
  TooltipProvider
} from "../src/panels/shared/webview/components/ui/tooltip";
import { TruncatedText } from "../src/panels/shared/webview/components/ui/truncated-text";
import {
  resolveHorizontalOverflow,
  resolveRevealScrollLeft
} from "../src/panels/shared/webview/hooks/useHorizontalOverflow";
import { renderLoadingSkeletonHtml } from "../src/panels/shared/webview/LoadingSkeletonHtml";
import { focusRingInsetClassName } from "../src/panels/shared/webview/lib/focus";

const INSET_FOCUS = focusRingInsetClassName;

describe("focus rings", () => {
  it.each([
    ["Toggle", () => createElement(Toggle, { "aria-label": "Wrap" })],
    [
      "ToggleGroupItem",
      () =>
        createElement(
          ToggleGroup,
          { type: "single", value: "a" },
          createElement(ToggleGroupItem, { value: "a" }, "A")
        )
    ],
    ["Checkbox", () => createElement(Checkbox, { "aria-label": "Select" })],
    ["Switch", () => createElement(Switch, { "aria-label": "Follow" })],
    [
      "SelectTrigger",
      () => createElement(Select, null, createElement(SelectTrigger, null, "Pick"))
    ],
    [
      "TabsTrigger",
      () =>
        createElement(
          Tabs,
          { value: "a" },
          createElement(TabsList, null, createElement(TabsTrigger, { value: "a" }, "A"))
        )
    ]
  ])("%s uses the unclippable inset outline instead of a 1px ring", (_name, render) => {
    const html = renderToStaticMarkup(render());

    assert.ok(html.includes(INSET_FOCUS), html);
    assert.doesNotMatch(html, /focus-visible:ring-1/);
  });
});

describe("high-contrast selected states", () => {
  it("marks on toggles, toggle-group items and active tabs with the contrastActiveBorder ring", () => {
    const toggle = renderToStaticMarkup(createElement(Toggle, { "aria-label": "Wrap" }));
    const group = renderToStaticMarkup(
      createElement(
        ToggleGroup,
        { type: "single" },
        createElement(ToggleGroupItem, { value: "a" }, "A")
      )
    );
    const tabs = renderToStaticMarkup(
      createElement(
        Tabs,
        { value: "a" },
        createElement(TabsList, null, createElement(TabsTrigger, { value: "a" }, "A"))
      )
    );

    assert.match(toggle, /data-\[state=on\]:hc-active-ring/);
    assert.match(group, /data-\[state=on\]:hc-active-ring/);
    assert.match(tabs, /data-\[state=active\]:hc-active-ring/);
  });
});

describe("Alert", () => {
  it("is a polite status by default and an assertive alert when destructive", () => {
    assert.match(renderToStaticMarkup(createElement(Alert, null, "Info")), /role="status"/);
    assert.match(
      renderToStaticMarkup(createElement(Alert, { variant: "warning" }, "Heads up")),
      /role="status"/
    );
    assert.match(
      renderToStaticMarkup(createElement(Alert, { variant: "destructive" }, "Failed")),
      /role="alert"/
    );
  });

  it("lets callers override the role", () => {
    const html = renderToStaticMarkup(createElement(Alert, { role: "alert" }, "Now"));
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /role="status"/);
  });
});

describe("Badge", () => {
  it("uses contrast-safe text tokens for status variants", () => {
    const render = (variant: "success" | "warning" | "failure" | "info") =>
      renderToStaticMarkup(createElement(Badge, { variant }, "x"));

    assert.match(render("success"), /text-success-foreground/);
    assert.match(render("warning"), /text-warning-foreground/);
    assert.match(render("failure"), /text-failure-foreground/);
    assert.match(render("info"), /text-info-foreground/);
    assert.doesNotMatch(render("warning"), /text-warning(?!-foreground)/);
  });

  it("cannot outgrow its container and lets callers opt into wrapping", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { className: "whitespace-normal break-all", title: "a-b" }, "a-b")
    );

    assert.match(html, /min-w-0/);
    assert.match(html, /max-w-full/);
    assert.match(html, /whitespace-normal break-all/);
    assert.doesNotMatch(html, /whitespace-nowrap/);
    assert.match(html, /title="a-b"/);
  });

  it("keeps its line height for both sizes", () => {
    assert.match(renderToStaticMarkup(createElement(Badge, null, "3")), /text-xs leading-4/);
    assert.match(
      renderToStaticMarkup(createElement(Badge, { size: "sm" }, "3")),
      /text-caption leading-4/
    );
  });

  it("keeps its text color alongside the caption font size", () => {
    // tailwind-merge must treat text-caption as a font size, not a color.
    assert.match(
      renderToStaticMarkup(createElement(Badge, { size: "sm" }, "3")),
      /text-badge-foreground/
    );
  });

  it("adds a high-contrast border to filled variants", () => {
    assert.match(renderToStaticMarkup(createElement(Badge, null, "3")), /border-hc-border/);
  });
});

describe("TabsList overflow affordance", () => {
  it("opts into the edge fade styles", () => {
    const html = renderToStaticMarkup(
      createElement(
        Tabs,
        { value: "a" },
        createElement(TabsList, null, createElement(TabsTrigger, { value: "a" }, "A"))
      )
    );
    assert.match(html, /overflow-fade-x/);
    // A visible (thin) scrollbar, not a hidden one, signals clipped tabs.
    assert.match(html, /scrollbar-thin/);
    assert.doesNotMatch(html, /no-scrollbar/);
    assert.match(html, /overflow-x-auto/);
  });

  it("reports which edges hide content", () => {
    assert.deepEqual(
      resolveHorizontalOverflow({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }),
      { start: false, end: false }
    );
    assert.deepEqual(
      resolveHorizontalOverflow({ scrollLeft: 0, scrollWidth: 500, clientWidth: 300 }),
      { start: false, end: true }
    );
    assert.deepEqual(
      resolveHorizontalOverflow({ scrollLeft: 100, scrollWidth: 500, clientWidth: 300 }),
      { start: true, end: true }
    );
    assert.deepEqual(
      resolveHorizontalOverflow({ scrollLeft: 199.5, scrollWidth: 500, clientWidth: 300 }),
      { start: true, end: false }
    );
  });

  it("scrolls just enough to reveal an item past the fade", () => {
    const container = { scrollLeft: 100, clientWidth: 300 };
    assert.equal(resolveRevealScrollLeft(container, { itemStart: 150, itemWidth: 80 }), undefined);
    assert.equal(resolveRevealScrollLeft(container, { itemStart: 110, itemWidth: 80 }), 86);
    assert.equal(resolveRevealScrollLeft(container, { itemStart: 10, itemWidth: 80 }), 0);
    assert.equal(resolveRevealScrollLeft(container, { itemStart: 380, itemWidth: 60 }), 164);
  });
});

describe("AccessibleTooltip", () => {
  it("reads the tooltip text inline for non-focusable triggers", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          AccessibleTooltip,
          { content: "Updated 5 minutes ago" } as ComponentProps<typeof AccessibleTooltip>,
          createElement("span", null, "5m")
        )
      )
    );

    assert.match(html, /<span[^>]*>5m<\/span><span class="sr-only">Updated 5 minutes ago<\/span>/);
    assert.doesNotMatch(html, /tabindex/);
  });

  it("makes focusable triggers keyboard reachable and describes them", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          AccessibleTooltip,
          { content: "Data may be out of date", focusable: true } as ComponentProps<
            typeof AccessibleTooltip
          >,
          createElement("span", null, "Stale")
        )
      )
    );

    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(describedBy);
    assert.match(html, /tabindex="0"/);
    assert.ok(html.includes(`<span id="${describedBy}" hidden="">Data may be out of date</span>`));
  });
});

describe("TruncatedText", () => {
  it("ellipsizes and exposes the full text as a title", () => {
    const html = renderToStaticMarkup(
      createElement(TruncatedText, { text: "folder/job", className: "text-sm" })
    );
    assert.equal(
      html,
      '<span class="block min-w-0 truncate text-sm" title="folder/job">folder/job</span>'
    );
  });

  it("accepts a custom title", () => {
    const html = renderToStaticMarkup(
      createElement(TruncatedText, { text: "job", title: "folder/job" })
    );
    assert.match(html, /title="folder\/job"/);
  });
});

describe("PanelHeader", () => {
  it("truncates by default and exposes the full title as a tooltip", () => {
    const html = renderToStaticMarkup(
      createElement(PanelHeader, { title: "folder/very-long-job-name", eyebrow: "Production" })
    );
    assert.match(html, /<h1 class="[^"]*truncate[^"]*" title="folder\/very-long-job-name">/);
    assert.match(html, /<span class="truncate" title="Production">Production<\/span>/);
  });

  it("wraps long titles anywhere when wrapTitle is set", () => {
    const html = renderToStaticMarkup(
      createElement(PanelHeader, {
        title: createElement("span", null, "a/b"),
        titleTooltip: "a/b",
        wrapTitle: true
      })
    );
    assert.match(html, /<h1 class="[^"]*\[overflow-wrap:anywhere\][^"]*" title="a\/b">/);
    assert.doesNotMatch(html, /<h1 class="[^"]*truncate/);
  });
});

describe("ClampedText", () => {
  it("clamps the text and keeps the full value in a title", () => {
    const html = renderToStaticMarkup(
      createElement(ClampedText, { text: "A long offline reason", textClassName: "text-xs" })
    );
    assert.match(html, /class="[^"]*line-clamp-2[^"]*text-xs" title="A long offline reason"/);
  });
});

describe("DisclosureChevron", () => {
  it("points right when collapsed and rotates down when open", () => {
    const html = renderToStaticMarkup(createElement(DisclosureChevron));
    assert.match(html, /<polyline points="9 6 15 12 9 18"/);
    assert.match(html, /group-data-\[state=open\]:rotate-90/);
  });
});

describe("PanelErrorList retry", () => {
  it("can keep Retry visible but disabled", () => {
    const html = renderToStaticMarkup(
      createElement(PanelErrorList, {
        errors: ["HTTP 502"],
        onRetry: () => undefined,
        retryDisabled: true
      })
    );
    assert.match(html, /<button[^>]*disabled=""[^>]*>.*Retry<\/button>/);
  });
});

describe("LoadingSkeleton", () => {
  it.each(["build", "node", "capacity", "compare"] as const)(
    "renders the same markup as the host skeleton for %s panels",
    (variant) => {
      const html = renderToStaticMarkup(createElement(LoadingSkeleton, { variant }));
      assert.ok(html.includes(renderLoadingSkeletonHtml(variant)));
    }
  );
});
