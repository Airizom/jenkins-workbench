import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";

export type TreeElementChildrenHandler = {
  readonly matches: (element: WorkbenchTreeElement) => boolean;
  readonly getChildren?: (element: WorkbenchTreeElement) => Promise<WorkbenchTreeElement[]>;
  readonly invalidate?: (element: WorkbenchTreeElement) => void;
};

type TreeElementConstructor<T extends WorkbenchTreeElement> = abstract new (...args: never[]) => T;

type TypedTreeElementChildrenHandler<T extends WorkbenchTreeElement> = {
  readonly getChildren?: (element: T) => Promise<WorkbenchTreeElement[]>;
  readonly invalidate?: (element: T) => void;
};

export function createTreeElementChildrenHandler<T extends WorkbenchTreeElement>(
  elementType: TreeElementConstructor<T>,
  handler: TypedTreeElementChildrenHandler<T>
): TreeElementChildrenHandler {
  const narrowElement = (element: WorkbenchTreeElement): T => element as T;
  const getChildren = handler.getChildren;
  const invalidate = handler.invalidate;

  return {
    matches: (element) => element instanceof elementType,
    ...(getChildren ? { getChildren: (element) => getChildren(narrowElement(element)) } : {}),
    ...(invalidate ? { invalidate: (element) => invalidate(narrowElement(element)) } : {})
  };
}
