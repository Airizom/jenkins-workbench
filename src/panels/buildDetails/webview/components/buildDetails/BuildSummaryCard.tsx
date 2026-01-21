import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Separator } from "../ui/separator";
import { StatusPill } from "./StatusPill";

export function BuildSummaryCard({
  displayName,
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  culpritsLabel
}: {
  displayName: string;
  resultLabel: string;
  resultClass?: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle id="detail-title" className="text-base">
              {displayName}
            </CardTitle>
            <CardDescription>Build status and runtime metadata.</CardDescription>
          </div>
          <StatusPill
            id="detail-result"
            label={resultLabel}
            status={resultClass}
          />
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-y-3 gap-x-5">
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Duration
            </div>
            <div id="detail-duration" className="text-sm font-medium">
              {durationLabel}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Timestamp
            </div>
            <div id="detail-timestamp" className="text-sm font-medium">
              {timestampLabel}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Culprit(s)
            </div>
            <div id="detail-culprits" className="text-sm font-medium">
              {culpritsLabel}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
