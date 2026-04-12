import type * as vscode from "vscode";
import { REPLAY_DRAFT_SCHEME } from "../../services/ReplayDraftFilesystem";
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
      new JenkinsfileEnvironmentResolver(
        options.context,
        container.get("environmentStore"),
        container.get("replayDraftManager")
      ),
    jenkinsfileMatcher: (_container) =>
      new JenkinsfileMatcher(options.jenkinsfileValidationConfig.filePatterns, [
        "file",
        "untitled",
        REPLAY_DRAFT_SCHEME
      ]),
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
