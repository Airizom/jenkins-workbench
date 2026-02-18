import type * as vscode from "vscode";
import { JenkinsfileEnvironmentResolver } from "../../validation/JenkinsfileEnvironmentResolver";
import { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import { JenkinsfileValidationCoordinator } from "../../validation/JenkinsfileValidationCoordinator";
import { JenkinsfileValidationStatusBar } from "../../validation/JenkinsfileValidationStatusBar";
import type { JenkinsfileValidationConfig } from "../../validation/JenkinsfileValidationTypes";
import type { ExtensionContainer } from "../container/ExtensionContainer";

export interface ValidationProviderOptions {
  context: vscode.ExtensionContext;
  jenkinsfileValidationConfig: JenkinsfileValidationConfig;
}

export function registerValidationProviders(
  container: ExtensionContainer,
  options: ValidationProviderOptions
): void {
  container.register(
    "jenkinsfileEnvironmentResolver",
    () => new JenkinsfileEnvironmentResolver(options.context, container.get("environmentStore"))
  );

  container.register(
    "jenkinsfileMatcher",
    () => new JenkinsfileMatcher(options.jenkinsfileValidationConfig.filePatterns)
  );

  container.register(
    "jenkinsfileValidationStatusBar",
    () => new JenkinsfileValidationStatusBar(container.get("jenkinsfileMatcher"))
  );

  container.register(
    "jenkinsfileValidationCoordinator",
    () =>
      new JenkinsfileValidationCoordinator(
        container.get("clientProvider"),
        container.get("jenkinsfileEnvironmentResolver"),
        container.get("jenkinsfileValidationStatusBar"),
        container.get("jenkinsfileMatcher"),
        options.jenkinsfileValidationConfig
      )
  );
}
