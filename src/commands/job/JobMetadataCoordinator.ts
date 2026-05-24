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

export interface JobMetadataUpdateResult {
  failures: unknown[];
}

type JobMetadataOperation = () => Promise<unknown>;

async function settleJobMetadataOperations(
  operations: JobMetadataOperation[]
): Promise<JobMetadataUpdateResult> {
  const results = await Promise.allSettled(
    operations.map((operation) => Promise.resolve().then(operation))
  );

  return {
    failures: results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
  };
}

export async function updateJobMetadataOnRename(
  stores: JobMetadataStores,
  context: JobMetadataContext,
  newJobUrl: string,
  newJobName: string
): Promise<JobMetadataUpdateResult> {
  return settleJobMetadataOperations([
    () =>
      stores.presetStore.updatePresetUrl(
        context.scope,
        context.environmentId,
        context.jobUrl,
        newJobUrl
      ),
    () =>
      stores.pinStore.updatePinUrl(
        context.scope,
        context.environmentId,
        context.jobUrl,
        newJobUrl,
        newJobName
      ),
    () =>
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
): Promise<JobMetadataUpdateResult> {
  return settleJobMetadataOperations([
    () =>
      stores.presetStore.removePresetsForJob(context.scope, context.environmentId, context.jobUrl),
    () => stores.pinStore.removePin(context.scope, context.environmentId, context.jobUrl),
    () => stores.watchStore.removeWatch(context.scope, context.environmentId, context.jobUrl)
  ]);
}
