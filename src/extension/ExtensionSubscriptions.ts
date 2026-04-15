import * as vscode from "vscode";
import type { JenkinsEnvironmentStoreChange } from "../storage/JenkinsEnvironmentStore";
import { BuildQueueFolderTreeItem, InstanceTreeItem, RootSectionTreeItem } from "../tree/TreeItems";
import {
  buildConfigKey,
  getBuildListFetchOptions,
  getBuildTooltipOptions,
  getCacheTtlMs,
  getCurrentBranchPullRequestJobNamePatterns,
  getExtensionConfiguration,
  getJenkinsfileIntelligenceConfig,
  getJenkinsfileValidationConfig,
  getQueuePollIntervalSeconds,
  getStatusRefreshIntervalSeconds,
  getTreeViewCurationOptions,
  getWatchErrorThreshold
} from "./ExtensionConfig";
import type { ExtensionContainer } from "./container/ExtensionContainer";
import type { ExtensionTokenMap } from "./container/ExtensionTokenMap";
import { syncJenkinsfileContext } from "./contextKeys";

const CACHE_TTL_CONFIG_KEY = "cacheTtlSeconds";
const STATUS_REFRESH_INTERVAL_CONFIG_KEY = "pollIntervalSeconds";
const WATCH_ERROR_THRESHOLD_CONFIG_KEY = "watchErrorThreshold";
const QUEUE_POLL_INTERVAL_CONFIG_KEY = "queuePollIntervalSeconds";
const CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS_CONFIG_KEY =
  "currentBranch.pullRequestJobNamePatterns";
const BUILD_TOOLTIP_DETAILS_CONFIG_KEY = "buildTooltips.includeDetails";
const BUILD_TOOLTIP_PARAMETERS_ENABLED_CONFIG_KEY = "buildTooltips.parameters.enabled";
const BUILD_TOOLTIP_PARAMETERS_ALLOW_LIST_CONFIG_KEY = "buildTooltips.parameters.allowList";
const BUILD_TOOLTIP_PARAMETERS_DENY_LIST_CONFIG_KEY = "buildTooltips.parameters.denyList";
const BUILD_TOOLTIP_PARAMETERS_MASK_PATTERNS_CONFIG_KEY = "buildTooltips.parameters.maskPatterns";
const BUILD_TOOLTIP_PARAMETERS_MASK_VALUE_CONFIG_KEY = "buildTooltips.parameters.maskValue";
const TREE_VIEWS_EXCLUDED_NAMES_CONFIG_KEY = "treeViews.excludedNames";
const JENKINSFILE_VALIDATION_ENABLED_CONFIG_KEY = "jenkinsfileValidation.enabled";
const JENKINSFILE_VALIDATION_RUN_ON_SAVE_CONFIG_KEY = "jenkinsfileValidation.runOnSave";
const JENKINSFILE_VALIDATION_CHANGE_DEBOUNCE_CONFIG_KEY = "jenkinsfileValidation.changeDebounceMs";
const JENKINSFILE_VALIDATION_FILE_PATTERNS_CONFIG_KEY = "jenkinsfileValidation.filePatterns";
const JENKINSFILE_INTELLIGENCE_ENABLED_CONFIG_KEY = "jenkinsfile.intelligence.enabled";

const BUILD_TOOLTIP_CONFIG_KEYS = [
  BUILD_TOOLTIP_DETAILS_CONFIG_KEY,
  BUILD_TOOLTIP_PARAMETERS_ENABLED_CONFIG_KEY,
  BUILD_TOOLTIP_PARAMETERS_ALLOW_LIST_CONFIG_KEY,
  BUILD_TOOLTIP_PARAMETERS_DENY_LIST_CONFIG_KEY,
  BUILD_TOOLTIP_PARAMETERS_MASK_PATTERNS_CONFIG_KEY,
  BUILD_TOOLTIP_PARAMETERS_MASK_VALUE_CONFIG_KEY
] as const;

const JENKINSFILE_VALIDATION_CONFIG_KEYS = [
  JENKINSFILE_VALIDATION_ENABLED_CONFIG_KEY,
  JENKINSFILE_VALIDATION_RUN_ON_SAVE_CONFIG_KEY,
  JENKINSFILE_VALIDATION_CHANGE_DEBOUNCE_CONFIG_KEY,
  JENKINSFILE_VALIDATION_FILE_PATTERNS_CONFIG_KEY
] as const;

