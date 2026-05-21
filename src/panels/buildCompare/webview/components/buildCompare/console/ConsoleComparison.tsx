import type { BuildCompareConsoleSectionViewModel } from "../../../../shared/BuildCompareContracts";
import { ConsoleSnippet } from "./ConsoleSnippet";

export function ConsoleComparison({ section }: { section: BuildCompareConsoleSectionViewModel }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ConsoleSnippet title="Baseline" lines={section.baselineLines} />
      <ConsoleSnippet title="Target" lines={section.targetLines} />
    </div>
  );
}
