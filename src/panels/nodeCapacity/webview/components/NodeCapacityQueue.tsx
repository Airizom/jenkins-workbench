import * as React from "react";
import type { NodeCapacityPoolViewModel } from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import type { QueueWorkItemViewModel } from "../../../../shared/queueWork/QueueWorkContracts";
import { QueueWorkItemRow } from "../../../shared/webview/components/queueWork/QueueWorkItemRow";
import { SectionHeading } from "../../../shared/webview/components/SectionHeading";
import { Badge } from "../../../shared/webview/components/ui/badge";
import { AlertTriangleIcon, ClockIcon, ServerIcon } from "../../../shared/webview/icons";
import { cn } from "../../../shared/webview/lib/utils";
import { type PinnedNode, resolvePinnedNode } from "../state/nodeCapacityView";
import type { OpenExternalHandler, OpenNodeDetailsHandler } from "./NodeCapacityViewTypes";

/**
 * True when the item's label badge would only repeat the pool it sits in:
 * a lone request for this label, or an unlabeled item in the "Any node" pool.
 */
function repeatsPoolLabel(
  item: QueueWorkItemViewModel,
  pool: Pick<NodeCapacityPoolViewModel, "kind" | "label">
): boolean {
  if (pool.kind === "any") {
    return item.queuedForLabels.length === 0;
  }
  return item.queuedForLabels.length === 1 && item.queuedForLabels[0] === pool.label;
}

/** Rendered only when the pool has queued work; the pool header covers the empty case. */
export function NodeCapacityQueueList({
  items,
  pool,
  onOpenExternal
}: {
  items: QueueWorkItemViewModel[];
  pool: Pick<NodeCapacityPoolViewModel, "kind" | "label">;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  return (
    <section>
      <SectionHeading
        title="Queued work"
        icon={<ClockIcon className="h-3.5 w-3.5" />}
        count={items.length}
      />
      <div className="space-y-2">
        {items.map((item) => (
          <QueueRow
            key={item.id}
            item={item}
            labelBadge={repeatsPoolLabel(item, pool) ? null : undefined}
            onOpenExternal={onOpenExternal}
          />
        ))}
      </div>
    </section>
  );
}

function PinnedNodeLink({
  node,
  onOpenNodeDetails
}: {
  node: PinnedNode;
  onOpenNodeDetails: OpenNodeDetailsHandler;
}): React.JSX.Element {
  const nodeUrl = node.nodeUrl;
  const content = (
    <>
      <ServerIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{node.displayName}</span>
    </>
  );
  const className =
    "inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border px-1.5 py-px text-xs";
  if (!nodeUrl) {
    return <span className={className}>{content}</span>;
  }
  return (
    <button
      type="button"
      className={cn(
        className,
        "focus-ring text-link hover:border-link hover:text-link-hover hover:underline"
      )}
      title={`${node.displayName} (open node details)`}
      onClick={() => onOpenNodeDetails(nodeUrl, node.displayName)}
    >
      {content}
      <span className="sr-only">, open node details</span>
    </button>
  );
}

/**
 * Builds that request one agent by name. Jenkins gives every agent a label
 * equal to its name; those labels are kept out of the pool list, so this
 * section is the only place their queue shows. It uses the failure tone only
 * when something is stuck, matching how pools escalate.
 */
export function PinnedNodeQueue({
  items,
  pinnedNodes,
  onOpenExternal,
  onOpenNodeDetails
}: {
  items: readonly QueueWorkItemViewModel[];
  pinnedNodes: ReadonlyMap<string, PinnedNode>;
  onOpenExternal: OpenExternalHandler;
  onOpenNodeDetails: OpenNodeDetailsHandler;
}): React.JSX.Element {
  const headingId = React.useId();
  const stuckCount = items.filter((item) => item.stuck).length;
  const hasStuck = stuckCount > 0;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "rounded-lg border bg-card p-4 shadow-xs",
        hasStuck ? "border-failure-border" : "border-border"
      )}
    >
      <div className="mb-3 flex items-start gap-2">
        {hasStuck ? (
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-failure" aria-hidden="true" />
        ) : (
          <ServerIcon
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0">
          <h2
            id={headingId}
            className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold"
          >
            Waiting on a specific node
            <Badge variant={hasStuck ? "failure" : "muted"} size="sm">
              {hasStuck ? `${stuckCount} stuck` : items.length}
              <span className="sr-only">
                {hasStuck
                  ? ` of ${items.length} builds`
                  : ` ${items.length === 1 ? "build" : "builds"}`}
              </span>
            </Badge>
          </h2>
          <p className="m-0 mt-0.5 text-xs text-muted-foreground">
            These builds request a single agent by name, so no label pool includes them.
          </p>
        </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {items.map((item) => {
          const pinnedNode = resolvePinnedNode(item, pinnedNodes);
          return (
            <QueueRow
              key={item.id}
              item={item}
              labelBadge={
                pinnedNode ? (
                  <PinnedNodeLink node={pinnedNode} onOpenNodeDetails={onOpenNodeDetails} />
                ) : undefined
              }
              onOpenExternal={onOpenExternal}
            />
          );
        })}
      </div>
    </section>
  );
}

function QueueRow({
  item,
  labelBadge,
  onOpenExternal
}: {
  item: QueueWorkItemViewModel;
  labelBadge?: React.ReactNode;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-surface-sunken p-3">
      <QueueWorkItemRow
        item={item}
        onOpenExternal={onOpenExternal}
        action="external-icon"
        labelBadge={labelBadge}
      />
    </div>
  );
}
