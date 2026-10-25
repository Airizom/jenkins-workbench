import { parseBuildUrl, parseJobUrl } from "../../jenkins/urls";
import type {
  BuildManagementResult,
  BuildManagementTarget,
  BuildManagementWorkflow
} from "../../services/build/BuildManagementWorkflow";
import type { BuildTreeItem } from "../../tree/TreeItems";
import { getTreeItemLabel, requireSelection } from "../CommandUtils";

type BuildManagementAction = (
  workflow: BuildManagementWorkflow,
  target: BuildManagementTarget
) => Promise<BuildManagementResult>;

export function toBuildManagementTarget(item: BuildTreeItem): BuildManagementTarget {
  const buildLabel = getTreeItemLabel(item);
  const jobName = item.jobNameHint?.trim() || resolveJobName(item);
  return {
    environment: item.environment,
    buildUrl: item.buildUrl,
    label: jobName ? `${jobName} ${buildLabel}` : buildLabel,
    isBuilding: item.isBuilding
  };
}

async function runOnSelection(
  workflow: BuildManagementWorkflow,
  item: BuildTreeItem | undefined,
  missingSelectionMessage: string,
  action: BuildManagementAction
): Promise<void> {
  const selected = requireSelection(item, missingSelectionMessage);
  if (!selected) {
    return;
  }
  await action(workflow, toBuildManagementTarget(selected));
}

export function deleteBuild(
  workflow: BuildManagementWorkflow,
  item?: BuildTreeItem
): Promise<void> {
  return runOnSelection(workflow, item, "Select a build to delete.", (flow, target) =>
    flow.deleteBuild(target)
  );
}

export function keepBuildForever(
  workflow: BuildManagementWorkflow,
  item?: BuildTreeItem
): Promise<void> {
  return runOnSelection(workflow, item, "Select a build to keep forever.", (flow, target) =>
    flow.setKeepForever(target, true)
  );
}

export function stopKeepingBuild(
  workflow: BuildManagementWorkflow,
  item?: BuildTreeItem
): Promise<void> {
  return runOnSelection(workflow, item, "Select a build to stop keeping.", (flow, target) =>
    flow.setKeepForever(target, false)
  );
}

export function editBuildDescription(
  workflow: BuildManagementWorkflow,
  item?: BuildTreeItem
): Promise<void> {
  return runOnSelection(workflow, item, "Select a build to edit its description.", (flow, target) =>
    flow.editDescription(target)
  );
}

export function editBuildDisplayName(
  workflow: BuildManagementWorkflow,
  item?: BuildTreeItem
): Promise<void> {
  return runOnSelection(
    workflow,
    item,
    "Select a build to edit its display name.",
    (flow, target) => flow.editDisplayName(target)
  );
}

function resolveJobName(item: BuildTreeItem): string | undefined {
  const parsedBuild = parseBuildUrl(item.buildUrl, item.environment.url);
  if (!parsedBuild) {
    return undefined;
  }
  return parseJobUrl(parsedBuild.jobUrl, item.environment.url)?.jobName;
}
