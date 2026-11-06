import { toJenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash, rebaseEnvironmentUrl } from "../../jenkins/urls";
import type { JenkinsEnvironmentStore } from "../../storage/JenkinsEnvironmentStore";
import type { MultibranchScanTarget } from "./MultibranchScanState";

/** Notifications can retain a target after its environment was edited or removed. */
export async function resolveMultibranchScanTarget(
  target: MultibranchScanTarget,
  store: Pick<JenkinsEnvironmentStore, "listEnvironmentsWithScope">
): Promise<MultibranchScanTarget> {
  const environments = await store.listEnvironmentsWithScope();
  const current = environments.find(
    (entry) =>
      entry.id === target.environment.environmentId && entry.scope === target.environment.scope
  );
  if (!current) {
    throw new Error("The Jenkins environment no longer exists.");
  }
  const folderUrl =
    rebaseEnvironmentUrl(target.folderUrl, current.previousUrls ?? [], current.url) ??
    target.folderUrl;
  if (!folderUrl.startsWith(ensureTrailingSlash(current.url))) {
    throw new Error(
      "The Jenkins environment URL changed. Open View Scan Log from the current multibranch folder."
    );
  }
  return { ...target, environment: toJenkinsEnvironmentRef(current), folderUrl };
}
