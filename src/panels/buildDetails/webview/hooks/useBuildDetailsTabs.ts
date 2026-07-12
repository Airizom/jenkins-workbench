import * as React from "react";
import type { BuildDetailsTab } from "../../shared/BuildDetailsPanelWebviewState";
import {
  getBuildDetailsPanelUiState,
  setBuildDetailsPanelUiState
} from "../lib/buildDetailsPanelState";

const { useCallback, useEffect, useMemo, useRef, useState } = React;

export type { BuildDetailsTab } from "../../shared/BuildDetailsPanelWebviewState";

type UseBuildDetailsTabsParams = {
  hasPendingInputs: boolean;
  hasPipelineStages: boolean;
  hasTests: boolean;
};

type UseBuildDetailsTabsResult = {
  selectedTab: BuildDetailsTab;
  setSelectedTab: (tab: BuildDetailsTab) => void;
  defaultTab: BuildDetailsTab;
  availableTabs: BuildDetailsTab[];
};
export function useBuildDetailsTabs({
  hasPendingInputs,
  hasPipelineStages,
  hasTests
}: UseBuildDetailsTabsParams): UseBuildDetailsTabsResult {
  const defaultTab: BuildDetailsTab = useMemo(
    () => (hasPendingInputs ? "inputs" : "overview"),
    [hasPendingInputs]
  );

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
  const setSelectedTab = useCallback((tab: BuildDetailsTab) => {
    selectedTabWasAvailable.current = true;
    setSelectedTabState(tab);
    setBuildDetailsPanelUiState({ selectedTab: tab });
  }, []);

  useEffect(() => {
    if (availableTabs.includes(selectedTab)) {
      selectedTabWasAvailable.current = true;
    } else if (selectedTabWasAvailable.current) {
      setSelectedTab(defaultTab);
    }
  }, [availableTabs, defaultTab, selectedTab, setSelectedTab]);

  return {
    selectedTab,
    setSelectedTab,
    defaultTab,
    availableTabs
  };
}
