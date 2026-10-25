import type * as React from "react";
import { Button } from "../../../shared/webview/components/ui/button";
import { Input } from "../../../shared/webview/components/ui/input";
import { Toggle } from "../../../shared/webview/components/ui/toggle";
import { SearchIcon } from "../../../shared/webview/icons";
import { isPoolFilterActive, type PoolFilter } from "../state/nodeCapacityView";

/**
 * Narrows the pool list on large controllers. There is deliberately no
 * "Expand all": every expanded node loads its running work from Jenkins and
 * busy nodes reload on each 10s snapshot, so expanding is left per pool.
 */
export function NodeCapacityPoolToolbar({
  filter,
  totalCount,
  shownCount,
  attentionCount,
  canCollapse,
  onFilterChange,
  onCollapseAll
}: {
  filter: PoolFilter;
  totalCount: number;
  shownCount: number;
  attentionCount: number;
  canCollapse: boolean;
  onFilterChange: (filter: PoolFilter) => void;
  onCollapseAll: () => void;
}): React.JSX.Element {
  const filtered = isPoolFilterActive(filter);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1 sm:max-w-80">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Filter pools by label, node, or queued job"
          placeholder="Filter by label, node, or job"
          value={filter.query}
          onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
          className="pl-8"
        />
      </div>
      <Toggle
        pressed={filter.attentionOnly}
        onPressedChange={(attentionOnly) => onFilterChange({ ...filter, attentionOnly })}
        disabled={attentionCount === 0 && !filter.attentionOnly}
      >
        Needs attention
        <span className="rounded-full bg-muted-strong px-1.5 text-micro font-medium tabular-nums text-muted-foreground">
          {attentionCount}
        </span>
      </Toggle>
      <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
        {filtered ? `${shownCount} of ${totalCount} pools` : `${totalCount} pools`}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        disabled={!canCollapse}
        onClick={onCollapseAll}
      >
        Collapse all
      </Button>
    </div>
  );
}
