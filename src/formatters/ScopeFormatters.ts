import type { EnvironmentScope } from "../storage/JenkinsEnvironmentStore";

export function formatScopeLabel(scope: EnvironmentScope): string {
  return scope === "workspace" ? "Workspace" : "Global";
}
