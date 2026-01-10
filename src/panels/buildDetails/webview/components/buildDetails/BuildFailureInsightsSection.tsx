import type {
  ArtifactAction,
  BuildFailureArtifact,
  BuildFailureChangelogItem,
  BuildFailureFailedTest,
  BuildFailureInsightsViewModel,
} from "../../../shared/BuildDetailsContracts";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";

export function BuildFailureInsightsSection({
  insights,
  resultClass,
  onArtifactAction,
}: {
  insights: BuildFailureInsightsViewModel;
  resultClass: string;
  onArtifactAction: (
    action: ArtifactAction,
    artifact: BuildFailureArtifact
  ) => void;
}) {
  const isFailure = resultClass === "failure" || resultClass === "unstable";
  const sectionTitle = isFailure ? "Failure Analysis" : "Build Summary";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{sectionTitle}</CardTitle>
        <CardDescription>
          Changelog, test summary, and artifacts for this build.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          <Card className="bg-background">
            <div className="min-h-[120px] p-3 flex flex-col gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Changelog
              </div>
              {insights.changelogItems.length > 0 ? (
                <ChangelogList items={insights.changelogItems} />
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
                  No changes detected.
                </div>
              )}
              {insights.changelogOverflow > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {formatOverflow(insights.changelogOverflow)}
                </div>
              ) : null}
            </div>
          </Card>
          <Card className="bg-background">
            <div className="min-h-[120px] p-3 flex flex-col gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Tests
              </div>
              <div id="test-summary" className="text-[13px] font-semibold">
                {insights.testSummaryLabel}
              </div>
              {insights.failedTests.length > 0 ? (
                <FailedTestsList items={insights.failedTests} />
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
                  {insights.failedTestsMessage}
                </div>
              )}
              {insights.failedTestsOverflow > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {formatOverflow(insights.failedTestsOverflow)}
                </div>
              ) : null}
            </div>
          </Card>
          <Card className="bg-background">
            <div className="min-h-[120px] p-3 flex flex-col gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Artifacts
              </div>
              {insights.artifacts.length > 0 ? (
                <ArtifactsList
                  items={insights.artifacts}
                  onArtifactAction={onArtifactAction}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
                  No artifacts available.
                </div>
              )}
              {insights.artifactsOverflow > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {formatOverflow(insights.artifactsOverflow)}
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}

function formatOverflow(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  return `+${value.toLocaleString()} more`;
}

function ChangelogList({ items }: { items: BuildFailureChangelogItem[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {items.map((item, index) => {
        const metaParts = [item.author];
        if (item.commitId) {
          metaParts.push(item.commitId);
        }
        return (
          <li className="flex flex-col gap-1" key={`${item.message}-${index}`}>
            <div className="text-[13px] font-semibold text-foreground">
              {item.message}
            </div>
            <div className="text-xs text-muted-foreground break-words">
              {metaParts.join(" • ")}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function FailedTestsList({ items }: { items: BuildFailureFailedTest[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-3">
      {items.map((item, index) => (
        <li className="flex flex-col gap-1" key={`${item.name}-${index}`}>
          <div className="text-[13px] font-semibold text-foreground">
            {item.name || "Unnamed test"}
          </div>
          {item.className ? (
            <div className="text-xs text-muted-foreground break-words">
              {item.className}
            </div>
          ) : null}
          {item.errorDetails ? (
            <div className="text-xs text-foreground whitespace-pre-wrap break-words">
              {item.errorDetails}
            </div>
          ) : null}
          {item.durationLabel ? (
            <div className="text-[11px] text-muted-foreground">
              Duration • {item.durationLabel}
            </div>
          ) : null}
          {item.errorStackTrace ? (
            <FailedTestDetail
              label="Stack trace"
              value={item.errorStackTrace}
            />
          ) : null}
          {item.stdout ? (
            <FailedTestDetail label="Stdout" value={item.stdout} />
          ) : null}
          {item.stderr ? (
            <FailedTestDetail label="Stderr" value={item.stderr} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function FailedTestDetail({ label, value }: { label: string; value: string }) {
  return (
    <details className="rounded-lg border border-border bg-background/40 px-2 py-1.5">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background px-2 py-1 text-[11px] font-mono leading-5">
        {value}
      </pre>
    </details>
  );
}

function ArtifactsList({
  items,
  onArtifactAction,
}: {
  items: BuildFailureArtifact[];
  onArtifactAction: (
    action: ArtifactAction,
    artifact: BuildFailureArtifact
  ) => void;
}) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {items.map((item, index) => (
        <li
          className="flex items-center justify-between gap-2"
          key={`${item.relativePath}-${index}`}
        >
          <div className="text-[13px] break-words">
            {item.name || "Artifact"}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs"
              onClick={() => onArtifactAction("preview", item)}
            >
              Preview
            </Button>
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs"
              onClick={() => onArtifactAction("download", item)}
            >
              Download
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
