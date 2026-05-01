import type { TreeChildrenOptions } from "../TreeTypes";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";

export type TreeElementChildrenHandler = {
  readonly matches: (element: WorkbenchTreeElement) => boolean;
  readonly getChildren?: (
    element: WorkbenchTreeElement,
    options?: TreeChildrenOptions
  ) => Promise<WorkbenchTreeElement[]>;
  readonly invalidate?: (element: WorkbenchTreeElement) => void;
};
