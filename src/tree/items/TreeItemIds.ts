import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { buildTreeJobScopeKey, type TreeJobScope } from "../TreeJobScope";

export function buildEnvironmentTreeItemId(
  kind: string,
  environment: JenkinsEnvironmentRef,
  ...parts: Array<string | number | TreeJobScope>
): string {
  let id = `${kind}:${environment.scope}:${environment.environmentId}`;
  for (const part of parts) {
    id += `:${typeof part === "object" ? buildTreeJobScopeKey(part) : part}`;
  }
  return id;
}
