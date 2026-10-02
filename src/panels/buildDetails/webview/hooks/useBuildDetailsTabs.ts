import * as React from "react";
import type { BuildDetailsTab } from "../../shared/BuildDetailsPanelWebviewState";
import { hasNewPendingInputs } from "../components/buildDetails/buildDetailsTabsModel";
import {
  getBuildDetailsPanelUiState,
  setBuildDetailsPanelUiState
} from "../lib/buildDetailsPanelState";

const { useCallback, useEffect, useMemo, useRef, useState } = React;

export type { BuildDetailsTab } from "../../shared/BuildDetailsPanelWebviewState";

type UseBuildDetailsTabsParams = {
  hasPendingInputs: boolean;
  /** Ids of the currently pending inputs; newly seen ids may select the Inputs tab. */
  pendingInputIds?: readonly string[];
  hasPipelineStages: boolean;
  hasTests: boolean;
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
  hasTests
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

  const [selectedTab, setSelectedTabState] = useState<BuildDetailsTab>(
    () => getBuildDetailsPanelUiState().selectedTab ?? defaultTab
  );
  const selectedTabWasAvailable = useRef(availableTabs.includes(selectedTab));
  // A restored tab counts as a user choice, so reopening a panel keeps its tab.
  const userChoseTab = useRef(getBuildDetailsPanelUiState().selectedTab !== undefined);
  const seenInputIds = useRef(new Set<string>());

  const applySelectedTab = useCallback((tab: BuildDetailsTab) => {
    selectedTabWasAvailable.current = true;
    setSelectedTabState(tab);
    setBuildDetailsPanelUiState({ selectedTab: tab });
  }, []);

  const setSelectedTab = useCallback(
    (tab: BuildDetailsTab) => {
      userChoseTab.current = true;
      applySelectedTab(tab);
    },
    [applySelectedTab]
  );

  useEffect(() => {
    const appeared = hasNewPendingInputs(seenInputIds.current, pendingInputIds);
    seenInputIds.current = new Set(pendingInputIds);
    if (appeared && !userChoseTab.current) {
      applySelectedTab("inputs");
    }
  }, [pendingInputIds, applySelectedTab]);

  useEffect(() => {
    if (availableTabs.includes(selectedTab)) {
      selectedTabWasAvailable.current = true;
    } else if (selectedTabWasAvailable.current) {
      applySelectedTab(defaultTab);
      focusTabTriggerIfFocusLost(defaultTab);
    }
  }, [availableTabs, defaultTab, selectedTab, applySelectedTab]);

  return {
    selectedTab,
    setSelectedTab,
    defaultTab,
    availableTabs
  };
}
