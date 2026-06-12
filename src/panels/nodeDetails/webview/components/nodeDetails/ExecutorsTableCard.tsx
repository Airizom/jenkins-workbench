import * as React from "react";
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
}: ExecutorsTableCardProps): JSX.Element {
  const [filter, setFilter] = React.useState<ExecutorFilter>("all");
  const filteredEntries = React.useMemo(() => {
    const sourceEntries = entries ?? [];

    if (filter === "all") {
      return sourceEntries;
    }
    if (filter === "busy") {
      return sourceEntries.filter((entry) => Boolean(entry.workLabel));
    }
    return sourceEntries.filter((entry) => !entry.workLabel);
  }, [entries, filter]);

  if (!entries || entries.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center">
        <CpuIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          No {title.toLowerCase()} data available
        </span>
      </div>
    );
  }

  const busyCount = entries.filter((entry) => Boolean(entry.workLabel)).length;

  return (
    <div className="rounded-lg border border-mutedBorder bg-card shadow-widget overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted-soft border-b border-mutedBorder">
        <div className="flex items-center gap-1.5">
          <CpuIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{title}</span>
          <span className="text-[11px] text-muted-foreground">({filteredEntries.length})</span>
          {busyCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-warning-border bg-warning-soft px-1.5 text-[10px] font-medium text-warning">
              {busyCount} busy
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-success-border bg-success-soft px-1.5 text-[10px] font-medium text-success">
              all idle
            </span>
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
              <TableHead className="text-[11px] py-1.5 px-3">#</TableHead>
              <TableHead className="text-[11px] py-1.5 px-3">Build</TableHead>
              <TableHead className="text-[11px] py-1.5 px-3">Duration</TableHead>
              <TableHead className="text-[11px] py-1.5 px-3">Progress</TableHead>
              <TableHead className="text-[11px] py-1.5 px-3">Link</TableHead>
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
