import * as React from "react";
import { isPlainRecord } from "../../../shared/runtimeGuards";
import { EmptyState } from "../../shared/webview/components/EmptyState";
import { PanelHeader } from "../../shared/webview/components/PanelHeader";
import { Alert, AlertDescription } from "../../shared/webview/components/ui/alert";
import { Button } from "../../shared/webview/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../shared/webview/components/ui/collapsible";
import { DisclosureChevron } from "../../shared/webview/components/ui/disclosure-chevron";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../shared/webview/components/ui/select";
import { ExternalLinkIcon, RefreshIcon } from "../../shared/webview/icons";
import {
  getVsCodeState,
  postVsCodeMessage,
  setVsCodeState
} from "../../shared/webview/lib/vscodeApi";
import {
  type HistoryUiState,
  type HistoryViewModel,
  historyJobDisplayName,
  normalizeHistoryUi
} from "../shared/HistoryContracts";
import { HistoryBaselineSection } from "./HistoryBaselineSection";
import { HistoryBuildsTable } from "./HistoryBuildsTable";
import { HistoryContext } from "./HistoryContext";
import { type HistorySend, useHistoryAction } from "./HistoryOutcomes";
import { HistoryTestsSection } from "./HistoryTestsSection";
import { failureHistorySummary, historyAnnouncement } from "./historyPresentation";

