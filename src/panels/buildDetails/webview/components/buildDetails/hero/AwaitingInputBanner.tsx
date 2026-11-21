import type * as React from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { AlertCircleIcon } from "../../../../../shared/webview/icons";
import { type AwaitingInputSummary, describeAwaitingInput } from "./awaitingInputSummary";

export function AwaitingInputBanner({
  summary,
  onReview
}: {
  summary: AwaitingInputSummary;
  onReview?: () => void;
}): React.JSX.Element {
  const description = describeAwaitingInput(summary);
  return (
    <div
      role="status"
      className="mt-2 flex items-center gap-2 rounded border border-warning-border bg-warning-surface px-2.5 py-1.5 text-xs"
    >
      <AlertCircleIcon className="h-3.5 w-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate" title={description}>
        <span className="font-medium">Build paused:</span> {description}
      </span>
      {onReview ? (
        <Button
          variant="outline"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          onClick={onReview}
        >
          Review
        </Button>
      ) : null}
    </div>
  );
}
