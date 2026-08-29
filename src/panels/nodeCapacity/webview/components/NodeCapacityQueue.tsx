import * as React from "react";
import type { QueueWorkItemViewModel } from "../../../../shared/queueWork/QueueWorkContracts";
import { EmptyState } from "../../../shared/webview/components/EmptyState";
import { QueueWorkItemRow } from "../../../shared/webview/components/queueWork/QueueWorkItemRow";
import { SectionHeading } from "../../../shared/webview/components/SectionHeading";
import { Badge } from "../../../shared/webview/components/ui/badge";
import { AlertTriangleIcon, ClockIcon } from "../../../shared/webview/icons";
import type { OpenExternalHandler } from "./NodeCapacityViewTypes";

export function NodeCapacityQueueList({
  items,
  onOpenExternal
}: {
  items: QueueWorkItemViewModel[];
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  return (
    <section>
      <SectionHeading
        title="Queued work"
        icon={<ClockIcon className="h-3.5 w-3.5" />}
        count={items.length > 0 ? items.length : undefined}
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing queued"
          description="No queued builds are waiting on this pool."
          className="py-6"
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <QueueRow key={item.id} item={item} onOpenExternal={onOpenExternal} />
          ))}
        </div>
      )}
    </section>
  );
}

export function HiddenLabelQueue({
  items,
  onOpenExternal
}: {
  items: QueueWorkItemViewModel[];
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-warning-border bg-warning-soft p-4 shadow-xs">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">Node-specific label pressure</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These queue items target labels hidden from the shared pool list.
            </p>
          </div>
        </div>
        <Badge variant="warning" size="sm">
          {items.length}
        </Badge>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {items.map((item) => (
          <QueueRow key={item.id} item={item} onOpenExternal={onOpenExternal} />
        ))}
      </div>
    </section>
  );
}

function QueueRow({
  item,
  onOpenExternal
}: {
  item: QueueWorkItemViewModel;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-surface-sunken p-3">
      <QueueWorkItemRow item={item} onOpenExternal={onOpenExternal} action="external-icon" />
    </div>
  );
}
