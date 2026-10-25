import type { WorkbenchTreeElement } from "../tree/TreeItems";
import type { BulkActionService } from "./bulk/BulkActionService";
import type { BulkAction } from "./bulk/BulkActionTargets";
import type { TreeBulkSelection } from "./bulk/TreeBulkSelection";

export interface BulkCommandDependencies {
  bulkActionService: Pick<BulkActionService, "run">;
  treeBulkSelection: Pick<TreeBulkSelection, "resolve">;
}

export function createBulkCommandHandler(
  dependencies: BulkCommandDependencies,
  action: BulkAction,
  single = false
): (item?: WorkbenchTreeElement, selection?: readonly WorkbenchTreeElement[]) => Promise<void> {
  return (item, selection) =>
    dependencies.bulkActionService.run(
      action,
      single ? (item ? [item] : []) : dependencies.treeBulkSelection.resolve(item, selection)
    );
}
