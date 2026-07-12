import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { type TreeJobScope, buildTreeJobScopeKey } from "../TreeJobScope";

export function buildEnvironmentTreeItemId(
  kind: string,
  environment: JenkinsEnvironmentRef,
  ...parts: Array<string | number | TreeJobScope>
): string {
  return [
    kind,
    environment.scope,
    environment.environmentId,
    ...parts.map((part) => (typeof part === "object" ? buildTreeJobScopeKey(part) : part))
  ].join(":");
}
