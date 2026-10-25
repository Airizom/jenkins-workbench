import type * as React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "../../../../shared/webview/components/ui/accordion";
import { ScrollArea } from "../../../../shared/webview/components/ui/scroll-area";
import type { NodeMonitorViewModel } from "../../../shared/NodeDetailsContracts";
import { formatMonitorLabel } from "./monitorLabels";
import { formatJson } from "./nodeDetailsUtils";
import { OverviewCard } from "./OverviewCard";

type MonitorCardProps = {
  icon: React.JSX.Element;
  title: string;
  entries: NodeMonitorViewModel[];
};
/** Same card chrome as the Overview cards, so every tab reads as one panel. */
export function MonitorCard({ icon, title, entries }: MonitorCardProps): React.JSX.Element {
  return (
    <OverviewCard
      icon={icon}
      title={title}
      meta={entries.length > 0 ? `${entries.length}` : undefined}
    >
      {entries.length === 0 ? (
        <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
          Jenkins reported no {title.toLowerCase()} for this node.
        </div>
      ) : (
        <Accordion type="multiple" className="space-y-1">
          {entries.map((entry) => (
            <AccordionItem
              key={entry.key}
              value={entry.key}
              className="overflow-hidden rounded-md border border-border bg-surface-sunken transition-colors data-[state=open]:border-border-strong data-[state=open]:bg-surface-raised"
            >
              <AccordionTrigger className="w-full px-3 py-1.5 hover:bg-accent-soft">
                <div className="flex flex-1 items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground" title={entry.key}>
                    {formatMonitorLabel(entry.key)}
                  </span>
                  <span className="text-xs font-medium">{entry.summary}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="border-t border-border px-3 pb-2 pt-2">
                <ScrollArea
                  orientation="both"
                  className="max-h-48 rounded border border-border bg-muted-strong"
                >
                  <pre className="m-0 px-2.5 py-1.5 text-caption font-mono text-muted-foreground whitespace-pre">
                    {formatJson(entry.raw)}
                  </pre>
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </OverviewCard>
  );
}