type BuildTooltipConfigKey = (typeof BUILD_TOOLTIP_CONFIG_KEYS)[number];
type JenkinsfileValidationConfigKey = (typeof JENKINSFILE_VALIDATION_CONFIG_KEYS)[number];
type ConfigReactionKey =
  | typeof CACHE_TTL_CONFIG_KEY
  | typeof STATUS_REFRESH_INTERVAL_CONFIG_KEY
  | typeof WATCH_ERROR_THRESHOLD_CONFIG_KEY
  | typeof QUEUE_POLL_INTERVAL_CONFIG_KEY
  | typeof CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS_CONFIG_KEY
  | typeof TREE_VIEWS_EXCLUDED_NAMES_CONFIG_KEY
  | typeof JENKINSFILE_INTELLIGENCE_ENABLED_CONFIG_KEY
  | BuildTooltipConfigKey
  | JenkinsfileValidationConfigKey;

interface ConfigReactionContext {
  config: vscode.WorkspaceConfiguration;
  coverageService: ExtensionTokenMap["coverageService"];
  dataService: ExtensionTokenMap["dataService"];
  refreshHost: ExtensionTokenMap["refreshHost"];
  treeDataProvider: ExtensionTokenMap["treeDataProvider"];
  statusRefreshService: ExtensionTokenMap["statusRefreshService"];
  poller: ExtensionTokenMap["poller"];
  queuePoller: ExtensionTokenMap["queuePoller"];
  currentBranchPullRequestJobMatcher: ExtensionTokenMap["currentBranchPullRequestJobMatcher"];
  currentBranchService: ExtensionTokenMap["currentBranchService"];
  jenkinsfileIntelligenceConfigState: ExtensionTokenMap["jenkinsfileIntelligenceConfigState"];
  jenkinsfileValidationCoordinator: ExtensionTokenMap["jenkinsfileValidationCoordinator"];
  jenkinsfileMatcher: ExtensionTokenMap["jenkinsfileMatcher"];
}

interface ConfigReaction {
  keys: readonly ConfigReactionKey[];
  run: (context: ConfigReactionContext, changedKeys: ReadonlySet<ConfigReactionKey>) => void;
}

interface ConfigReactionMatch {
  reaction: ConfigReaction;
  changedKeys: ReadonlySet<ConfigReactionKey>;
}

function resolveConfigReactionMatches(
  event: vscode.ConfigurationChangeEvent,
  reactions: readonly ConfigReaction[]
): ConfigReactionMatch[] {
  const matches: ConfigReactionMatch[] = [];
  for (const reaction of reactions) {
    const changedKeys = new Set<ConfigReactionKey>();
    for (const key of reaction.keys) {
      if (event.affectsConfiguration(buildConfigKey(key))) {
        changedKeys.add(key);
      }
    }
    if (changedKeys.size > 0) {
      matches.push({
        reaction,
        changedKeys
      });
    }
  }
  return matches;
}

