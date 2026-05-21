import * as vscode from "vscode";
import {
  formatOptionalDurationMs,
  formatOptionalLocaleTimestamp
} from "../../formatters/DisplayFormatters";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { parseBuildUrl } from "../../jenkins/urls";
import type { BuildComparePanelLauncher } from "../../panels/BuildComparePanelLauncher";
import type { BuildTreeItem } from "../../tree/TreeItems";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";

interface CompareBuildQuickPickItem extends vscode.QuickPickItem {
  buildUrl?: string;
}

const BUILD_COMPARE_FETCH_LIMIT = 40;

export async function compareWithBuild(
  dataService: JenkinsDataService,
  buildComparePanelLauncher: BuildComparePanelLauncher,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a completed build to compare.");
  if (!selected) {
    return;
  }

  if (selected.isBuilding) {
    void vscode.window.showInformationMessage(
      "Build comparison is only available for completed builds."
    );
    return;
  }

  await withActionErrorMessage("Unable to open build comparison", async () => {
    const selectedLabel = getTreeItemLabel(selected);
    const parsed = parseBuildUrl(selected.buildUrl);
    if (!parsed) {
      void vscode.window.showInformationMessage(
        "The selected build URL could not be resolved to its Jenkins job."
      );
      return;
    }

    const builds = await dataService.getBuildsForJob(
      selected.environment,
      parsed.jobUrl,
      BUILD_COMPARE_FETCH_LIMIT,
      {
        detailLevel: "details",
        includeParameters: true,
        bypassCache: true
      }
    );
    const comparableBuilds = builds
      .filter(
        (build) =>
          !build.building && build.url !== selected.buildUrl && build.number < selected.buildNumber
      )
      .sort((left, right) => right.number - left.number);

    if (comparableBuilds.length === 0) {
      void vscode.window.showInformationMessage(
        `No other completed builds were found for ${selectedLabel}.`
      );
      return;
    }

    const baseline = await promptForComparisonBuild(selected, comparableBuilds);
    if (!baseline?.buildUrl) {
      return;
    }

    await buildComparePanelLauncher.show({
      environment: selected.environment,
      baselineBuildUrl: baseline.buildUrl,
      targetBuildUrl: selected.buildUrl,
      label: selectedLabel
    });
  });
}

async function promptForComparisonBuild(
  selected: BuildTreeItem,
  builds: Array<{
    number: number;
    url: string;
    result?: string;
    timestamp?: number;
    duration?: number;
  }>
): Promise<CompareBuildQuickPickItem | undefined> {
  const quickPick = vscode.window.createQuickPick<CompareBuildQuickPickItem>();
  quickPick.ignoreFocusOut = true;
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.title = "Compare With Build";
  quickPick.placeholder = `Choose the baseline build for ${getTreeItemLabel(selected)}`;

  const previousBuild = builds.find((build) => build.number < selected.buildNumber);
  const suggestedBuild = previousBuild ? createCompareBuildQuickPickItem(previousBuild) : undefined;
  const recentItems = builds
    .filter((build) => build.url !== previousBuild?.url)
    .map((build) => createCompareBuildQuickPickItem(build));

  quickPick.items = suggestedBuild
    ? [
        { label: "Suggested", kind: vscode.QuickPickItemKind.Separator },
        suggestedBuild,
        { label: "Recent Builds", kind: vscode.QuickPickItemKind.Separator },
        ...recentItems
      ]
    : recentItems;

  if (suggestedBuild) {
    quickPick.activeItems = [suggestedBuild];
    quickPick.selectedItems = [suggestedBuild];
  }

  return new Promise<CompareBuildQuickPickItem | undefined>((resolve) => {
    let settled = false;
    const finish = (value: CompareBuildQuickPickItem | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      accept.dispose();
      hide.dispose();
      quickPick.hide();
      resolve(value);
    };

    const accept = quickPick.onDidAccept(() => {
      const item = quickPick.selectedItems[0];
      finish(item?.buildUrl ? item : undefined);
    });
    const hide = quickPick.onDidHide(() => finish(undefined));

    quickPick.show();
  });
}

function createCompareBuildQuickPickItem(build: {
  number: number;
  url: string;
  result?: string;
  timestamp?: number;
  duration?: number;
}): CompareBuildQuickPickItem {
  return {
    label: `#${build.number}`,
    description: build.result ?? "Unknown",
    detail: [
      formatOptionalLocaleTimestamp(build.timestamp),
      formatOptionalDurationMs(build.duration)
    ]
      .filter((part) => part.length > 0)
      .join(" • "),
    buildUrl: build.url
  };
}
