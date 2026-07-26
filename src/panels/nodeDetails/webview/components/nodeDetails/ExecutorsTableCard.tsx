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
  TableCell,
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

type ExecutorFilter = "all" | "busy" | "idle";

type ExecutorsTableCardProps = {
  title: string;
  entries: NodeDetailsState["executors"];
  onOpenExternal: (url: string) => void;
};
export function ExecutorsTableCard({
  title,
  entries,
  onOpenExternal
}: ExecutorsTableCardProps): React.JSX.Element {
  const [filter, setFilter] = React.useState<ExecutorFilter>("all");
  const filteredEntries = React.useMemo(() => {
    if (filter === "all") {
      return entries;
    }
    if (filter === "busy") {
      return entries.filter((entry) => !entry.isIdle);
    }
    return entries.filter((entry) => entry.isIdle);
  }, [entries, filter]);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<CpuIcon className="h-4 w-4" />}
        title={`No ${title.toLowerCase()} data`}
        className="py-6"
      />
    );
  }

  const busyCount = entries.filter((entry) => !entry.isIdle).length;

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-raised px-3 py-2">
        <div className="flex items-center gap-1.5">
          <CpuIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{title}</span>
          <span className="text-[11px] text-muted-foreground">({filteredEntries.length})</span>
          {busyCount > 0 ? (
            <Badge variant="warning" size="sm">
              {busyCount} busy
            </Badge>
          ) : (
            <Badge variant="success" size="sm">
              all idle
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden sm:block">
            <ToggleGroup
              type="single"
              value={filter}
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
              <ToggleGroupItem value="idle">Idle</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="sm:hidden w-[120px]">
            <Select value={filter} onValueChange={(value) => setFilter(value as ExecutorFilter)}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="idle">Idle</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-1.5 pl-3 pr-0 w-4">
                <span className="sr-only">Status</span>
              </TableHead>
              <TableHead className="py-1.5">#</TableHead>
              <TableHead className="py-1.5">Build</TableHead>
              <TableHead className="hidden py-1.5 md:table-cell">Duration</TableHead>
              <TableHead className="py-1.5">Progress</TableHead>
              <TableHead className="py-1.5">Link</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEntries.length > 0 ? (
              filteredEntries.map((entry) => (
                <ExecutorTableRow key={entry.id} entry={entry} onOpenExternal={onOpenExternal} />
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-4 text-center text-xs text-muted-foreground">
                  No executors match this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
