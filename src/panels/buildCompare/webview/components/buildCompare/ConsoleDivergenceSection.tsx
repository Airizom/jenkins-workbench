import * as React from "react";
import { Button } from "../../../../shared/webview/components/ui/button";
import { ArrowDownIcon } from "../../../../shared/webview/icons";
import { postVsCodeMessage } from "../../../../shared/webview/lib/vscodeApi";
import type {
  BuildCompareBuildViewModel,
  BuildCompareConsoleSectionViewModel
} from "../../../shared/BuildCompareContracts";
import { ConsoleComparison } from "./console/ConsoleComparison";
import { scrollConsoleSnippetsToDivergence } from "./console/consoleDivergenceScroll";
import { SectionCard, type SectionCardDisclosureProps } from "./shared/SectionCard";

const { useEffect } = React;

/**
 * Guidance for states that have no snippet but still need the full logs. Other
 * states (loading, identical, unavailable) are fully described by the heading.
 */
function resolveConsoleFallback(
  status: BuildCompareConsoleSectionViewModel["status"]
): string | undefined {
  switch (status) {
    case "tooLarge":
      return "These logs are past the comparison limits. Open a build to read its full console output.";
    case "error":
      return "Refresh to try the comparison again, or open a build to read its full console output.";
    default:
      return undefined;
  }
}

function OpenBuildButtons({
  baseline,
  target
}: {
  baseline: BuildCompareBuildViewModel;
  target: BuildCompareBuildViewModel;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(
        [
          ["baseline", baseline],
          ["target", target]
        ] as const
      ).map(([side, build]) => (
        <Button
          key={side}
          variant="outline"
          size="sm"
          onClick={() => postVsCodeMessage({ type: "openBuildDetails", side })}
        >
          Open {side} build {build.buildNumberLabel}
        </Button>
      ))}
    </div>
  );
}

function DivergenceIndicator({ label }: { label?: string }) {
  if (!label) {
    return null;
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="mb-3"
      onClick={() => scrollConsoleSnippetsToDivergence()}
    >
      <ArrowDownIcon className="h-3.5 w-3.5" />
      Jump to divergence ({label})
    </Button>
  );
}

export function ConsoleDivergenceSection({
  section,
  baseline,
  target,
  ...disclosure
}: {
  section: BuildCompareConsoleSectionViewModel;
  baseline: BuildCompareBuildViewModel;
  target: BuildCompareBuildViewModel;
} & SectionCardDisclosureProps) {
  const hasSnippets = section.status === "available";
  const fallback = hasSnippets ? undefined : resolveConsoleFallback(section.status);

  // Center both snippets on the divergence line once the console data arrives.
  useEffect(() => {
    if (!hasSnippets) {
      return;
    }
    // Wait a frame so the snippets are laid out before measuring offsets.
    const frame = requestAnimationFrame(() => scrollConsoleSnippetsToDivergence());
    return () => cancelAnimationFrame(frame);
  }, [hasSnippets]);

  return (
    <SectionCard
      title="Console"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
      {...disclosure}
    >
      {hasSnippets ? (
        <>
          <DivergenceIndicator label={section.divergenceLineLabel} />
          <ConsoleComparison section={section} />
        </>
      ) : null}
      {fallback ? (
        <>
          <p className="text-xs text-muted-foreground">{fallback}</p>
          <OpenBuildButtons baseline={baseline} target={target} />
        </>
      ) : null}
    </SectionCard>
  );
}
