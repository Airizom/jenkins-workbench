import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "../../../../shared/webview/components/ui/accordion";
import { ScrollArea } from "../../../../shared/webview/components/ui/scroll-area";
import type { NodeMonitorViewModel } from "../../../shared/NodeDetailsContracts";
import { formatJson } from "./nodeDetailsUtils";

type MonitorCardProps = {
  title: string;
  entries: NodeMonitorViewModel[];
};

export function MonitorCard({ title, entries }: MonitorCardProps): JSX.Element {
  if (!entries || entries.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted-soft px-3 py-3 text-center text-xs text-muted-foreground">
        No {title.toLowerCase()} data available.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      <Accordion type="multiple" className="space-y-1">
        {entries.map((entry) => (
          <AccordionItem
            key={entry.key}
            value={entry.key}
            className="overflow-hidden rounded border border-mutedBorder bg-muted-soft transition-colors data-[state=open]:border-border data-[state=open]:bg-muted-strong"
          >
            <AccordionTrigger className="w-full px-3 py-1.5 hover:bg-accent-soft">
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-muted-foreground">{entry.key}</span>
                <span className="text-xs font-medium">{entry.summary}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="border-t border-border px-3 pb-2 pt-2">
              <ScrollArea
                orientation="both"
                className="max-h-48 rounded border border-border bg-muted-strong"
              >
                <pre className="m-0 px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground whitespace-pre">
                  {formatJson(entry.raw)}
                </pre>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
