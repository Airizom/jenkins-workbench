import { PlaceholderTreeItem } from "./items/TreePlaceholderItem";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";

export function getWorkbenchTreeElementId(element: WorkbenchTreeElement): string | undefined {
  return typeof element.id === "string" && element.id.length > 0 ? element.id : undefined;
}

export function areWorkbenchTreeElementsEquivalent(
  left: WorkbenchTreeElement | undefined,
  right: WorkbenchTreeElement | undefined
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  const leftId = getWorkbenchTreeElementId(left);
  return leftId !== undefined && leftId === getWorkbenchTreeElementId(right);
}

export function isLoadingPlaceholder(element: WorkbenchTreeElement): boolean {
  return element instanceof PlaceholderTreeItem && element.kind === "loading";
}
