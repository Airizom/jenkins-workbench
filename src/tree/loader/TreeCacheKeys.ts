import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export type TreeChildrenKeyBuilder = (
  kind: string,
  environment: JenkinsEnvironmentRef,
  extra?: string
) => string;

export function buildScopedEnvironmentKey(environment: JenkinsEnvironmentRef): string {
  return `${environment.scope}:${environment.environmentId}`;
}

export function isEnvironmentScopedChildKey(key: string, environmentId: string): boolean {
  const environmentIdLength = environmentId.length;
  if (key.startsWith(environmentId) && key[environmentIdLength] === ":") {
    return true;
  }

  const firstSeparator = key.indexOf(":");
  const secondSeparator = key.indexOf(":", firstSeparator + 1);
  if (firstSeparator < 0 || secondSeparator < 0) {
    return false;
  }
  return (
    secondSeparator - firstSeparator - 1 === environmentIdLength &&
    key.startsWith(environmentId, firstSeparator + 1)
  );
}