export function registerExtensionSubscriptions(
  context: vscode.ExtensionContext,
  container: ExtensionContainer
): void {
  const viewStateStore = container.get("viewStateStore");
  const environmentStore = container.get("environmentStore");
  const treeDataProvider = container.get("treeDataProvider");
  const treeView = container.get("treeView");
  const dataService = container.get("dataService");
  const coverageService = container.get("coverageService");
  const refreshHost = container.get("refreshHost");
  const statusRefreshService = container.get("statusRefreshService");
  const poller = container.get("poller");
  const queuePoller = container.get("queuePoller");
  const currentBranchPullRequestJobMatcher = container.get("currentBranchPullRequestJobMatcher");
  const currentBranchService = container.get("currentBranchService");
  const jenkinsfileValidationCoordinator = container.get("jenkinsfileValidationCoordinator");
  const jenkinsfileIntelligenceConfigState = container.get("jenkinsfileIntelligenceConfigState");
  const jenkinsfileMatcher = container.get("jenkinsfileMatcher");
  const jenkinsfileStepCatalogService = container.get("jenkinsfileStepCatalogService");

  const configReactions: ConfigReaction[] = [
    {
      keys: [CACHE_TTL_CONFIG_KEY],
      run: (reactionContext) => {
        reactionContext.dataService.updateCacheTtlMs(getCacheTtlMs(reactionContext.config));
        reactionContext.coverageService.updateCacheTtlMs(getCacheTtlMs(reactionContext.config));
        reactionContext.refreshHost.fullEnvironmentRefresh({ trigger: "system" });
      }
    },
    {
      keys: [STATUS_REFRESH_INTERVAL_CONFIG_KEY],
      run: (reactionContext) => {
        reactionContext.statusRefreshService.updateRefreshIntervalSeconds(
          getStatusRefreshIntervalSeconds(reactionContext.config)
        );
      }
    },
    {
      keys: [WATCH_ERROR_THRESHOLD_CONFIG_KEY],
      run: (reactionContext) => {
        reactionContext.poller.updateMaxConsecutiveErrors(
          getWatchErrorThreshold(reactionContext.config)
        );
      }
    },
    {
      keys: [QUEUE_POLL_INTERVAL_CONFIG_KEY],
      run: (reactionContext) => {
        reactionContext.queuePoller.updatePollIntervalSeconds(
          getQueuePollIntervalSeconds(reactionContext.config)
        );
      }
    },
    {
      keys: [CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS_CONFIG_KEY],
      run: (reactionContext) => {
        reactionContext.currentBranchPullRequestJobMatcher.updatePatterns(
          getCurrentBranchPullRequestJobNamePatterns(reactionContext.config)
        );
        void reactionContext.currentBranchService.refresh({ force: true });
      }
    },
    {
      keys: BUILD_TOOLTIP_CONFIG_KEYS,
      run: (reactionContext, changedKeys) => {
        reactionContext.treeDataProvider.updateBuildTooltipOptions(
          getBuildTooltipOptions(reactionContext.config)
        );
        reactionContext.treeDataProvider.updateBuildListFetchOptions(
          getBuildListFetchOptions(reactionContext.config)
        );
        const shouldClearDataCache =
          changedKeys.has(BUILD_TOOLTIP_DETAILS_CONFIG_KEY) ||
          changedKeys.has(BUILD_TOOLTIP_PARAMETERS_ENABLED_CONFIG_KEY);
        reactionContext.refreshHost.refreshViewOnly({
          clearDataCache: shouldClearDataCache
        });
      }
    },
    {
      keys: [TREE_VIEWS_EXCLUDED_NAMES_CONFIG_KEY],
      run: (reactionContext) => {
        reactionContext.treeDataProvider.updateViewCurationOptions(
          getTreeViewCurationOptions(reactionContext.config)
        );
        reactionContext.refreshHost.refreshViewOnly();
      }
    },
    {
      keys: [JENKINSFILE_INTELLIGENCE_ENABLED_CONFIG_KEY],
      run: (reactionContext) => {
        reactionContext.jenkinsfileIntelligenceConfigState.updateConfig(
          getJenkinsfileIntelligenceConfig(reactionContext.config)
        );
      }
    },
    {
      keys: JENKINSFILE_VALIDATION_CONFIG_KEYS,
      run: (reactionContext) => {
        reactionContext.jenkinsfileValidationCoordinator.updateConfig(
          getJenkinsfileValidationConfig(reactionContext.config)
        );
        void syncJenkinsfileContext(reactionContext.jenkinsfileMatcher);
      }
    }
  ];

  const viewStateSubscription = viewStateStore.onDidChange(() => {
    refreshHost.refreshViewOnly();
  });

  const environmentStoreSubscription = environmentStore.onDidChange((change) => {
    invalidateJenkinsfileStepCatalog(jenkinsfileStepCatalogService, change);
  });

  const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
    const matches = resolveConfigReactionMatches(event, configReactions);
    if (matches.length === 0) {
      return;
    }

    const reactionContext: ConfigReactionContext = {
      config: getExtensionConfiguration(),
      coverageService,
      dataService,
      refreshHost,
      statusRefreshService,
      treeDataProvider,
      poller,
      queuePoller,
      currentBranchPullRequestJobMatcher,
      currentBranchService,
      jenkinsfileIntelligenceConfigState,
      jenkinsfileValidationCoordinator,
      jenkinsfileMatcher
    };

    for (const match of matches) {
      match.reaction.run(reactionContext, match.changedKeys);
    }
  });

  const expandSubscription = treeView.onDidExpandElement((event) => {
    if (event.element instanceof BuildQueueFolderTreeItem) {
      queuePoller.trackExpanded(event.element.environment);
    }
  });

  const collapseSubscription = treeView.onDidCollapseElement((event) => {
    if (event.element instanceof BuildQueueFolderTreeItem) {
      queuePoller.trackCollapsed(event.element.environment);
      return;
    }
    if (event.element instanceof InstanceTreeItem) {
      queuePoller.clearEnvironment(event.element);
      return;
    }
    if (event.element instanceof RootSectionTreeItem && event.element.section === "instances") {
      queuePoller.clearAll();
    }
  });

  context.subscriptions.push(
    viewStateSubscription,
    environmentStoreSubscription,
    configSubscription,
    expandSubscription,
    collapseSubscription
  );
}

function invalidateJenkinsfileStepCatalog(
  jenkinsfileStepCatalogService: ExtensionTokenMap["jenkinsfileStepCatalogService"],
  change: JenkinsEnvironmentStoreChange
): void {
  switch (change.kind) {
    case "bulk-update":
      jenkinsfileStepCatalogService.invalidateAll();
      return;
    case "environment-added":
    case "environment-removed":
    case "auth-config-updated":
    case "auth-config-deleted":
      jenkinsfileStepCatalogService.invalidateEnvironment({
        scope: change.scope,
        environmentId: change.environmentId
      });
      return;
  }
}
