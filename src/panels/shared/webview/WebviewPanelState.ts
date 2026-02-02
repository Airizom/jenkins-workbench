import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import type {
  EnvironmentScope,
  JenkinsEnvironmentStore
} from "../../../storage/JenkinsEnvironmentStore";

export interface SerializedEnvironmentState {
  environmentId: string;
  scope: EnvironmentScope;
}

const VALID_SCOPES = new Set<EnvironmentScope>(["workspace", "global"]);

export function isEnvironmentScope(value: unknown): value is EnvironmentScope {
  return VALID_SCOPES.has(value as EnvironmentScope);
}

export function isSerializedEnvironmentState(
  value: unknown
): value is SerializedEnvironmentState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.environmentId === "string" &&
    record.environmentId.length > 0 &&
    isEnvironmentScope(record.scope)
  );
}

export async function resolveEnvironmentRef(
  store: JenkinsEnvironmentStore,
  state: SerializedEnvironmentState
): Promise<JenkinsEnvironmentRef | undefined> {
  const environments = await store.getEnvironments(state.scope);
  const match = environments.find((environment) => environment.id === state.environmentId);
  if (!match) {
    return undefined;
  }
  return {
    environmentId: match.id,
    scope: state.scope,
    url: match.url,
    username: match.username
  };
}
