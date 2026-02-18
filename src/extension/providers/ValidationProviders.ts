import type * as vscode from "vscode";
import { JenkinsfileEnvironmentResolver } from "../../validation/JenkinsfileEnvironmentResolver";
import { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import { JenkinsfileValidationCoordinator } from "../../validation/JenkinsfileValidationCoordinator";
import { JenkinsfileValidationStatusBar } from "../../validation/JenkinsfileValidationStatusBar";
import type { JenkinsfileValidationConfig } from "../../validation/JenkinsfileValidationTypes";
import type { PartialExtensionProviderCatalog } from "../container/ExtensionContainer";

export interface ValidationProviderOptions {
  context: vscode.ExtensionContext;
  jenkinsfileValidationConfig: JenkinsfileValidationConfig;
}

export function createValidationProviderCatalog(options: ValidationProviderOptions) {
  return {
    jenkinsfileEnvironmentResolver: (container) =>
      new JenkinsfileEnvironmentResolver(options.context, container.get("environmentStore")),
    jenkinsfileMatcher: (_container) =>
      new JenkinsfileMatcher(options.jenkinsfileValidationConfig.filePatterns),
    jenkinsfileValidationStatusBar: (container) =>
      new JenkinsfileValidationStatusBar(container.get("jenkinsfileMatcher")),
    jenkinsfileValidationCoordinator: (container) =>
      new JenkinsfileValidationCoordinator(
        container.get("clientProvider"),
        container.get("jenkinsfileEnvironmentResolver"),
        container.get("jenkinsfileValidationStatusBar"),
        container.get("jenkinsfileMatcher"),
        options.jenkinsfileValidationConfig
      )
  } satisfies PartialExtensionProviderCatalog;
}
