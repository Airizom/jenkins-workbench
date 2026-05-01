import type { BuildCommandRefreshHost } from "./BuildCommandTypes";

export function refreshEnvironment(
  refreshHost: BuildCommandRefreshHost,
  environmentId: string
): void {
  refreshHost.fullEnvironmentRefresh({ environmentId });
}
