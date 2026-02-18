import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../../../shared/webview/components/ui/accordion";
import { Button } from "../../../../shared/webview/components/ui/button";
import { ScrollArea } from "../../../../shared/webview/components/ui/scroll-area";
import { CopyIcon } from "../../../../shared/webview/icons";
import type { NodeMonitorViewModel } from "../../../shared/NodeDetailsContracts";
import { MonitorCard } from "./MonitorCard";

type NodeDetailsAdvancedSectionProps = {
  advancedLoaded: boolean;
  loading: boolean;
  monitorData: NodeMonitorViewModel[];
  loadStatistics: NodeMonitorViewModel[];
  rawJson: string;
  onDiagnosticsToggle: (value: string) => void;
  onCopyJson: () => void;
};

export function NodeDetailsAdvancedSection({
  advancedLoaded,
  loading,
  monitorData,
  loadStatistics,
  rawJson,
  onDiagnosticsToggle,
  onCopyJson
}: NodeDetailsAdvancedSectionProps): JSX.Element {
  return (
    <>
      <Accordion
        type="single"
        collapsible
        onValueChange={onDiagnosticsToggle}
        className="rounded border border-border bg-muted-soft"
      >
        <AccordionItem value="diagnostics">
          <AccordionTrigger className="w-full px-3 py-2 hover:bg-muted-strong transition-colors">
            <span className="text-xs font-medium">Monitor Data & Diagnostics</span>
          </AccordionTrigger>
          <AccordionContent className="border-t border-border px-3 pb-3 pt-2">
            <div className="space-y-2">
              {!advancedLoaded ? (
                <div className="rounded border border-dashed border-border bg-muted-soft px-3 py-4 text-center text-xs text-muted-foreground">
                  {loading ? "Loading diagnostics..." : "Expand to load diagnostics."}
                </div>
              ) : (
                <>
                  <MonitorCard title="Monitors" entries={monitorData} />
                  <MonitorCard title="Load Statistics" entries={loadStatistics} />
                </>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="rounded border border-border">
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-muted-soft">
          <div>
            <div className="text-xs font-medium">Raw JSON</div>
            <div className="text-[11px] text-muted-foreground">
              {advancedLoaded ? "Full payload." : "Current detail level."}
            </div>
          </div>
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
        {rawJson ? (
          <ScrollArea orientation="both" className="max-h-72">
            <pre className="m-0 px-3 py-2 text-[11px] font-mono whitespace-pre">{rawJson}</pre>
          </ScrollArea>
        ) : (
          <div className="px-3 py-3 text-xs text-muted-foreground">No JSON payload available.</div>
        )}
      </div>
    </>
  );
}
