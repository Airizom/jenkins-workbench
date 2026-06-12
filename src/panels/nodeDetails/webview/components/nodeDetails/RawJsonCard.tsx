import * as React from "react";
import { Button } from "../../../../shared/webview/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../shared/webview/components/ui/collapsible";
import { DisclosureChevron } from "../../../../shared/webview/components/ui/disclosure-chevron";
import { ScrollArea } from "../../../../shared/webview/components/ui/scroll-area";
import { CopyIcon } from "../../../../shared/webview/icons";

const { useState } = React;

type RawJsonCardProps = {
  rawJson: string;
  advancedLoaded: boolean;
  onCopyJson: () => void;
};
export function RawJsonCard({
  rawJson,
  advancedLoaded,
  onCopyJson
}: RawJsonCardProps): JSX.Element {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-mutedBorder bg-card shadow-widget overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-mutedBorder bg-muted-soft">
        <CollapsibleTrigger asChild>
          <button type="button" className="group flex flex-1 items-center gap-2 text-left">
            <DisclosureChevron className="h-3.5 w-3.5" />
            <div>
              <div className="text-xs font-medium">Raw JSON</div>
              <div className="text-[11px] text-muted-foreground">
                {advancedLoaded ? "Full payload." : "Current detail level."}
              </div>
            </div>
          </button>
        </CollapsibleTrigger>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopyJson}
          disabled={!rawJson}
          className="gap-1 h-6 px-2 text-[11px]"
        >
          <CopyIcon className="h-3.5 w-3.5" />
          Copy
        </Button>
      </div>
      <CollapsibleContent>
        {rawJson ? (
          <ScrollArea orientation="both" className="max-h-72">
            <pre className="m-0 px-3 py-2 text-[11px] font-mono whitespace-pre">{rawJson}</pre>
          </ScrollArea>
        ) : (
          <div className="px-3 py-3 text-xs text-muted-foreground">No JSON payload available.</div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
