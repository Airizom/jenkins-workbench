import type * as vscode from "vscode";
import { JenkinsfileIntelligenceDocumentScope } from "../../jenkinsfile/editor/JenkinsfileIntelligenceDocumentScope";
import { JenkinsfileIntelligenceConfigState } from "../../jenkinsfile/JenkinsfileIntelligenceConfigState";
import type { JenkinsfileIntelligenceConfig } from "../../jenkinsfile/JenkinsfileIntelligenceTypes";
import { JenkinsfileStepCatalogService } from "../../jenkinsfile/JenkinsfileStepCatalogService";
import { JenkinsfileDocumentCatalogResolver } from "../../jenkinsfile/sharedLibraries/JenkinsfileDocumentCatalogResolver";
import { JenkinsSharedLibraryIndex } from "../../jenkinsfile/sharedLibraries/JenkinsSharedLibraryIndex";
import { REPLAY_DRAFT_SCHEME } from "../../services/ReplayDraftFilesystem";
import { JenkinsfileEnvironmentResolver } from "../../validation/JenkinsfileEnvironmentResolver";
import { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import { JenkinsfileValidationCoordinator } from "../../validation/JenkinsfileValidationCoordinator";
import { JenkinsfileValidationStateStore } from "../../validation/JenkinsfileValidationStateStore";
import { JenkinsfileValidationStatusBar } from "../../validation/JenkinsfileValidationStatusBar";
import type { JenkinsfileValidationConfig } from "../../validation/JenkinsfileValidationTypes";
import type { PartialExtensionProviderCatalog } from "../container/ExtensionContainer";
import { getExtensionConfiguration } from "../ExtensionConfig";
import { getJenkinsfileSharedLibraryEntries } from "../JenkinsfileExtensionConfig";

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
    jenkinsfileValidationStateStore: (_container) => new JenkinsfileValidationStateStore(),
    jenkinsfileValidationStatusBar: (container) =>
      new JenkinsfileValidationStatusBar(
        container.get("jenkinsfileMatcher"),
        container.get("jenkinsfileValidationStateStore")
      ),
    jenkinsfileIntelligenceConfigState: (_container) =>
      new JenkinsfileIntelligenceConfigState(options.jenkinsfileIntelligenceConfig),
    jenkinsfileValidationCoordinator: (container) =>
      new JenkinsfileValidationCoordinator(
        container.get("clientProvider"),
        container.get("jenkinsfileEnvironmentResolver"),
        container.get("jenkinsfileValidationStateStore"),
        container.get("jenkinsfileValidationStatusBar"),
        container.get("jenkinsfileMatcher"),
        options.jenkinsfileValidationConfig
      ),
    jenkinsfileStepCatalogService: (container) =>
      new JenkinsfileStepCatalogService(
        container.get("clientProvider"),
        container.get("jenkinsfileEnvironmentResolver")
      ),
    // Reads the setting on each (lazy) load, so a config reaction only has to invalidate it.
    jenkinsSharedLibraryIndex: (_container) =>
      new JenkinsSharedLibraryIndex(() =>
        getJenkinsfileSharedLibraryEntries(getExtensionConfiguration())
      ),
    jenkinsfileDocumentCatalogResolver: (container) =>
      new JenkinsfileDocumentCatalogResolver(
        container.get("jenkinsfileStepCatalogService"),
        container.get("jenkinsSharedLibraryIndex")
      ),
    jenkinsfileIntelligenceDocumentScope: (container) =>
      new JenkinsfileIntelligenceDocumentScope(
        container.get("jenkinsfileMatcher"),
        container.get("jenkinsSharedLibraryIndex")
      )
  } satisfies PartialExtensionProviderCatalog;
}
