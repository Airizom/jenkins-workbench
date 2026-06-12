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
