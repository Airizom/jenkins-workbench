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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../shared/webview/components/ui/collapsible";
import { LoadingSkeleton } from "../../shared/webview/components/ui/loading-skeleton";
import { Progress } from "../../shared/webview/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/webview/components/ui/tabs";
import {
  ActivityIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CpuIcon,
  ExecutorsIcon,
  ExternalLinkIcon,
  IdleIcon,
  LaunchIcon,
  RefreshIcon,
  ServerIcon,
  StatusIcon,
  TagIcon
} from "../../shared/webview/icons";
import type { NodeMonitorViewModel, NodeStatusClass } from "../shared/NodeDetailsContracts";
import { useNodeDetailsMessages } from "./hooks/useNodeDetailsMessages";
import { postVsCodeMessage } from "./lib/vscodeApi";
import {
  type NodeDetailsState,
  getInitialState,
  nodeDetailsReducer
} from "./state/nodeDetailsState";

const { useEffect, useMemo, useReducer, useState } = React;

const STATUS_STYLES: Record<NodeStatusClass, { badge: string; icon: string }> = {
  online: {
    badge: "border-success/50 text-success bg-success/10",
    icon: "text-success"
  },
  idle: {
    badge: "border-warning/50 text-warning bg-warning/10",
    icon: "text-warning"
  },
  temporary: {
    badge: "border-warning/50 text-warning bg-warning/10",
    icon: "text-warning"
  },
  offline: {
    badge: "border-failure/50 text-failure bg-failure/10",
    icon: "text-failure"
  },
  unknown: {
    badge: "border-border text-foreground bg-muted",
    icon: "text-muted-foreground"
  }
};

const STALE_AFTER_MS = 5 * 60 * 1000;

