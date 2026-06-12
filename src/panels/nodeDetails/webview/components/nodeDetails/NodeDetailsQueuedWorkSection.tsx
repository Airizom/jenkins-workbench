import { countQueuedWorkItems } from "../../../../../shared/queueWork/QueueWorkContracts";
import { QueueWorkItemRow } from "../../../../shared/webview/components/queueWork/QueueWorkItemRow";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { ClockIcon } from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";

type NodeDetailsQueuedWorkSectionProps = {
  queuedWork: NodeDetailsState["queuedWork"];
  onOpenExternal: (url: string) => void;
};
export function NodeDetailsQueuedWorkSection({
  queuedWork,
  onOpenExternal
}: NodeDetailsQueuedWorkSectionProps): JSX.Element {
  const total = countQueuedWorkItems(queuedWork);

  if (total === 0) {
    return (
      <section className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted-soft px-4 py-8 text-center">
        <ClockIcon className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Queue is empty</h2>
        <p className="m-0 text-xs text-muted-foreground">
          No queued builds currently match this node.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <QueueGroup
        title="Matching labels"
        description="Queue items whose assigned label matches this node's shared labels."
        items={queuedWork.matchingQueueItems}
        onOpenExternal={onOpenExternal}
      />
      <QueueGroup
        title="Any executor"
        description="Queue items without an explicit assigned label."
        items={queuedWork.anyQueueItems}
        onOpenExternal={onOpenExternal}
      />
      <QueueGroup
        title="Node-specific labels"
        description="Queue items targeting labels that match this node directly."
        items={queuedWork.selfLabelQueueItems}
        onOpenExternal={onOpenExternal}
      />
    </section>
  );
}

function QueueGroup({
  title,
  description,
  items,
  onOpenExternal
}: {
  title: string;
  description: string;
  items: NodeDetailsState["queuedWork"]["matchingQueueItems"];
  onOpenExternal: (url: string) => void;
}): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-mutedBorder bg-card shadow-widget overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-mutedBorder bg-muted-soft px-4 py-3">
        <div className="flex items-start gap-2">
          <ClockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <Badge variant="outline">{items.length}</Badge>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div key={item.id} className="px-4 py-3">
            <QueueWorkItemRow item={item} onOpenExternal={onOpenExternal} />
          </div>
        ))}
      </div>
    </section>
  );
}
