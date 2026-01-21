import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import type { EnvironmentScope } from "../../storage/JenkinsEnvironmentStore";

export interface JobMetadataStores {
  pinStore: JenkinsPinStore;
  watchStore: JenkinsWatchStore;
}

export interface JobMetadataContext {
  scope: EnvironmentScope;
  environmentId: string;
  jobUrl: string;
}

export async function updateJobMetadataOnRename(
  stores: JobMetadataStores,
  context: JobMetadataContext,
  newJobUrl: string,
  newJobName: string
): Promise<void> {
  await Promise.all([
    stores.pinStore.updatePinUrl(
      context.scope,
      context.environmentId,
      context.jobUrl,
      newJobUrl,
      newJobName
    ),
    stores.watchStore.updateWatchUrl(
      context.scope,
      context.environmentId,
      context.jobUrl,
      newJobUrl,
      newJobName
    )
  ]);
}

export async function removeJobMetadataOnDelete(
  stores: JobMetadataStores,
  context: JobMetadataContext
): Promise<void> {
  await Promise.all([
    stores.pinStore.removePin(context.scope, context.environmentId, context.jobUrl),
    stores.watchStore.removeWatch(context.scope, context.environmentId, context.jobUrl)
  ]);
}