const WINDOW_SIZES = [10, 20, 50] as const;

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
      <RefreshIcon aria-hidden="true" className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function HistoryToolbar({
  model,
  embedded,
  setUi,
  ui,
  send
}: {
  model: HistoryViewModel;
  embedded: boolean;
  ui: HistoryUiState;
  setUi: (ui: HistoryUiState) => void;
  send: HistorySend;
}) {
  const loading = model.status === "loading";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span id="history-window-label">Build window</span>
        <Select
          value={String(model.count)}
          onValueChange={(value) => {
            const count = Number(value) as 10 | 20 | 50;
            setUi({ ...ui, count });
            send("window", count);
          }}
        >
          <SelectTrigger aria-labelledby="history-window-label" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_SIZES.map((count) => (
              <SelectItem key={count} value={String(count)}>
                {count} builds
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={loading || undefined}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        title={loading ? "History is loading" : undefined}
        onClick={() => {
          if (!loading) send("refresh");
        }}
      >
        <RefreshIcon
          aria-hidden="true"
          className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
        />
        {loading ? "Loading…" : "Refresh history"}
      </Button>
      {embedded ? (
        <Button variant="ghost" size="sm" onClick={() => send("openJob")}>
          Open job history
        </Button>
      ) : null}
    </div>
  );
}

function HistoryNotices({ model }: { model: HistoryViewModel }) {
  const notes = [
    model.truncated ? "Lookup capped at 500 build summaries." : "",
    model.testsTruncated
      ? "Test sample capped at 50,000 observations and 5,000 distinct tests. Failing cases are kept first; omitted cases are unavailable, not passing."
      : ""
  ].filter(Boolean);
  if (!notes.length) return null;
  return (
    <Alert variant="info" role="note" className="py-2 text-xs">
      <AlertDescription className="text-xs">{notes.join(" ")}</AlertDescription>
    </Alert>
  );
}

interface HistoryBodyProps {
  model: HistoryViewModel;
  embedded: boolean;
  buildRunning: boolean;
  ui: HistoryUiState;
  setUi: (ui: HistoryUiState) => void;
  send: HistorySend;
}

function IdleState({ model, send }: { model: HistoryViewModel; send: HistorySend }) {
  if (!model.jobUrl) return <LoadingState label="Loading history…" />;
  return (
    <EmptyState
      title="History not loaded"
      description="Load recent builds of this job to see failure trends and baseline matches."
      action={
        <Button size="sm" onClick={() => send("refresh")}>
          Load history
        </Button>
      }
    />
  );
}

function PausedState({ send }: { send: HistorySend }) {
  return (
    <EmptyState
      title="Paused while hidden"
      description="History loading stopped when the panel was hidden."
      action={
        <Button size="sm" onClick={() => send("refresh")}>
          Resume
        </Button>
      }
    />
  );
}

function HistoryFailure({ model }: { model: HistoryViewModel }) {
  if (model.status === "error")
    return (
      <Alert variant="destructive">
        <AlertDescription>
          History failed to load{model.message ? `: ${model.message}` : "."}
        </AlertDescription>
      </Alert>
    );
  return (
    <EmptyState
      title="No history available"
      description={model.message ?? "No builds in this window have history to analyze."}
    />
  );
}

function HistoryResults({ model, embedded, ui, setUi, send }: HistoryBodyProps) {
  const toolbar = (
    <HistoryToolbar model={model} embedded={embedded} ui={ui} setUi={setUi} send={send} />
  );
  if (model.status === "loading" && !model.builds.length)
    return (
      <div className="space-y-3">
        {toolbar}
        <LoadingState label="Loading history…" />
      </div>
    );
  if (model.status === "error" || model.status === "unavailable")
    return (
      <div className="space-y-3">
        {toolbar}
        <HistoryFailure model={model} />
      </div>
    );
  return (
    <div className="space-y-4">
      {toolbar}
      {model.message ? (
        <Alert variant="warning">
          <AlertDescription>{model.message}</AlertDescription>
        </Alert>
      ) : null}
      <HistoryNotices model={model} />
      <HistoryBaselineSection model={model} send={send} />
      {!embedded ? (
        <HistoryBuildsTable
          model={model}
          send={send}
          onSelect={(buildNumber) => {
            setUi({ ...ui, selectedBuild: buildNumber });
            send("selectBuild", buildNumber);
          }}
        />
      ) : null}
      <HistoryTestsSection model={model} ui={ui} setUi={setUi} send={send} embedded={embedded} />
    </div>
  );
}

function HistoryBody(props: HistoryBodyProps) {
  const { model, buildRunning, send } = props;
  if (buildRunning || (model.status === "paused" && model.pausedReason === "building"))
    return (
      <EmptyState
        title="Available after the build completes"
        description="Failure history compares finished builds, so it loads once this build has a result."
      />
    );
  if (model.status === "idle") return <IdleState model={model} send={send} />;
  if (model.status === "paused") return <PausedState send={send} />;
  return <HistoryResults {...props} />;
}

export function HistoryView({
  embedded = false,
  buildRunning = false
}: {
  embedded?: boolean;
  /** Build Details passes this while its build runs; history only analyzes completed builds. */
  buildRunning?: boolean;
}) {
  const model = React.useContext(HistoryContext);
  const send = useHistoryAction(model);
  const [ui, setUi] = React.useState(() =>
    normalizeHistoryUi(getVsCodeState<{ historyUi?: unknown }>()?.historyUi)
  );
  React.useEffect(() => {
    const saved = getVsCodeState();
    setVsCodeState({ ...(isPlainRecord(saved) ? saved : {}), historyUi: ui });
    postVsCodeMessage({ type: "persistHistoryUi", uiState: ui });
  }, [ui]);
  // A collapsed embedded disclosure stays quiet; its summary line already shows the state.
  const announcement =
    embedded && !ui.open
      ? ""
      : buildRunning
        ? "History is available after the build completes"
        : historyAnnouncement(model);
  const liveRegion = (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );
  const body = (
    <HistoryBody
      model={model}
      embedded={embedded}
      buildRunning={buildRunning}
      ui={ui}
      setUi={setUi}
      send={send}
    />
  );
  if (embedded) {
    // Nothing is bound yet (Build Details still loading, or a running build it never binds).
    if (!buildRunning && model.status === "idle" && !model.jobUrl) return null;
    return (
      <section
        aria-label="Failure history"
        className="mb-3 rounded-lg border border-border bg-surface"
      >
        {liveRegion}
        <Collapsible open={ui.open} onOpenChange={(open) => setUi({ ...ui, open })}>
          <CollapsibleTrigger
            asChild
            className="justify-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent-soft"
          >
            <button type="button">
              <DisclosureChevron className="mr-0 h-4 w-4" />
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold">Failure history</span>
                <span className="text-xs text-muted-foreground">
                  {failureHistorySummary(model, buildRunning)}
                </span>
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border px-3 py-3">
            {body}
          </CollapsibleContent>
        </Collapsible>
      </section>
    );
  }
  const jobName = model.jobUrl ? historyJobDisplayName(model.jobUrl) : "Job History";
  return (
    <div className="flex min-h-screen flex-col">
      <PanelHeader
        eyebrow="Job History"
        title={jobName}
        wrapTitle
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={!model.jobUrl}
            aria-label="Open in Jenkins"
            onClick={() => send("openJobInJenkins")}
          >
            <ExternalLinkIcon aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Open in Jenkins</span>
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-6xl px-4 py-4" aria-label="Cross-build failure history">
        {liveRegion}
        {body}
      </main>
    </div>
  );
}
