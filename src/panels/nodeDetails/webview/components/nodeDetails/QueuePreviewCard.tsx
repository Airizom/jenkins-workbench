import { countQueuedWorkItems } from "../../../../../shared/queueWork/QueueWorkContracts";
import { QueueWorkItemRow } from "../../../../shared/webview/components/queueWork/QueueWorkItemRow";
import { Button } from "../../../../shared/webview/components/ui/button";
import { ClockIcon } from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { OverviewCard } from "./OverviewCard";

const PREVIEW_LIMIT = 5;

type QueuePreviewCardProps = {
  queuedWork: NodeDetailsState["queuedWork"];
  onOpenExternal: (url: string) => void;
  onShowQueue: () => void;
};
export function QueuePreviewCard({
  queuedWork,
  onOpenExternal,
  onShowQueue
}: QueuePreviewCardProps): JSX.Element {
  const total = countQueuedWorkItems(queuedWork);
  // Matching-label items are the most relevant to this node, so they lead.
  const items = [
    ...queuedWork.matchingQueueItems,
    ...queuedWork.anyQueueItems,
    ...queuedWork.selfLabelQueueItems
  ].slice(0, PREVIEW_LIMIT);

  return (
    <OverviewCard
      icon={<ClockIcon className="h-4 w-4" />}
      title="Queue"
      meta={total > 0 ? `${total} waiting` : undefined}
    >
      {items.length > 0 ? (
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={item.id} className="py-2 first:pt-0 last:pb-0">
              <QueueWorkItemRow
                item={item}
                onOpenExternal={onOpenExternal}
                action="external-icon"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
          No queued builds currently match this node.
        </div>
      )}
      {total > 0 ? (
        <Button
          variant="link"
          size="sm"
          className="mt-2 text-xs"
          onClick={onShowQueue}
          aria-label="Open the Queue tab"
        >
          View all ({total})
        </Button>
      ) : null}
    </OverviewCard>
  );
}
