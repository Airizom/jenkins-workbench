import type * as vscode from "vscode";
import { JenkinsfileIntelligenceConfigState } from "../../jenkinsfile/JenkinsfileIntelligenceConfigState";
import type { JenkinsfileIntelligenceConfig } from "../../jenkinsfile/JenkinsfileIntelligenceTypes";
import { JenkinsfileStepCatalogService } from "../../jenkinsfile/JenkinsfileStepCatalogService";
import { REPLAY_DRAFT_SCHEME } from "../../services/ReplayDraftFilesystem";
import { JenkinsfileEnvironmentResolver } from "../../validation/JenkinsfileEnvironmentResolver";
import { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import { JenkinsfileValidationCoordinator } from "../../validation/JenkinsfileValidationCoordinator";
import { JenkinsfileValidationStatusBar } from "../../validation/JenkinsfileValidationStatusBar";
import type { JenkinsfileValidationConfig } from "../../validation/JenkinsfileValidationTypes";
import type { PartialExtensionProviderCatalog } from "../container/ExtensionContainer";

export interface ValidationProviderOptions {
  context: vscode.ExtensionContext;
  jenkinsfileIntelligenceConfig: JenkinsfileIntelligenceConfig;
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
    jenkinsfileIntelligenceConfigState: (_container) =>
      new JenkinsfileIntelligenceConfigState(options.jenkinsfileIntelligenceConfig),
    jenkinsfileValidationCoordinator: (container) =>
      new JenkinsfileValidationCoordinator(
        container.get("clientProvider"),
        container.get("jenkinsfileEnvironmentResolver"),
        container.get("jenkinsfileValidationStatusBar"),
        container.get("jenkinsfileMatcher"),
        options.jenkinsfileValidationConfig
      ),
    jenkinsfileStepCatalogService: (container) =>
      new JenkinsfileStepCatalogService(
        container.get("clientProvider"),
        container.get("jenkinsfileEnvironmentResolver")
      )
  } satisfies PartialExtensionProviderCatalog;
}
