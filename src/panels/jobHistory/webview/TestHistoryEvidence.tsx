import * as React from "react";
import { buildTestCaseKey } from "../../shared/TestCaseViewModel";
import { Badge } from "../../shared/webview/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../shared/webview/components/ui/collapsible";
import { HistoryContext } from "./HistoryContext";
import { TestOutcomeTimeline, useHistoryAction } from "./HistoryOutcomes";

/** Compact per-test history for Build Details test rows; styles itself (no ancestor classes). */
export function TestHistoryEvidence({
  name,
  className,
  suiteName
}: {
  name: string;
  className?: string;
  suiteName?: string;
}) {
  const model = React.useContext(HistoryContext);
  const send = useHistoryAction(model);
  const [open, setOpen] = React.useState(false);
  const key = buildTestCaseKey(className, suiteName, name);
  const test = model.tests.find((item) => item.key === key);
  if (!test) return null;
  const evidence = model.evidence[key];
  const alsoFailingInBaseline = model.baselineOutcomes?.[key] === "failed" && Boolean(evidence);
  const usable = test.passed + test.failed;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border text-xs">
      <CollapsibleTrigger className="gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">History</span>
          <span className="truncate">{evidence?.label ?? "Observed outcomes"}</span>
          {test.intermittent ? (
            <Badge variant="warning" size="sm">
              Intermittent
            </Badge>
          ) : null}
          {alsoFailingInBaseline ? (
            <Badge variant="failure" size="sm">
              Also failing in baseline
            </Badge>
          ) : null}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <p className="mb-2 text-muted-foreground">
          {evidence
            ? `${evidence.source === "jenkins" ? "From Jenkins test age" : "From sampled builds"} · `
            : ""}
          {test.transitions} {test.transitions === 1 ? "transition" : "transitions"} · {usable}{" "}
          usable {usable === 1 ? "observation" : "observations"} · Newest first
        </p>
        <TestOutcomeTimeline
          model={model}
          test={test}
          onOpenBuild={(buildNumber) => send("openBuild", buildNumber)}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
