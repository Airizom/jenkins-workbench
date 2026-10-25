import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";

export interface CurrentBranchEnvironmentIdentity {
  environmentId: string;
  scope: string;
}

export async function resolveCurrentBranchEnvironmentRef(
  environmentStore: JenkinsEnvironmentStore,
  environment: CurrentBranchEnvironmentIdentity
): Promise<JenkinsEnvironmentRef | undefined> {
  const environments = await environmentStore.listEnvironmentsWithScope();
  const match = environments.find(
    (entry) => entry.id === environment.environmentId && entry.scope === environment.scope
  );
  if (!match) {
    return undefined;
  }

  return toJenkinsEnvironmentRef(match);
}
