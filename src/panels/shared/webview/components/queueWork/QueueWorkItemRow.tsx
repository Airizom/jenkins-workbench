import type * as React from "react";
import type { QueueWorkItemViewModel } from "../../../../../shared/queueWork/QueueWorkContracts";
import { ExternalLinkIcon } from "../../icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ClampedText } from "../ui/clamped-text";
import { TruncatedText } from "../ui/truncated-text";

export type QueueWorkItemRowProps = {
  item: QueueWorkItemViewModel;
  onOpenExternal: (url: string) => void;
  action?: "open-button" | "external-icon";
  /**
   * Replaces the requested-label badge. Pass `null` to omit it where the
   * surrounding context already names the label.
   */
  labelBadge?: React.ReactNode;
  className?: string;
};
export function QueueWorkItemRow({
  item,
  onOpenExternal,
  action = "open-button",
  labelBadge,
  className
}: QueueWorkItemRowProps): React.JSX.Element {
  const renderTaskAction = (taskUrl: string): React.JSX.Element =>
    action === "external-icon" ? (
      <Button
        aria-label={`Open in Jenkins: ${item.name}`}
        title="Open in Jenkins"
        variant="ghost"
        size="icon"
        className="shrink-0"
        onClick={() => onOpenExternal(taskUrl)}
      >
        <ExternalLinkIcon className="h-4 w-4" />
      </Button>
    ) : (
      <Button
        aria-label={`Open in Jenkins: ${item.name}`}
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => onOpenExternal(taskUrl)}
      >
        Open in Jenkins
      </Button>
    );

  return (
    <div className={className ?? "flex items-start justify-between gap-3"}>
      <div className="min-w-0">
        {/* The name gets its own line so every row lays out the same whether
            the name is short or long enough to push the badges down. */}
        <TruncatedText text={item.name} className="text-sm font-medium" />
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant={item.stuck ? "failure" : item.blocked ? "warning" : "muted"}>
            {item.statusLabel}
          </Badge>
          {labelBadge === undefined ? (
            <Badge variant="outline" className="whitespace-normal wrap-anywhere rounded-md">
              {item.queuedForLabels.length > 0 ? item.queuedForLabels.join(", ") : "Any node"}
            </Badge>
          ) : (
            labelBadge
          )}
          <span className="text-xs text-muted-foreground">
            #{item.position} in queue
            {item.queuedDurationLabel ? ` · ${item.queuedDurationLabel}` : ""}
          </span>
        </div>
        {item.reason ? (
          <ClampedText
            text={item.reason}
            className="mt-1"
            textClassName="text-xs text-muted-foreground"
          />
        ) : null}
      </div>
      {item.taskUrl ? renderTaskAction(item.taskUrl) : null}
    </div>
  );
}
