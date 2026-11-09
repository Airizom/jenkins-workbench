import { toDisplayedConsoleText } from "../../../../../../buildDiagnostics/BuildDiagnosticConsoleText";
import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";

export interface RunningStageSummary {
  key: string;
  name: string;
  durationLabel: string;
  /** Parallel branches of this stage that are still running. */
  branchNames: string[];
}

function collectRunningBranchNames(stage: PipelineStageViewModel, names: string[]): string[] {
  for (const branch of stage.parallelBranches) {
    if (branch.statusClass === "running") {
      names.push(branch.name);
    }
    collectRunningBranchNames(branch, names);
  }
  return names;
}

export function findRunningStages(stages: PipelineStageViewModel[]): RunningStageSummary[] {
  return stages
    .filter((stage) => stage.statusClass === "running")
    .map((stage) => ({
      key: stage.key,
      name: stage.name,
      durationLabel: stage.durationLabel,
      branchNames: collectRunningBranchNames(stage, [])
    }));
}

/**
 * Last `maxLines` non-blank lines of the displayed console. Remove annotations
 * before selecting lines so multiline or incomplete notes cannot enter the preview.
 */
export function extractConsoleTail(text: string, maxLines: number): string[] {
  const displayedText = toDisplayedConsoleText(text);
  const lines: string[] = [];
  let end = displayedText.length;
  while (end > 0 && lines.length < maxLines) {
    const start = displayedText.lastIndexOf("\n", end - 1);
    const line = displayedText.slice(start + 1, end).trimEnd();
    if (line.trim() !== "") {
      lines.push(line);
    }
    if (start < 0) {
      break;
    }
    end = start;
  }
  return lines.reverse();
}
