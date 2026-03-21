import type { WorkbenchTreeElement } from "./TreeItems";
import { PlaceholderTreeItem } from "./TreeItems";

export type TreeViewSummaryShape = {
  running: number;
  queue: number;
  watchErrors: number;
  hasData: boolean;
};

export function areTreeViewSummariesEqual(
  left: TreeViewSummaryShape,
  right: TreeViewSummaryShape
): boolean {
  return (
    left.running === right.running &&
    left.queue === right.queue &&
    left.watchErrors === right.watchErrors &&
    left.hasData === right.hasData
  );
}

export function getWorkbenchTreeElementId(element: WorkbenchTreeElement): string | undefined {
  return typeof element.id === "string" && element.id.length > 0 ? element.id : undefined;
}

export function isLoadingPlaceholder(element: WorkbenchTreeElement): boolean {
  return element instanceof PlaceholderTreeItem && element.kind === "loading";
}