export function NodeDetailsApp(): JSX.Element {
  const [state, dispatch] = useReducer(nodeDetailsReducer, undefined, getInitialState);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useNodeDetailsMessages(dispatch);

  const overviewRows = useMemo(() => buildOverviewRows(state), [state]);
  const updatedAtDate = useMemo(() => parseDate(state.updatedAt), [state.updatedAt]);
  const updatedAtLabel = useMemo(
    () => formatRelativeTime(updatedAtDate, now),
    [updatedAtDate, now]
  );
  const updatedAtTitle = useMemo(
    () => (updatedAtDate ? updatedAtDate.toLocaleString() : "Unknown"),
    [updatedAtDate]
  );
  const isStale = useMemo(() => isStaleUpdatedAt(updatedAtDate, now), [updatedAtDate, now]);
  const showOfflineBanner = state.statusClass === "offline" || state.statusClass === "temporary";
  const statusStyle = STATUS_STYLES[state.statusClass];

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => clearInterval(intervalId);
  }, []);

  if (state.loading && state.displayName === "Node Details") {
    return <LoadingSkeleton variant="node" />;
  }

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
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky-header">
        {state.loading ? <Progress indeterminate className="h-0.5 rounded-none" /> : null}
        <div className="mx-auto max-w-5xl px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted ${statusStyle.icon}`}
              >
                <ServerIcon />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-semibold">{state.displayName}</h1>
                  <Badge variant="outline" className={statusStyle.badge}>
                    {state.statusLabel}
                  </Badge>
                  {isStale ? (
                    <Badge
                      variant="outline"
                      className="border-warning/50 text-warning bg-warning/10"
                    >
                      Stale
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">{state.name}</div>
                {state.description ? (
                  <div className="text-sm text-muted-foreground">{state.description}</div>
                ) : null}
                <div className="text-xs text-muted-foreground" title={updatedAtTitle}>
                  Last updated {updatedAtLabel}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={state.loading}
                className="gap-1.5"
              >
                <RefreshIcon />
                Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleOpen}
                disabled={!state.url}
                className="gap-1.5"
              >
                <ExternalLinkIcon />
                Open in Jenkins
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-6" aria-busy={state.loading}>
        {showOfflineBanner ? (
          <Alert variant="warning" className="mb-6">
            <AlertTitle>{state.statusLabel}</AlertTitle>
            <AlertDescription>
              {state.offlineReason ?? "Jenkins reported this node as offline."}
            </AlertDescription>
          </Alert>
        ) : null}

        {state.errors.length > 0 ? (
          <Alert variant="destructive" className="mb-6">
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

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="executors">
              Executors
              <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-xs">
                {state.executors.length + state.oneOffExecutors.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="labels">Labels</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ActivityIcon />
                  <CardTitle>Status</CardTitle>
                </div>
                <CardDescription>Current state, executors, and connectivity.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {overviewRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                        {row.icon}
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          {row.label}
                        </div>
                        <div className="text-sm font-medium">{row.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {state.offlineReason ? (
                  <Alert variant="warning" className="mt-4">
                    <AlertDescription>
                      <span className="font-semibold">Offline reason: </span>
                      {state.offlineReason}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="executors" className="space-y-4">
            <ExecutorsTableCard title="Executors" entries={state.executors} />
            {state.oneOffExecutors.length > 0 ? (
              <ExecutorsTableCard title="One-off Executors" entries={state.oneOffExecutors} />
            ) : null}
          </TabsContent>

          <TabsContent value="labels" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TagIcon />
                  <CardTitle>Labels</CardTitle>
                </div>
                <CardDescription>Assigned labels and capabilities.</CardDescription>
              </CardHeader>
              <CardContent>
                {state.labels.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {state.labels.map((label) => (
                      <Badge key={label} variant="secondary" className="text-sm">
                        {label}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-border px-4 py-8 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <TagIcon />
                    </div>
                    <div className="text-sm text-muted-foreground">No labels assigned</div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4">
            <details className="group" onToggle={handleAdvancedToggle}>
              <summary className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 hover:bg-muted/50 transition-colors">
                <span className="font-medium">Monitor Data & Diagnostics</span>
                <ChevronDownIcon className="transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-4 space-y-4">
                {!state.advancedLoaded ? (
                  <div className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    {state.loading
                      ? "Loading advanced diagnostics..."
                      : "Advanced diagnostics load the first time you expand this section."}
                  </div>
                ) : (
                  <>
                    <MonitorCard title="Monitors" entries={state.monitorData} />
                    <MonitorCard title="Load Statistics" entries={state.loadStatistics} />
                  </>
                )}
              </div>
            </details>

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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyJson}
                  disabled={!state.rawJson}
                  className="gap-1.5"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </CardHeader>
              <CardContent>
                {state.rawJson ? (
                  <pre className="max-h-96 overflow-auto rounded border border-border bg-muted/50 p-4 text-xs font-mono">
                    {state.rawJson}
                  </pre>
                ) : (
                  <div className="text-sm text-muted-foreground">No JSON payload available.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function ExecutorsTableCard({
  title,
  entries
}: {
  title: string;
  entries: NodeDetailsState["executors"];
}): JSX.Element {
  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CpuIcon />
            <CardTitle>{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-border px-4 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <CpuIcon />
            </div>
            <div className="text-sm text-muted-foreground">No executor data available</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CpuIcon />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>Work currently assigned to this node.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Executor #</th>
                <th className="px-2 py-2 text-left font-medium">Build</th>
                <th className="px-2 py-2 text-left font-medium">Duration</th>
                <th className="px-2 py-2 text-left font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <ExecutorTableRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

type ExecutorEntry = NodeDetailsState["executors"][number];

function ExecutorTableRow({ entry }: { entry: ExecutorEntry }): JSX.Element {
  const durationLabel = entry.workDurationLabel ?? "—";
  const hasWork = Boolean(entry.workLabel);
  const buildLabel = entry.workLabel ?? "Idle";
  return (
    <tr className="border-t border-border">
      <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{entry.id}</td>
      <td className="px-2 py-2">
        <div className="flex flex-col">
          <span className={hasWork ? "text-foreground" : "text-muted-foreground"}>
            {buildLabel}
          </span>
          {!hasWork ? (
            <span className="text-xs text-muted-foreground">{entry.statusLabel}</span>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-2 text-muted-foreground">{durationLabel}</td>
      <td className="px-2 py-2">
        {entry.workUrl ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-link hover:text-link-hover hover:underline"
            onClick={() => postVsCodeMessage({ type: "openExternal", url: entry.workUrl })}
          >
            Open
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function MonitorCard({
  title,
  entries
}: {
  title: string;
  entries: NodeMonitorViewModel[];
}): JSX.Element {
  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No data available.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Health checks and diagnostic data from Jenkins monitors.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map((entry) => (
          <Collapsible key={entry.key}>
            <CollapsibleTrigger className="w-full rounded-lg border border-border bg-muted/30 px-4 py-2.5 hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-muted-foreground">{entry.key}</span>
                <span className="text-sm font-medium">{entry.summary}</span>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 rounded border border-border bg-muted/50 p-3 text-xs font-mono text-muted-foreground overflow-auto max-h-64">
                {formatJson(entry.raw)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </CardContent>
    </Card>
  );
}

interface OverviewRow {
  label: string;
  value: string;
  icon: JSX.Element;
}

function buildOverviewRows(state: NodeDetailsState): OverviewRow[] {
  const rows: OverviewRow[] = [
    { label: "Status", value: state.statusLabel, icon: <StatusIcon /> },
    { label: "Idle", value: state.idleLabel, icon: <IdleIcon /> },
    { label: "Executors", value: state.executorsLabel, icon: <ExecutorsIcon /> }
  ];

  if (state.jnlpAgentLabel) {
    rows.push({ label: "JNLP Agent", value: state.jnlpAgentLabel, icon: <LaunchIcon /> });
  }
  if (state.launchSupportedLabel) {
    rows.push({
      label: "Launch Supported",
      value: state.launchSupportedLabel,
      icon: <LaunchIcon />
    });
  }
  if (state.manualLaunchLabel) {
    rows.push({ label: "Manual Launch", value: state.manualLaunchLabel, icon: <LaunchIcon /> });
  }

  if (!state.jnlpAgentLabel && !state.launchSupportedLabel && !state.manualLaunchLabel) {
    rows.push({ label: "Launch", value: "Not available", icon: <LaunchIcon /> });
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
