import type { PlaceholderTreeItem, PlaceholderTreeItemOptions } from "../items/TreePlaceholderItem";

export type TreePlaceholderFactory = {
  readonly createEmptyPlaceholder: (
    label: string,
    description?: string,
    options?: PlaceholderTreeItemOptions
  ) => PlaceholderTreeItem;
  readonly createErrorPlaceholder: (label: string, error: unknown) => PlaceholderTreeItem;
};
