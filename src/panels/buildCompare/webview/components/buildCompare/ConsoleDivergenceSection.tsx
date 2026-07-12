import * as React from "react";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import { ArrowDownIcon } from "../../../../shared/webview/icons";
import type { BuildCompareConsoleSectionViewModel } from "../../../shared/BuildCompareContracts";
import { ConsoleComparison } from "./console/ConsoleComparison";
import { scrollConsoleSnippetsToDivergence } from "./console/consoleDivergenceScroll";
import { EmptyState } from "./shared/EmptyState";
import { SectionCard } from "./shared/SectionCard";

const { useEffect } = React;

function resolveConsoleEmptyLabel(status: BuildCompareConsoleSectionViewModel["status"]): string {
  switch (status) {
    case "loading":
      return "Console comparison is still loading.";
    case "tooLarge":
      return "Open the underlying build details to inspect the full logs.";
    case "identical":
      return "Both console logs matched within the configured comparison limits.";
    default:
      return "Console comparison did not produce a snippet.";
  }
}
export function ConsoleDivergenceSection({
  section
}: {
  section: BuildCompareConsoleSectionViewModel;
}) {
  const hasSnippets = section.status === "available";

  // Center both snippets on the divergence line once the console data arrives.
  useEffect(() => {
    if (!hasSnippets) {
      return;
    }
    // Wait a frame so the snippets are laid out before measuring offsets.
    const frame = requestAnimationFrame(() => scrollConsoleSnippetsToDivergence());
    return () => cancelAnimationFrame(frame);
  }, [hasSnippets, section]);

  return (
    <SectionCard
      title="Console Divergence"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
    >
      {section.divergenceLineLabel ? (
        hasSnippets ? (
          <Button
            variant="outline"
            size="sm"
            className="mb-3"
            onClick={() => scrollConsoleSnippetsToDivergence()}
          >
            <ArrowDownIcon className="h-3.5 w-3.5" />
            Jump to divergence ({section.divergenceLineLabel})
          </Button>
        ) : (
          <Badge variant="outline" className="mb-3">
            {section.divergenceLineLabel}
          </Badge>
        )
      ) : null}
      {hasSnippets ? (
        <ConsoleComparison section={section} />
      ) : (
        <EmptyState label={resolveConsoleEmptyLabel(section.status)} />
      )}
    </SectionCard>
  );
}
