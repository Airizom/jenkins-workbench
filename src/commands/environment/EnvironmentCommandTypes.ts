import type { FullEnvironmentRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export interface EnvironmentCommandRefreshHost extends FullEnvironmentRefreshHost {
  onEnvironmentRemoved?(environment: JenkinsEnvironmentRef): void;
}

export interface EnvironmentDiagnosticsLauncher {
  show(environment: JenkinsEnvironmentRef): Promise<void>;
}

export interface EnvironmentDiagnosticsOfferOptions {
  diagnostics?: EnvironmentDiagnosticsLauncher;
  suppressDiagnosticsOffer?: boolean;
}
