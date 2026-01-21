import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "../../shared/webview/components/ui/alert";
import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../shared/webview/components/ui/card";
import { Separator } from "../../shared/webview/components/ui/separator";
import type { NodeMonitorViewModel, NodeStatusClass } from "../shared/NodeDetailsContracts";
import { postVsCodeMessage } from "./lib/vscodeApi";
import { useNodeDetailsMessages } from "./hooks/useNodeDetailsMessages";
import {
  type NodeDetailsState,
  getInitialState,
  nodeDetailsReducer
} from "./state/nodeDetailsState";

const { useEffect, useMemo, useReducer, useState } = React;

const STATUS_STYLES: Record<NodeStatusClass, string> = {
  online: "border-success/50 text-success bg-success/10",
  idle: "border-warning/50 text-warning bg-warning/10",
  temporary: "border-warning/50 text-warning bg-warning/10",
  offline: "border-failure/50 text-failure bg-failure/10",
  unknown: "border-border text-foreground bg-muted"
};

const STALE_AFTER_MS = 5 * 60 * 1000;

export function NodeDetailsApp(): JSX.Element {
  const [state, dispatch] = useReducer(nodeDetailsReducer, undefined, getInitialState);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useNodeDetailsMessages(dispatch);

  const overviewRows = useMemo(() => buildOverviewRows(state), [state]);
  const updatedAtDate = useMemo(() => parseDate(state.updatedAt), [state.updatedAt]);
  const updatedAtLabel = useMemo(() => formatRelativeTime(updatedAtDate, now), [updatedAtDate, now]);
  const updatedAtTitle = useMemo(
    () => (updatedAtDate ? updatedAtDate.toLocaleString() : "Unknown"),
    [updatedAtDate]
  );
  const isStale = useMemo(() => isStaleUpdatedAt(updatedAtDate, now), [updatedAtDate, now]);
  const showOfflineBanner = state.statusClass === "offline" || state.statusClass === "temporary";

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => clearInterval(intervalId);
  }, []);

  const handleRefresh = () => {
    postVsCodeMessage({ type: "refreshNodeDetails" });
  };

  const handleOpen = () => {
    if (!state.url) {
      return;
    }
    postVsCodeMessage({ type: "openExternal", url: state.url });
  };

  const handleCopyJson = () => {
    if (!state.rawJson) {
      return;
    }
    postVsCodeMessage({ type: "copyNodeJson", content: state.rawJson });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAdvancedToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open && !state.advancedLoaded) {
      postVsCodeMessage({ type: "loadAdvancedNodeDetails" });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Node</div>
              <h1 className="text-base font-semibold">{state.displayName}</h1>
              <div className="text-xs text-muted-foreground">{state.name}</div>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={STATUS_STYLES[state.statusClass]}>
                  {state.statusLabel}
                </Badge>
                {isStale ? (
                  <Badge
                    variant="outline"
                    className="border-inputWarningBorder bg-inputWarningBg text-inputWarningFg"
                  >
                    Stale
                  </Badge>
                ) : null}
                {state.loading ? (
                  <Badge variant="outline" className="border-ring text-link">
                    Refreshing
                  </Badge>
                ) : null}
                <Button variant="outline" size="sm" onClick={handleRefresh} disabled={state.loading}>
                  Refresh
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleOpen}
                  disabled={!state.url}
                >
                  Open in Jenkins
                </Button>
              </div>
              <div className="text-xs text-muted-foreground" title={updatedAtTitle}>
                Last updated {updatedAtLabel}
              </div>
            </div>
          </div>
          {state.description ? (
            <div className="text-sm text-muted-foreground">{state.description}</div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6" aria-busy={state.loading}>
        {showOfflineBanner ? (
          <Alert variant="warning">
            <AlertTitle>{state.statusLabel}</AlertTitle>
            <AlertDescription>
              {state.offlineReason ?? "Jenkins reported this node as offline."}
            </AlertDescription>
          </Alert>
        ) : null}
        {state.errors.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to load full node details</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {state.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Current state, executors, and connectivity.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {overviewRows.map((row) => (
                <div key={row.label} className="rounded border border-border px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</div>
                  <div className="text-sm font-medium">{row.value}</div>
                </div>
              ))}
            </div>
            {state.offlineReason ? (
              <div className="mt-4 rounded border border-border bg-muted/50 px-3 py-2 text-sm">
                <span className="font-semibold">Offline reason: </span>
                {state.offlineReason}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Labels</CardTitle>
            <CardDescription>Assigned labels and capabilities.</CardDescription>
          </CardHeader>
          <CardContent>
            {state.labels.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {state.labels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No labels reported.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Executors</CardTitle>
            <CardDescription>Work currently assigned to this node.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ExecutorsTable title="Executors" entries={state.executors} />
            <Separator />
            <ExecutorsTable title="One-off Executors" entries={state.oneOffExecutors} />
          </CardContent>
        </Card>

        <details className="rounded border border-border bg-muted/30" onToggle={handleAdvancedToggle}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
            Advanced
            <span className="ml-2 text-xs text-muted-foreground">
              Monitor data, diagnostics, and raw payload
            </span>
          </summary>
          <div className="space-y-6 px-4 pb-4">
            {!state.advancedLoaded ? (
              <div className="rounded border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {state.loading
                  ? "Loading advanced diagnostics..."
                  : "Advanced diagnostics load the first time you expand this section."}
              </div>
            ) : null}
            {state.advancedLoaded ? (
              <Card>
                <CardHeader>
                  <CardTitle>Monitor Data</CardTitle>
                  <CardDescription>
                    Health checks and diagnostic data from Jenkins monitors.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <MonitorSection title="Monitors" entries={state.monitorData} />
                  <Separator />
                  <MonitorSection title="Load Statistics" entries={state.loadStatistics} />
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Raw JSON</CardTitle>
                  <CardDescription>
                    {state.advancedLoaded
                      ? "Full payload for auditing or troubleshooting."
                      : "Payload returned for the current detail level."}
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleCopyJson} disabled={!state.rawJson}>
                  {copied ? "Copied" : "Copy JSON"}
                </Button>
              </CardHeader>
              <CardContent>
                {state.rawJson ? (
                  <pre className="max-h-96 overflow-auto rounded border border-border bg-muted/50 p-3 text-xs font-mono">
                    {state.rawJson}
                  </pre>
                ) : (
                  <div className="text-sm text-muted-foreground">No JSON payload available.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </details>
      </main>
    </div>
  );
}

function ExecutorsTable({
  title,
  entries
}: {
  title: string;
  entries: NodeDetailsState["executors"];
}): JSX.Element {
  if (!entries || entries.length === 0) {
    return (
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">No executor data available.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 space-y-3 md:hidden">
        {entries.map((entry) => (
          <div key={`${title}-card-${entry.id}`} className="rounded border border-border p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono">{entry.id}</span>
              <span>{entry.statusLabel}</span>
            </div>
            <div className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">Work</div>
            <div className="text-sm">{renderWorkLabel(entry, "block truncate")}</div>
            <div className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">Progress</div>
            <div className="text-sm">{entry.progressLabel ?? "—"}</div>
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Executor</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Work</th>
                <th className="px-3 py-2 font-medium">Progress</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${title}-${entry.id}`} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 align-top font-mono text-xs text-muted-foreground">
                    {entry.id}
                  </td>
                  <td className="px-3 py-2 align-top">{entry.statusLabel}</td>
                  <td className="px-3 py-2 align-top">
                    {renderWorkLabel(entry, "block max-w-[360px] truncate")}
                  </td>
                  <td className="px-3 py-2 align-top">{entry.progressLabel ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MonitorSection({
  title,
  entries
}: {
  title: string;
  entries: NodeMonitorViewModel[];
}): JSX.Element {
  if (!entries || entries.length === 0) {
    return (
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">No data available.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-3 flex flex-col gap-2">
        {entries.map((entry) => (
          <details key={entry.key} className="rounded border border-border bg-muted/50 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">
              <span className="mr-2 text-muted-foreground">{entry.key}</span>
              <span>{entry.summary}</span>
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto text-xs font-mono text-muted-foreground">
              {formatJson(entry.raw)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}

function buildOverviewRows(state: NodeDetailsState): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Status", value: state.statusLabel },
    { label: "Idle", value: state.idleLabel },
    { label: "Executors", value: state.executorsLabel }
  ];

  if (state.jnlpAgentLabel) {
    rows.push({ label: "JNLP Agent", value: state.jnlpAgentLabel });
  }
  if (state.launchSupportedLabel) {
    rows.push({ label: "Launch Supported", value: state.launchSupportedLabel });
  }
  if (state.manualLaunchLabel) {
    rows.push({ label: "Manual Launch", value: state.manualLaunchLabel });
  }

  if (!state.jnlpAgentLabel && !state.launchSupportedLabel && !state.manualLaunchLabel) {
    rows.push({ label: "Launch", value: "Not available" });
  }

  return rows;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value ?? "");
  }
}

type ExecutorEntry = NodeDetailsState["executors"][number];

function renderWorkLabel(entry: ExecutorEntry, className?: string): JSX.Element {
  if (!entry.workLabel) {
    return <span className="text-muted-foreground">None</span>;
  }
  if (entry.workUrl) {
    return (
      <button
        type="button"
        className={`text-link hover:text-link-hover hover:underline cursor-pointer border-0 bg-transparent p-0 ${className ?? ""}`.trim()}
        title={entry.workLabel}
        onClick={() => postVsCodeMessage({ type: "openExternal", url: entry.workUrl })}
      >
        {entry.workLabel}
      </button>
    );
  }
  return (
    <span className={className} title={entry.workLabel}>
      {entry.workLabel}
    </span>
  );
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatRelativeTime(date: Date | undefined, now: number): string {
  if (!date) {
    return "Unknown";
  }
  const deltaMs = Math.abs(now - date.getTime());
  if (deltaMs < 15_000) {
    return "Just now";
  }
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function isStaleUpdatedAt(date: Date | undefined, now: number): boolean {
  if (!date) {
    return false;
  }
  return now - date.getTime() > STALE_AFTER_MS;
}
