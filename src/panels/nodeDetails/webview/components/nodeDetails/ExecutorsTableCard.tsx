import * as React from "react";
import { EmptyState } from "../../../../shared/webview/components/EmptyState";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../shared/webview/components/ui/select";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../shared/webview/components/ui/table";
import {
  ToggleGroup,
  ToggleGroupItem
} from "../../../../shared/webview/components/ui/toggle-group";
import { CpuIcon } from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { ExecutorTableRow } from "./ExecutorTableRow";
import { formatFreeExecutorLabel } from "./executorUtilization";

type ExecutorFilter = "all" | "busy" | "idle";

type ExecutorsTableCardProps = {
  title: string;
  entries: NodeDetailsState["executors"];
  isOffline: boolean;
  onOpenExternal: (url: string) => void;
};
export function ExecutorsTableCard({
  title,
  entries,
  isOffline,
  onOpenExternal
}: ExecutorsTableCardProps): React.JSX.Element {
  const [filter, setFilter] = React.useState<ExecutorFilter>("all");
  const busyCount = entries.filter((entry) => !entry.isIdle).length;
  // Filtering only helps when the table mixes busy and free executors. When it
  // is hidden, show everything so a stale choice cannot leave the table empty.
  const showFilter = busyCount > 0 && busyCount < entries.length;
  const activeFilter: ExecutorFilter = showFilter ? filter : "all";
  const filteredEntries = React.useMemo(() => {
    if (activeFilter === "all") {
      return entries;
    }
    if (activeFilter === "busy") {
      return entries.filter((entry) => !entry.isIdle);
    }
    return entries.filter((entry) => entry.isIdle);
  }, [entries, activeFilter]);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<CpuIcon className="h-4 w-4" />}
        title={`No ${title.toLowerCase()}`}
        className="py-6"
      />
    );
  }

  const freeLabel = formatFreeExecutorLabel(isOffline);

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-raised px-3 py-2">
        <div className="flex items-center gap-1.5">
          <CpuIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{title}</span>
          <span className="text-caption text-muted-foreground">({entries.length})</span>
          {/* Busy executors are normal work: progress tone, never warning. */}
          {busyCount > 0 ? (
            <Badge variant="info" size="sm">
              {busyCount} busy
            </Badge>
          ) : (
            <Badge variant="muted" size="sm">
              {isOffline ? "all offline" : "all idle"}
            </Badge>
          )}
        </div>
        {showFilter ? (
          <div className="flex items-center gap-1.5">
            <div className="hidden sm:block">
              <ToggleGroup
                type="single"
                value={activeFilter}
                onValueChange={(value) => {
                  if (!value) {
                    return;
                  }
                  setFilter(value as ExecutorFilter);
                }}
                aria-label="Executor filter"
              >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="busy">Busy</ToggleGroupItem>
                <ToggleGroupItem value="idle">{freeLabel}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="sm:hidden w-[120px]">
              <Select
                value={activeFilter}
                onValueChange={(value) => setFilter(value as ExecutorFilter)}
              >
                <SelectTrigger className="h-7 text-xs" aria-label="Executor filter">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="busy">Busy</SelectItem>
                  <SelectItem value="idle">{freeLabel}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        {/* Fixed column widths keep the Executors and One-off tables aligned. */}
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-7 py-1.5 pl-3 pr-0">
                <span className="sr-only">Status</span>
              </TableHead>
              <TableHead className="w-24 py-1.5 sm:w-28">Executor</TableHead>
              <TableHead className="py-1.5">Build</TableHead>
              <TableHead className="hidden w-24 py-1.5 md:table-cell">Duration</TableHead>
              <TableHead className="w-24 py-1.5 sm:w-48">Progress</TableHead>
              <TableHead className="w-16 py-1.5">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEntries.map((entry) => (
              <ExecutorTableRow
                key={entry.id}
                entry={entry}
                isOffline={isOffline}
                onOpenExternal={onOpenExternal}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
