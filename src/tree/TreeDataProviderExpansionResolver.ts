import type * as vscode from "vscode";
import {
  getWorkbenchTreeElementId,
  isLoadingPlaceholder
} from "./TreeDataProviderUtils";
import type { TreeExpansionPath, TreeExpansionResolveResult } from "./TreeDataProviderTypes";
import type { WorkbenchTreeElement } from "./TreeItems";

type TreeParentResolver = (
  element: WorkbenchTreeElement
) => vscode.ProviderResult<WorkbenchTreeElement>;

export class TreeDataProviderExpansionResolver {
  constructor(
    private readonly getParent: TreeParentResolver,
    private readonly getChildren: (element?: WorkbenchTreeElement) => Promise<WorkbenchTreeElement[]>
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
      const match = children.find((child) => getWorkbenchTreeElementId(child) === id);
      if (!match) {
        return {
          element: undefined,
          pending: children.some((child) => isLoadingPlaceholder(child))
        };
      }
      parent = match;
    }

    return { element: parent, pending: false };
  }
}
