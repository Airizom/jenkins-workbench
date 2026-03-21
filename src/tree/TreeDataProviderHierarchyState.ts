import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { WorkbenchTreeElement } from "./TreeItems";
import { InstanceTreeItem, RootSectionTreeItem } from "./TreeItems";

export class TreeDataProviderHierarchyState {
  private readonly parentMap = new WeakMap<
    WorkbenchTreeElement,
    WorkbenchTreeElement | undefined
  >();
  private readonly instanceItems = new Map<string, InstanceTreeItem>();

  getParent(element: WorkbenchTreeElement): WorkbenchTreeElement | undefined {
    return this.parentMap.get(element);
  }

  withParent(
    parent: WorkbenchTreeElement | undefined,
    children: WorkbenchTreeElement[]
  ): WorkbenchTreeElement[] {
    if (parent instanceof RootSectionTreeItem && parent.section === "instances") {
      this.instanceItems.clear();
    }

    for (const child of children) {
      this.parentMap.set(child, parent);
      if (child instanceof InstanceTreeItem) {
        this.instanceItems.set(this.buildEnvironmentKey(child), child);
      }
    }

    return children;
  }

  notifyEnvironmentInstance(environment: JenkinsEnvironmentRef): InstanceTreeItem | undefined {
    const key = this.buildEnvironmentKey(environment);
    return this.instanceItems.get(key);
  }

  clearEnvironment(environmentId?: string): void {
    if (environmentId) {
      for (const key of this.instanceItems.keys()) {
        if (key.endsWith(`:${environmentId}`)) {
          this.instanceItems.delete(key);
        }
      }
      return;
    }

    this.instanceItems.clear();
  }

  private buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
    return `${environment.scope}:${environment.environmentId}`;
  }
}
