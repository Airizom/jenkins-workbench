import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export function buildScopedEnvironmentKey(environment: JenkinsEnvironmentRef): string {
  return `${environment.scope}:${environment.environmentId}`;
}

export function isEnvironmentScopedChildKey(key: string, environmentId: string): boolean {
  if (key.startsWith(`${environmentId}:`)) {
    return true;
  }

  const firstSeparator = key.indexOf(":");
  const secondSeparator = key.indexOf(":", firstSeparator + 1);
  if (firstSeparator < 0 || secondSeparator < 0) {
    return false;
  }
  return key.slice(firstSeparator + 1, secondSeparator) === environmentId;
}
