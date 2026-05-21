import { Badge } from "../../../../shared/webview/components/ui/badge";
import type { BuildCompareConsoleSectionViewModel } from "../../../shared/BuildCompareContracts";
import { ConsoleComparison } from "./console/ConsoleComparison";
import { EmptyState } from "./shared/EmptyState";
import { SectionCard } from "./shared/SectionCard";

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
  return (
    <SectionCard
      title="Console Divergence"
      summary={section.summaryLabel}
      detail={section.detail}
      status={section.status}
    >
      {section.divergenceLineLabel ? (
        <Badge variant="outline" className="mb-3">
          {section.divergenceLineLabel}
        </Badge>
      ) : null}
      {section.status === "available" ? (
        <ConsoleComparison section={section} />
      ) : (
        <EmptyState label={resolveConsoleEmptyLabel(section.status)} />
      )}
    </SectionCard>
  );
}
