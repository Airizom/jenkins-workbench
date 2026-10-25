import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { BuildComparePanel } from "./BuildComparePanel";
import { BuildDetailsPanel } from "./BuildDetailsPanel";
import { NodeCapacityPanel } from "./NodeCapacityPanel";
import { NodeDetailsPanel } from "./NodeDetailsPanel";

/**
 * Closes the singleton panels bound to an environment after its URL or TLS policy changes,
 * so reopening resolves the current environment settings. Job History panels close themselves
 * from `JobHistoryPanelLauncher`.
 */
export function closeEnvironmentPanels(
  environment: Pick<JenkinsEnvironmentRef, "environmentId" | "scope">
): void {
  const { scope, environmentId } = environment;
  BuildDetailsPanel.closeForEnvironment(scope, environmentId);
  BuildComparePanel.closeForEnvironment(scope, environmentId);
  NodeDetailsPanel.closeForEnvironment(scope, environmentId);
  NodeCapacityPanel.closeForEnvironment(scope, environmentId);
}
