import * as React from "react";

const { useEffect, useMemo, useState } = React;

export type BuildDetailsTab = "overview" | "inputs" | "pipeline" | "console" | "tests";

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

  const [selectedTab, setSelectedTab] = useState<BuildDetailsTab>(defaultTab);

  useEffect(() => {
    if (!availableTabs.includes(selectedTab)) {
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
