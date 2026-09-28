import type {
  BuildCompareViewModel,
  CompareSectionStatus
} from "../../../shared/BuildCompareContracts";
import type { BuildCompareSectionId } from "../../../shared/BuildComparePanelWebviewState";
import { isStageStatusRegression } from "./stageDiffModel";

export type CompareNavTone = "failure" | "neutral" | "muted";

export interface CompareSectionNavChip {
  /** Short visible status, e.g. "2 new failures" or "n/a". */
  text: string;
  tone: CompareNavTone;
}

export const COMPARE_SECTION_TITLES: Record<BuildCompareSectionId, string> = {
  tests: "Tests",
  parameters: "Parameters",
  changesets: "Changes",
  stages: "Stages",
  console: "Console"
};

const STATUS_CHIPS: Partial<Record<CompareSectionStatus, CompareSectionNavChip>> = {
  loading: { text: "loading", tone: "muted" },
  unavailable: { text: "n/a", tone: "muted" },
  error: { text: "error", tone: "failure" },
  tooLarge: { text: "too large", tone: "muted" },
  identical: { text: "identical", tone: "neutral" },
  empty: { text: "no changes", tone: "neutral" }
};

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function resolveTestsChip(tests: BuildCompareViewModel["tests"]): CompareSectionNavChip {
  if (tests.newFailures.length > 0) {
    return { text: plural(tests.newFailures.length, "new failure"), tone: "failure" };
  }
  if (tests.stillFailing.length > 0) {
    return { text: `${tests.stillFailing.length} still failing`, tone: "failure" };
  }
  if (tests.newPasses.length > 0) {
    return { text: `${tests.newPasses.length} newly passing`, tone: "neutral" };
  }
  const otherCount =
    tests.addedTests.length + tests.removedTests.length + tests.otherChanges.length;
  if (otherCount > 0) {
    return { text: plural(otherCount, "change"), tone: "neutral" };
  }
  return { text: `${tests.ambiguousTests.length} ambiguous`, tone: "neutral" };
}

function resolveStagesChip(stages: BuildCompareViewModel["stages"]): CompareSectionNavChip {
  const regressed = stages.items.filter(isStageStatusRegression).length;
  if (regressed > 0) {
    return { text: `${regressed} regressed`, tone: "failure" };
  }
  const slower = stages.items.filter(
    (item) => item.deltaSignificant && item.deltaDirection === "slower"
  ).length;
  if (slower > 0) {
    return { text: `${slower} slower`, tone: "failure" };
  }
  const changed = stages.items.filter((item) => item.changeType !== "matched").length;
  return changed > 0
    ? { text: plural(changed, "change"), tone: "neutral" }
    : { text: "no changes", tone: "neutral" };
}

/** Visible per-section status for the jump nav; color only reinforces the text. */
export function resolveCompareSectionNavChip(
  id: BuildCompareSectionId,
  model: BuildCompareViewModel
): CompareSectionNavChip {
  const section = model[id];
  if (section.status !== "available") {
    return STATUS_CHIPS[section.status] ?? { text: "n/a", tone: "muted" };
  }
  switch (id) {
    case "tests":
      return resolveTestsChip(model.tests);
    case "parameters":
      return { text: String(model.parameters.items.length), tone: "neutral" };
    case "changesets":
      return {
        text: String(model.changesets.baselineItems.length + model.changesets.targetItems.length),
        tone: "neutral"
      };
    case "stages":
      return resolveStagesChip(model.stages);
    case "console":
      return { text: "diverges", tone: "neutral" };
  }
}
