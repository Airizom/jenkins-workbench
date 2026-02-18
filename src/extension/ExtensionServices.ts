import type * as vscode from "vscode";
import type { BuildListFetchOptions } from "../jenkins/JenkinsDataService";
import type { BuildTooltipOptions } from "../tree/BuildTooltips";
import type { ArtifactActionOptionsProvider } from "../ui/ArtifactActionHandler";
import type { ArtifactPreviewProviderOptions } from "../ui/ArtifactPreviewProvider";
import type { ArtifactPreviewOptionsProvider } from "../ui/ArtifactPreviewer";
import type { JenkinsfileValidationConfig } from "../validation/JenkinsfileValidationTypes";
import type { ExtensionContainer } from "./container/ExtensionContainer";
import { registerCoreProviders } from "./providers/CoreProviders";
import { registerRuntimeProviders } from "./providers/RuntimeProviders";
import { registerTreeProviders } from "./providers/TreeProviders";
import { registerValidationProviders } from "./providers/ValidationProviders";

export interface ExtensionServicesOptions {
  cacheTtlMs: number;
  maxCacheEntries: number;
  requestTimeoutMs: number;
  buildTooltipOptions: BuildTooltipOptions;
  buildListFetchOptions: BuildListFetchOptions;
  artifactActionOptionsProvider: ArtifactActionOptionsProvider;
  artifactPreviewOptionsProvider: ArtifactPreviewOptionsProvider;
  artifactPreviewCacheOptions: ArtifactPreviewProviderOptions;
  jenkinsfileValidationConfig: JenkinsfileValidationConfig;
}

export interface ExtensionRuntimeOptions extends ExtensionServicesOptions {
  extensionUri: vscode.Uri;
  pollIntervalSeconds: number;
  watchErrorThreshold: number;
  queuePollIntervalSeconds: number;
}

export function registerExtensionProviders(
  container: ExtensionContainer,
  context: vscode.ExtensionContext,
  options: ExtensionRuntimeOptions
): void {
  registerCoreProviders(container, {
    context,
    cacheTtlMs: options.cacheTtlMs,
    maxCacheEntries: options.maxCacheEntries,
    requestTimeoutMs: options.requestTimeoutMs,
    artifactActionOptionsProvider: options.artifactActionOptionsProvider,
    artifactPreviewOptionsProvider: options.artifactPreviewOptionsProvider,
    artifactPreviewCacheOptions: options.artifactPreviewCacheOptions
  });

  registerTreeProviders(container, {
    buildTooltipOptions: options.buildTooltipOptions,
    buildListFetchOptions: options.buildListFetchOptions
  });

  registerValidationProviders(container, {
    context,
    jenkinsfileValidationConfig: options.jenkinsfileValidationConfig
  });

  registerRuntimeProviders(container, {
    extensionUri: options.extensionUri,
    pollIntervalSeconds: options.pollIntervalSeconds,
    watchErrorThreshold: options.watchErrorThreshold,
    queuePollIntervalSeconds: options.queuePollIntervalSeconds
  });
}
