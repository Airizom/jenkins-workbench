import type { QueueWorkItemViewModel } from "../../../../../shared/queueWork/QueueWorkContracts";
import { ExternalLinkIcon } from "../../icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

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
}: QueueWorkItemRowProps): JSX.Element {
  return (
    <div className={className ?? "flex items-start justify-between gap-3"}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{item.name}</span>
          <Badge variant={item.stuck || item.blocked ? "secondary" : "muted"}>
            {item.statusLabel}
          </Badge>
          {item.queuedForLabels.length > 0 ? (
            <Badge variant="outline">{item.queuedForLabels.join(", ")}</Badge>
          ) : null}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          #{item.position} in queue
          {item.queuedDurationLabel ? ` - ${item.queuedDurationLabel}` : ""}
        </div>
        {item.reason ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
        ) : null}
      </div>
      {item.taskUrl ? (
        action === "external-icon" ? (
          <Button
            aria-label={`Open ${item.name} in Jenkins`}
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => item.taskUrl && onOpenExternal(item.taskUrl)}
          >
            <ExternalLinkIcon className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => item.taskUrl && onOpenExternal(item.taskUrl)}
          >
            Open
          </Button>
        )
      ) : null}
    </div>
  );
}
