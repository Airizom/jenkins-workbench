import type * as vscode from "vscode";
import type { TreeExpansionPath, TreeExpansionResolveResult } from "./TreeDataProviderTypes";
import { getWorkbenchTreeElementId, isLoadingPlaceholder } from "./TreeDataProviderUtils";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";

type TreeParentResolver = (
  element: WorkbenchTreeElement
) => vscode.ProviderResult<WorkbenchTreeElement>;

export class TreeDataProviderExpansionResolver {
  constructor(
    private readonly getParent: TreeParentResolver,
    private readonly getChildren: (
      element?: WorkbenchTreeElement
    ) => Promise<WorkbenchTreeElement[]>
  ) {}

  async buildExpansionPath(element: WorkbenchTreeElement): Promise<TreeExpansionPath | undefined> {
    const path: string[] = [];
    let current: WorkbenchTreeElement | undefined = element;

    while (current) {
      const id = getWorkbenchTreeElementId(current);
      if (!id) {
        return undefined;
      }
      path.unshift(id);
      const parent = await this.getParent(current);
      current = parent ?? undefined;
    }

    return path.length > 0 ? path : undefined;
  }

  async resolveExpansionPath(path: TreeExpansionPath): Promise<TreeExpansionResolveResult> {
    let parent: WorkbenchTreeElement | undefined = undefined;

    for (const id of path) {
      const children = await this.getChildren(parent);
      let match: WorkbenchTreeElement | undefined;
      let pending = false;
      for (const child of children) {
        if (!match && getWorkbenchTreeElementId(child) === id) {
          match = child;
        }
        pending ||= isLoadingPlaceholder(child);
      }
      if (!match) {
        return {
          element: undefined,
          pending
        };
      }
      parent = match;
    }

    return { element: parent, pending: false };
  }
}
