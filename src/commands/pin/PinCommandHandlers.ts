import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { canonicalizeJobUrlForEnvironment } from "../../jenkins/urls";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { PinnedJobsFolderTreeItem } from "../../tree/TreeItems";
import { withActionErrorMessage } from "../CommandUtils";

export async function removeMissingPins(
  dataService: JenkinsDataService,
  pinStore: JenkinsPinStore,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: PinnedJobsFolderTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select the Pinned section to remove missing pins.");
    return;
  }

  await withActionErrorMessage("Failed to remove missing pins", async () => {
    const jobs = await dataService.getAllJobsForEnvironment(item.environment, {
      mode: "refresh"
    });
    const validUrls = new Set<string>();
    for (const job of jobs) {
      validUrls.add(job.url);
      const canonicalJobUrl = canonicalizeJobUrlForEnvironment(item.environment.url, job.url);
      if (canonicalJobUrl) {
        validUrls.add(canonicalJobUrl);
      }
    }
    const removed = await pinStore.removeMissingPins(
      item.environment.scope,
      item.environment.environmentId,
      validUrls
    );

    void vscode.window.showInformationMessage(
      removed > 0 ? `Removed ${removed} missing pinned item(s).` : "No missing pinned items found."
    );
    refreshHost.fullEnvironmentRefresh({ environmentId: item.environment.environmentId });
  });
}
