import type { BuildDetailsTab } from "../../hooks/useBuildDetailsTabs";

export type BuildDetailsTabAvailability = {
  hasPendingInputs: boolean;
  hasPipelineStages: boolean;
  hasTests: boolean;
};

export function resolveBuildDetailsSelectedTab(
  selectedTab: BuildDetailsTab,
  { hasPendingInputs, hasPipelineStages, hasTests }: BuildDetailsTabAvailability
): BuildDetailsTab {
  const fallbackTab: BuildDetailsTab = hasPendingInputs ? "inputs" : "overview";

  if (selectedTab === "inputs") {
    return hasPendingInputs ? selectedTab : fallbackTab;
  }
  if (selectedTab === "pipeline") {
    return hasPipelineStages ? selectedTab : fallbackTab;
  }
  if (selectedTab === "tests") {
    return hasTests ? selectedTab : fallbackTab;
  }
  return selectedTab;
}

/**
 * New pending inputs pull focus to the Inputs tab only while the user has not picked a
 * tab themselves; otherwise the hero banner is the (non-disruptive) signal.
 */
export function hasNewPendingInputs(
  previousInputIds: ReadonlySet<string>,
  nextInputIds: readonly string[]
): boolean {
  return nextInputIds.some((id) => !previousInputIds.has(id));
}
