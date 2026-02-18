import * as React from "react";

const { useEffect, useMemo, useState } = React;

export type BuildDetailsTab = "inputs" | "pipeline" | "console" | "insights";

type UseBuildDetailsTabsParams = {
  hasPendingInputs: boolean;
  hasPipelineStages: boolean;
};

type UseBuildDetailsTabsResult = {
  selectedTab: BuildDetailsTab;
  setSelectedTab: (tab: BuildDetailsTab) => void;
  defaultTab: BuildDetailsTab;
  availableTabs: BuildDetailsTab[];
};

export function useBuildDetailsTabs({
  hasPendingInputs,
  hasPipelineStages
}: UseBuildDetailsTabsParams): UseBuildDetailsTabsResult {
  const defaultTab: BuildDetailsTab = useMemo(() => {
    if (hasPendingInputs) {
      return "inputs";
    }
    if (hasPipelineStages) {
      return "pipeline";
    }
    return "console";
  }, [hasPendingInputs, hasPipelineStages]);

  const availableTabs: BuildDetailsTab[] = useMemo(() => {
    const tabs: BuildDetailsTab[] = [];
    if (hasPendingInputs) {
      tabs.push("inputs");
    }
    if (hasPipelineStages) {
      tabs.push("pipeline");
    }
    tabs.push("console", "insights");
    return tabs;
  }, [hasPendingInputs, hasPipelineStages]);

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
