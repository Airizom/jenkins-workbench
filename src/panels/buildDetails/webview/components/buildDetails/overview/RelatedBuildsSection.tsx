import * as React from "react";
import { ResultBadge } from "../../../../../shared/webview/components/ResultBadge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../../../../../shared/webview/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../../shared/webview/components/ui/collapsible";
import type {
  BuildRelationshipsViewModel,
  RelatedBuildViewModel
} from "../../../../shared/BuildDetailsContracts";

export interface RelatedBuildsSectionProps {
  relationships: BuildRelationshipsViewModel;
  navigationBusy?: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onRefresh: () => void;
  onOpenBuild: (targetId: string) => void;
}

function RelatedBuildList({
  builds,
  busy,
  onOpenBuild
}: {
  builds: RelatedBuildViewModel[];
  busy?: boolean;
  onOpenBuild: (targetId: string) => void;
}): React.JSX.Element {
  return (
    <ul className="space-y-1">
      {builds.map((build) => (
        <li key={build.targetId} className="flex min-w-0 items-center justify-between gap-2">
          <Button
            variant="link"
            size="sm"
            className="min-w-0 h-auto justify-start whitespace-normal break-all px-0 text-left"
            disabled={busy}
            onClick={() => onOpenBuild(build.targetId)}
          >
            {build.jobName} #{build.number}
          </Button>
          {build.resultLabel ? (
            <ResultBadge
              label={build.resultLabel}
              status={build.resultClass}
              className="shrink-0"
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function RelatedBuildsSection({
  relationships,
  navigationBusy,
  onExpandedChange,
  onRefresh,
  onOpenBuild
}: RelatedBuildsSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const expandedRef = React.useRef(false);
  const callbackRef = React.useRef(onExpandedChange);
  callbackRef.current = onExpandedChange;
  // Switching tabs unmounts the overview. End any active search just as a collapse does.
  React.useEffect(
    () => () => {
      if (expandedRef.current) callbackRef.current(false);
    },
    []
  );
  const changeExpanded = (value: boolean) => {
    expandedRef.current = value;
    setExpanded(value);
    onExpandedChange(value);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Related Builds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <h4 className="mb-1 text-xs font-semibold">Upstream builds</h4>
          {relationships.upstream.length > 0 ? (
            <RelatedBuildList
              builds={relationships.upstream}
              busy={navigationBusy}
              onOpenBuild={onOpenBuild}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No upstream builds recorded.</p>
          )}
        </div>
        <Collapsible open={expanded} onOpenChange={changeExpanded}>
          <CollapsibleTrigger className="text-xs font-semibold">
            Downstream builds{relationships.searched ? ` (${relationships.downstream.length})` : ""}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Directly triggered builds within a bounded history search.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={relationships.loading}
                onClick={onRefresh}
              >
                Refresh
              </Button>
            </div>
            <RelatedBuildsResults
              relationships={relationships}
              navigationBusy={navigationBusy}
              onOpenBuild={onOpenBuild}
            />
          </CollapsibleContent>
        </Collapsible>
        {relationships.error ? (
          <p role="alert" className="text-xs text-failure">
            {relationships.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RelatedBuildsResults({
  relationships,
  navigationBusy,
  onOpenBuild
}: Pick<
  RelatedBuildsSectionProps,
  "relationships" | "navigationBusy" | "onOpenBuild"
>): React.JSX.Element {
  return (
    <div aria-live="polite" aria-busy={relationships.loading} className="space-y-2">
      {relationships.loading ? (
        <p className="text-xs text-muted-foreground">Searching downstream builds…</p>
      ) : null}
      {relationships.downstream.length > 0 ? (
        <RelatedBuildList
          builds={relationships.downstream}
          busy={navigationBusy}
          onOpenBuild={onOpenBuild}
        />
      ) : relationships.searched && !relationships.loading ? (
        <p className="text-xs text-muted-foreground">
          No downstream builds found within the search limits.
        </p>
      ) : null}
      {relationships.lastCheckedAt !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Last checked{" "}
          <time dateTime={new Date(relationships.lastCheckedAt).toISOString()}>
            {new Date(relationships.lastCheckedAt).toLocaleString()}
          </time>
          {` · ${relationships.jobsSearched} jobs and ${relationships.buildsSearched} builds inspected`}
        </p>
      ) : null}
      {relationships.partialReasons.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          <p>Results may be incomplete:</p>
          <ul className="list-disc pl-4">
            {[...new Set(relationships.partialReasons)].map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
