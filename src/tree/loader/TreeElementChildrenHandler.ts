import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";

export type TreeElementChildrenHandler = {
  readonly matches: (element: WorkbenchTreeElement) => boolean;
  readonly getChildren?: (element: WorkbenchTreeElement) => Promise<WorkbenchTreeElement[]>;
  readonly invalidate?: (element: WorkbenchTreeElement) => void;
};
