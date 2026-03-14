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

  const [filter, setFilter] = React.useState<ExecutorFilter>("all");
  const filteredEntries = React.useMemo(() => {
    if (filter === "all") {
      return entries;
    }
    if (filter === "busy") {
      return entries.filter((entry) => Boolean(entry.workLabel));
    }
    return entries.filter((entry) => !entry.workLabel);
  }, [entries, filter]);

  return (
    <div className="rounded border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted-soft border-b border-border">
        <div className="flex items-center gap-1.5">
          <CpuIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{title}</span>
          <span className="text-[11px] text-muted-foreground">({filteredEntries.length})</span>
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
                <TableCell colSpan={5} className="py-4 text-center text-xs text-muted-foreground">
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
