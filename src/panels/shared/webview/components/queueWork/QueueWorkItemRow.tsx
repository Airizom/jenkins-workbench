import type * as React from "react";
import type { QueueWorkItemViewModel } from "../../../../../shared/queueWork/QueueWorkContracts";
import { ExternalLinkIcon } from "../../icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { TruncatedText } from "../ui/truncated-text";

export type QueueWorkItemRowProps = {
  item: QueueWorkItemViewModel;
  onOpenExternal: (url: string) => void;
  action?: "open-button" | "external-icon";
  className?: string;
};
export function QueueWorkItemRow({
  item,
  onOpenExternal,
  action = "open-button",
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
        <div className="flex flex-wrap items-center gap-2">
          <TruncatedText text={item.name} className="text-sm font-medium" />
          <Badge variant={item.stuck ? "failure" : item.blocked ? "warning" : "muted"}>
            {item.statusLabel}
          </Badge>
          <Badge variant="outline" className="whitespace-normal wrap-anywhere rounded-md">
            {item.queuedForLabels.length > 0 ? item.queuedForLabels.join(", ") : "Any node"}
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          #{item.position} in queue
          {item.queuedDurationLabel ? ` · ${item.queuedDurationLabel}` : ""}
        </div>
        {item.reason ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
        ) : null}
      </div>
      {item.taskUrl ? renderTaskAction(item.taskUrl) : null}
    </div>
  );
}
