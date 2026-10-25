export function buildTreeEnvironmentKey(scope: string, environmentId: string): string {
  return `${scope}:${environmentId}`;
}

export function deleteTreeEnvironmentKeys(map: Map<string, unknown>, environmentId: string): void {
  const environmentSuffix = `:${environmentId}`;
  for (const key of map.keys()) {
    if (key.endsWith(environmentSuffix)) {
      map.delete(key);
    }
  }
}
