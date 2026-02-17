import type { EnvironmentScope } from "../../storage/JenkinsEnvironmentStore";
import type { JenkinsParameterPresetStore } from "../../storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";

export interface JobMetadataStores {
  presetStore: JenkinsParameterPresetStore;
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
    stores.presetStore.updatePresetUrl(
      context.scope,
      context.environmentId,
      context.jobUrl,
      newJobUrl
    ),
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
    stores.presetStore.removePresetsForJob(context.scope, context.environmentId, context.jobUrl),
    stores.pinStore.removePin(context.scope, context.environmentId, context.jobUrl),
    stores.watchStore.removeWatch(context.scope, context.environmentId, context.jobUrl)
  ]);
}
