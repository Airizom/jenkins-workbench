import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";

export interface RunningStageSummary {
  key: string;
  name: string;
  durationLabel: string;
  /** Parallel branches of this stage that are still running. */
  branchNames: string[];
}

// CSI sequences (colors, cursor moves) that AnsiColor-style plugins leave in plain console text.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ESC control character is the point
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

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
 * Last `maxLines` non-blank lines of the console, without ANSI escapes. Scans
 * back from the end so a long log is never split in full on every update.
 */
export function extractConsoleTail(text: string, maxLines: number): string[] {
  const lines: string[] = [];
  let end = text.length;
  while (end > 0 && lines.length < maxLines) {
    const start = text.lastIndexOf("\n", end - 1);
    const line = text
      .slice(start + 1, end)
      .replace(ANSI_ESCAPE_PATTERN, "")
      .trimEnd();
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
