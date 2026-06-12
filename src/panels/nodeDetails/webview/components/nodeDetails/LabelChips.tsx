import * as React from "react";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import { TagIcon } from "../../../../shared/webview/icons";

const COLLAPSED_LABEL_LIMIT = 24;

const { useState } = React;

type LabelChipsProps = {
  labels: string[];
};
export function LabelChips({ labels }: LabelChipsProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);

  if (labels.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center">
        <TagIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">No labels assigned</span>
      </div>
    );
  }

  const visible = showAll ? labels : labels.slice(0, COLLAPSED_LABEL_LIMIT);
  const hidden = labels.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((label) => (
        <Badge key={label} variant="secondary" className="text-xs px-2 py-0.5 break-all">
          {label}
        </Badge>
      ))}
      {hidden > 0 ? (
        <Button
          variant="link"
          size="sm"
          className="text-xs"
          onClick={() => setShowAll(true)}
          aria-label={`Show all ${labels.length} labels`}
        >
          Show all ({labels.length})
        </Button>
      ) : null}
    </div>
  );
}
