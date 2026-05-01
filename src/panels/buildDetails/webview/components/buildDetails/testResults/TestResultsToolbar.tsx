import { Button } from "../../../../../shared/webview/components/ui/button";
import { Input } from "../../../../../shared/webview/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem
} from "../../../../../shared/webview/components/ui/toggle-group";
import { SearchIcon } from "../../../../../shared/webview/icons";
import type {
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel
} from "../../../../shared/BuildDetailsContracts";
import type { TestStatusFilter } from "./testResultsTypes";

export function TestResultsToolbar({
  summary,
  results,
  statusFilter,
  query,
  onStatusFilterChange,
  onQueryChange,
  onReloadWithLogs
}: {
  summary: BuildTestsSummaryViewModel;
  results: BuildTestResultsViewModel;
  statusFilter: TestStatusFilter;
  query: string;
  onStatusFilterChange: (value: TestStatusFilter) => void;
  onQueryChange: (value: string) => void;
  onReloadWithLogs: () => void;
}) {
  return (
    <div className="sticky-header rounded border border-border bg-background/95 p-3 backdrop-blur">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <ToggleGroup
            type="single"
            value={statusFilter}
            onValueChange={(value) => {
              if (value) {
                onStatusFilterChange(value as TestStatusFilter);
              }
            }}
            className="w-full sm:w-auto"
          >
            <ToggleGroupItem value="all">
              All ({summary.totalCount.toLocaleString()})
            </ToggleGroupItem>
            <ToggleGroupItem
              value="failed"
              className={
                summary.failedCount > 0
                  ? "text-failure data-[state=on]:text-list-activeForeground"
                  : ""
              }
            >
              Failed ({summary.failedCount.toLocaleString()})
            </ToggleGroupItem>
            <ToggleGroupItem value="skipped">
              Skipped ({summary.skippedCount.toLocaleString()})
            </ToggleGroupItem>
            <ToggleGroupItem value="passed">
              Passed ({summary.passedCount.toLocaleString()})
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="relative block min-w-[260px] flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search test results"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search suite, class, or test name"
              className="pl-8"
            />
          </div>
        </div>
        {summary.canLoadLogs ? (
          <Button variant="outline" size="sm" onClick={onReloadWithLogs} disabled={results.loading}>
            {results.loading ? "Loading Logs..." : "Load Logs"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
