import * as React from "react";
import type { BuildDetailsTab } from "../../shared/BuildDetailsPanelWebviewState";
import {
  type BuildDetailsTabSelection,
  reconcileBuildDetailsTabSelection
} from "../components/buildDetails/buildDetailsTabsModel";
import {
  getBuildDetailsPanelUiState,
  setBuildDetailsPanelUiState
} from "../lib/buildDetailsPanelState";

const { useCallback, useEffect, useMemo, useState } = React;

export type { BuildDetailsTab } from "../../shared/BuildDetailsPanelWebviewState";

type UseBuildDetailsTabsParams = {
  hasPendingInputs: boolean;
  /** Ids of the currently pending inputs; newly seen ids may select the Inputs tab. */
  pendingInputIds?: readonly string[];
  hasPipelineStages: boolean;
  hasTests: boolean;
  /** True once a build details snapshot has arrived, so a restored tab can be validated. */
  detailsLoaded?: boolean;
};

type UseBuildDetailsTabsResult = {
  selectedTab: BuildDetailsTab;
  setSelectedTab: (tab: BuildDetailsTab) => void;
  defaultTab: BuildDetailsTab;
  availableTabs: BuildDetailsTab[];
};
const NO_INPUT_IDS: readonly string[] = [];

/**
 * When the active tab disappears (for example Inputs after the last input is
 * approved) its focused control unmounts and focus falls back to the body.
 * Move it to the newly active tab trigger, unless the user already moved on.
 */
function focusTabTriggerIfFocusLost(tab: BuildDetailsTab): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) {
      return;
    }
    document
      .querySelector<HTMLElement>(`[role="tab"][data-tab-value="${tab}"]`)
      ?.focus({ preventScroll: true });
  });
}

export function useBuildDetailsTabs({
  hasPendingInputs,
  pendingInputIds = NO_INPUT_IDS,
  hasPipelineStages,
  hasTests,
  detailsLoaded = true
}: UseBuildDetailsTabsParams): UseBuildDetailsTabsResult {
  const defaultTab: BuildDetailsTab = hasPendingInputs ? "inputs" : "overview";

  const availableTabs: BuildDetailsTab[] = useMemo(() => {
    const tabs: BuildDetailsTab[] = ["overview"];
    if (hasPendingInputs) {
      tabs.push("inputs");
    }
    if (hasPipelineStages) {
      tabs.push("pipeline");
    }
    tabs.push("console");
    if (hasTests) {
      tabs.push("tests");
    }
    return tabs;
  }, [hasPendingInputs, hasPipelineStages, hasTests]);

  const [selection, setSelection] = useState<BuildDetailsTabSelection>(() => {
    const restored = getBuildDetailsPanelUiState().selectedTab;
    const tab = restored ?? defaultTab;
    return {
      tab,
      wasAvailable: availableTabs.includes(tab),
      userChoseTab: restored !== undefined,
      seenInputIds: NO_INPUT_IDS,
      persist: false,
      focusRequest: undefined
    };
  });

  const nextSelection = reconcileBuildDetailsTabSelection(selection, {
    availableTabs,
    defaultTab,
    detailsLoaded,
    pendingInputIds
  });
  if (nextSelection !== selection) {
    setSelection(nextSelection);
  }

  const { tab: selectedTab, persist, focusRequest } = selection;
  const setSelectedTab = useCallback((tab: BuildDetailsTab) => {
    setSelection((previous) => ({
      ...previous,
      tab,
      wasAvailable: true,
      userChoseTab: true,
      persist: true,
      focusRequest: undefined
    }));
  }, []);

  useEffect(() => {
    if (persist) {
      setBuildDetailsPanelUiState({ selectedTab });
    }
    if (focusRequest?.tab === selectedTab) {
      focusTabTriggerIfFocusLost(selectedTab);
    }
  }, [persist, selectedTab, focusRequest]);

  return {
    selectedTab,
    setSelectedTab,
    defaultTab,
    availableTabs
  };
}
