import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import type {
  BuildTestCaseViewModel,
  BuildTestsSummaryViewModel
} from "../../../../shared/BuildDetailsContracts";
import { TestResultRow } from "./TestResultRow";

export function TestResultsList({
  summary,
  filteredItems,
  visibleItems,
  autoExpandIds,
  hasMore,
  onShowMore,
  onOpenSource
}: {
  summary: BuildTestsSummaryViewModel;
  filteredItems: BuildTestCaseViewModel[];
  visibleItems: BuildTestCaseViewModel[];
  autoExpandIds: Set<string>;
  hasMore: boolean;
  onShowMore: () => void;
  onOpenSource: (testCase: BuildTestCaseViewModel) => void;
}) {
  return (
    <div className="rounded border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span>
          Showing {visibleItems.length.toLocaleString()} of {filteredItems.length.toLocaleString()}{" "}
          tests
        </span>
        <div className="flex items-center gap-2">
          {summary.logsIncluded ? (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              Case logs loaded
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="divide-y divide-border">
        {visibleItems.map((item) => (
          <TestResultRow
            key={item.id}
            item={item}
            initialOpen={autoExpandIds.has(item.id)}
            onOpenSource={onOpenSource}
          />
        ))}
      </div>
      {hasMore ? (
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {(filteredItems.length - visibleItems.length).toLocaleString()} more tests
          </span>
          <Button variant="outline" size="sm" onClick={onShowMore}>
            Show More
          </Button>
        </div>
      ) : null}
    </div>
  );
}
