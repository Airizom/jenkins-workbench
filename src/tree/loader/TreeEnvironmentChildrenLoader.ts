import * as vscode from "vscode";
import { formatEnvironmentDisplayName } from "../../jenkins/EnvironmentLabels";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { getUrlOrigin } from "../../jenkins/urls";
import type {
  EnvironmentSignInRequirement,
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { ActivityDisplaySummary } from "../ActivityTypes";
import type { EnvironmentSummaryStore } from "../EnvironmentSummaryStore";
import { JenkinsViewTreeItem } from "../items/TreeJobItems";
import { NodeTreeItem } from "../items/TreeNodeItems";
import { PlaceholderTreeItem } from "../items/TreePlaceholderItem";
import {
  ActivityFolderTreeItem,
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  type InstanceTreeItemIssue,
  JobsFolderTreeItem,
  NodesFolderTreeItem,
  PinnedJobsFolderTreeItem,
  ViewsFolderTreeItem
} from "../items/TreeRootItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import { buildTreeEnvironmentKey } from "../TreeEnvironmentKeys";
import { curateTreeViews, type TreeViewCurationOptions } from "../TreeViewCuration";
import { mapQueueItemsToTreeItems } from "./TreeChildrenMapping";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

const SIGN_IN_ICON = new vscode.ThemeIcon("sign-in");

export class TreeEnvironmentChildrenLoader {
  /** Environments rendered as needing sign-in by the last root load. */
  private signInRequired = new Set<string>();

  constructor(
    private readonly store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly pinStore: JenkinsPinStore,
    private readonly environmentSummaryStore: EnvironmentSummaryStore,
    private readonly getViewCurationOptions: () => TreeViewCurationOptions,
    private readonly getActivitySummary: (
      environment: JenkinsEnvironmentRef
    ) => ActivityDisplaySummary | undefined,
    private readonly placeholders: TreePlaceholderFactory
  ) {}

  async getInstanceItems(
    resolveIssue?: (environment: EnvironmentWithScope) => InstanceTreeItemIssue | undefined
  ): Promise<WorkbenchTreeElement[]> {
    // An empty root lets VS Code render the "Connect your first Jenkins environment" welcome view.
    const environments = await this.store.listEnvironmentsWithScope();
    const requirements = await Promise.all(
      environments.map((environment) => this.resolveSignInRequirement(environment))
    );
    this.signInRequired = new Set(
      environments
        .filter((_environment, index) => requirements[index] !== "none")
        .map((environment) => buildTreeEnvironmentKey(environment.scope, environment.id))
    );
    return environments.map(
      (environment, index) =>
        new InstanceTreeItem(environment, resolveIssue?.(environment), {
          signInRequirement: requirements[index]
        })
    );
  }

  /** Whether the environment was last rendered with a sign-in row instead of its contents. */
  isSignInRequired(environment: Pick<JenkinsEnvironmentRef, "scope" | "environmentId">): boolean {
    return this.signInRequired.has(
      buildTreeEnvironmentKey(environment.scope, environment.environmentId)
    );
  }

  async getInstanceChildren(element: InstanceTreeItem): Promise<WorkbenchTreeElement[]> {
    if (element.signInRequirement !== "none") {
      // Nothing under the environment loads until the user signs in.
      return [createSignInItem(element)];
    }
    const summary = this.environmentSummaryStore.get(element);
    const pinnedEntries = await this.pinStore.listPinnedJobsForEnvironment(
      element.scope,
      element.environmentId
    );
    const items: WorkbenchTreeElement[] = [];
    if (pinnedEntries.length > 0) {
      items.push(new PinnedJobsFolderTreeItem(element, pinnedEntries.length));
    }
    items.push(
      new ActivityFolderTreeItem(element, this.getActivitySummary(element)),
      new ViewsFolderTreeItem(element),
      new JobsFolderTreeItem(element, summary?.jobs),
      new BuildQueueFolderTreeItem(element, summary?.queue),
      new NodesFolderTreeItem(element, summary?.nodes)
    );
    return items;
  }

  private async resolveSignInRequirement(
    environment: EnvironmentWithScope
  ): Promise<EnvironmentSignInRequirement> {
    try {
      return await this.store.getSignInRequirement(environment.scope, environment.id);
    } catch (error) {
      console.warn("Failed to resolve Jenkins environment sign-in state.", error);
      return "none";
    }
  }

  async loadViewsForEnvironment(
    environment: JenkinsEnvironmentRef
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const allViews = await this.dataService.getViewsForEnvironment(environment);
      const views = curateTreeViews(allViews, this.getViewCurationOptions());
      if (views.length === 0) {
        return [
          allViews.length > 0
            ? this.placeholders.createEmptyPlaceholder(
                "All views are hidden.",
                "Click to edit the hidden view names.",
                {
                  command: {
                    command: "workbench.action.openSettings",
                    title: "Edit Hidden Views",
                    arguments: ["jenkinsWorkbench.treeViews.excludedNames"]
                  }
                }
              )
            : this.placeholders.createEmptyPlaceholder("No views", "This Jenkins has no views.")
        ];
      }

      return views.map((view) => new JenkinsViewTreeItem(environment, view.name, view.url));
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load views.", error)];
    }
  }

  async loadNodes(
    environment: JenkinsEnvironmentRef,
    isCurrentLoad: () => boolean = () => true
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const nodes = await this.dataService.getNodes(environment);
      if (isCurrentLoad()) {
        this.environmentSummaryStore.updateFromNodes(environment, nodes);
      }
      if (nodes.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "No nodes found.",
            "This instance has no build agents."
          )
        ];
      }
      return nodes.map((node) => new NodeTreeItem(environment, node));
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load nodes.", error)];
    }
  }

  async loadQueueForEnvironment(
    environment: JenkinsEnvironmentRef,
    isCurrentLoad: () => boolean = () => true
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const items = await this.dataService.getQueueItems(environment);
      if (isCurrentLoad()) {
        this.environmentSummaryStore.updateFromQueue(environment, items);
      }
      if (items.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "Build queue is empty.",
            "No items are waiting to run."
          )
        ];
      }
      return mapQueueItemsToTreeItems(environment, items);
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load build queue.", error)];
    }
  }
}

function createSignInItem(environment: InstanceTreeItem): PlaceholderTreeItem {
  const origin = getUrlOrigin(environment.url) ?? environment.url;
  const connectOnly =
    environment.signInRequirement === "confirm-origin" && environment.authHint?.type === "none";
  const label = connectOnly
    ? `Connect to ${origin}…`
    : `Sign in to ${formatEnvironmentDisplayName(environment)} (${origin})…`;
  const hint =
    environment.signInRequirement === "confirm-origin"
      ? "This environment comes from settings. Confirm the server before Jenkins Workbench connects to it."
      : "Enter credentials before Jenkins Workbench connects to this environment.";
  const ref: JenkinsEnvironmentRef = {
    environmentId: environment.environmentId,
    scope: environment.scope,
    url: environment.url,
    ...(environment.name ? { name: environment.name } : {}),
    ...(environment.username ? { username: environment.username } : {})
  };
  return new PlaceholderTreeItem(label, undefined, "empty", {
    icon: SIGN_IN_ICON,
    hint,
    command: {
      command: "jenkinsWorkbench.signInToEnvironment",
      title: connectOnly ? "Connect" : "Sign In",
      arguments: [ref]
    }
  });
}
