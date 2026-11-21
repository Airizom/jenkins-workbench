import type { BuildDetailsTab } from "../../../shared/BuildDetailsPanelWebviewState";

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

/**
 * An unavailable selected tab falls back to the default once it was shown and then
 * disappeared, or once build details have loaded without it (a restored tab the
 * current build no longer offers).
 */
export function shouldFallBackFromSelectedTab({
  isAvailable,
  wasAvailable,
  detailsLoaded
}: {
  isAvailable: boolean;
  wasAvailable: boolean;
  detailsLoaded: boolean;
}): boolean {
  return !isAvailable && (wasAvailable || detailsLoaded);
}

export type BuildDetailsTabSelection = {
  tab: BuildDetailsTab;
  wasAvailable: boolean;
  userChoseTab: boolean;
  seenInputIds: readonly string[];
  persist: boolean;
  focusRequest?: { tab: BuildDetailsTab };
};

export function reconcileBuildDetailsTabSelection(
  selection: BuildDetailsTabSelection,
  {
    availableTabs,
    defaultTab,
    detailsLoaded,
    pendingInputIds
  }: {
    availableTabs: readonly BuildDetailsTab[];
    defaultTab: BuildDetailsTab;
    detailsLoaded: boolean;
    pendingInputIds: readonly string[];
  }
): BuildDetailsTabSelection {
  const inputIdsChanged =
    selection.seenInputIds.length !== pendingInputIds.length ||
    selection.seenInputIds.some((id, index) => id !== pendingInputIds[index]);
  const autoSelectInputs =
    inputIdsChanged &&
    !selection.userChoseTab &&
    hasNewPendingInputs(new Set(selection.seenInputIds), pendingInputIds);
  const candidate = autoSelectInputs ? "inputs" : selection.tab;
  const isAvailable = availableTabs.includes(candidate);
  const fallBack = shouldFallBackFromSelectedTab({
    isAvailable,
    wasAvailable: selection.wasAvailable || autoSelectInputs,
    detailsLoaded
  });

  if (!inputIdsChanged && !fallBack && (!isAvailable || selection.wasAvailable)) {
    return selection;
  }

  return {
    ...selection,
    tab: fallBack ? defaultTab : candidate,
    wasAvailable: isAvailable || fallBack,
    seenInputIds: pendingInputIds,
    persist: selection.persist || autoSelectInputs || fallBack,
    focusRequest: fallBack
      ? { tab: defaultTab }
      : autoSelectInputs
        ? undefined
        : selection.focusRequest
  };
}
