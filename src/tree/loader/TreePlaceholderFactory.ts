import type { PlaceholderTreeItem } from "../items/TreePlaceholderItem";

export type TreePlaceholderFactory = {
  readonly createEmptyPlaceholder: (label: string, description?: string) => PlaceholderTreeItem;
  readonly createErrorPlaceholder: (label: string, error: unknown) => PlaceholderTreeItem;
};
