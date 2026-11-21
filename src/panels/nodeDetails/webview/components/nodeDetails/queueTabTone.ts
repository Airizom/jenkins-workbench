import type { NodeQueuedWorkViewModel } from "../../../../../shared/queueWork/QueueWorkContracts";
import type { TabCountTone } from "../../../../shared/webview/components/TabCountBadge";

/**
 * Waiting work is normal, so the Queue count stays neutral unless an item
 * needs attention: stuck items use the failure tone, blocked ones warning.
 */
export function resolveQueueTabTone(queuedWork: NodeQueuedWorkViewModel): TabCountTone {
  const items = [
    ...queuedWork.matchingQueueItems,
    ...queuedWork.anyQueueItems,
    ...queuedWork.selfLabelQueueItems
  ];
  if (items.some((item) => item.stuck)) {
    return "failure";
  }
  return items.some((item) => item.blocked) ? "warning" : "neutral";
}
