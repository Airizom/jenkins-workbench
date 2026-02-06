import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "../../shared/webview/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "../../shared/webview/components/ui/accordion";
import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../shared/webview/components/ui/card";
import { LoadingSkeleton } from "../../shared/webview/components/ui/loading-skeleton";
import { Progress } from "../../shared/webview/components/ui/progress";
import { ScrollArea } from "../../shared/webview/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../shared/webview/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../shared/webview/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/webview/components/ui/tabs";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import {
  ToggleGroup,
  ToggleGroupItem
} from "../../shared/webview/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "../../shared/webview/components/ui/tooltip";
import {
  ActivityIcon,
  ClockIcon,
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
import { cn } from "../../shared/webview/lib/utils";
import { toast } from "../../shared/webview/hooks/useToast";
import type { NodeMonitorViewModel, NodeStatusClass } from "../shared/NodeDetailsContracts";
import { useNodeDetailsMessages } from "./hooks/useNodeDetailsMessages";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import {
  type NodeDetailsState,
  getInitialState,
  nodeDetailsReducer
} from "./state/nodeDetailsState";

const { useEffect, useMemo, useReducer, useState } = React;

const STATUS_STYLES: Record<NodeStatusClass, { badge: string; icon: string }> = {
  online: {
    badge: "border-success-border text-success bg-success-soft",
    icon: "text-success"
  },
  idle: {
    badge: "border-warning-border text-warning bg-warning-soft",
    icon: "text-warning"
  },
  temporary: {
    badge: "border-warning-border text-warning bg-warning-soft",
    icon: "text-warning"
  },
  offline: {
    badge: "border-failure-border text-failure bg-failure-soft",
    icon: "text-failure"
  },
  unknown: {
    badge: "border-border text-foreground bg-muted",
    icon: "text-muted-foreground"
  }
};

const STATUS_ACCENT: Record<NodeStatusClass, string> = {
  online: "bg-success",
  idle: "bg-warning",
  temporary: "bg-warning",
  offline: "bg-failure",
  unknown: "bg-border"
};

const STALE_AFTER_MS = 5 * 60 * 1000;

export function NodeDetailsApp(): JSX.Element {
  const [state, dispatch] = useReducer(nodeDetailsReducer, undefined, getInitialState);
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
  const nodeAction = useMemo(() => {
    if (state.canTakeOffline) {
      return { type: "takeNodeOffline" as const, label: "Take Offline..." };
    }
    if (state.canBringOnline) {
      return { type: "bringNodeOnline" as const, label: "Bring Online" };
    }
    return undefined;
  }, [state.canTakeOffline, state.canBringOnline]);
  const canLaunchAgent = state.canLaunchAgent;
  const canOpenAgentInstructions = state.canOpenAgentInstructions;

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

  const handleNodeAction = () => {
    if (!nodeAction) {
      return;
    }
    postVsCodeMessage({ type: nodeAction.type });
  };

  const handleLaunchAgent = () => {
    if (!canLaunchAgent) {
      return;
    }
    postVsCodeMessage({ type: "launchNodeAgent" });
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
    toast({
      title: "Copied",
      description: "Node JSON copied to clipboard.",
      variant: "success"
    });
  };

  const handleDiagnosticsToggle = (value: string) => {
    if (value === "diagnostics" && !state.advancedLoaded) {
      postVsCodeMessage({ type: "loadAdvancedNodeDetails" });
    }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <header className="sticky-header">
          {state.loading ? <Progress indeterminate className="h-0.5 rounded-none" /> : null}
          <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex items-start gap-4">
                <div
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted ${statusStyle.icon}`}
                >
                  <ServerIcon className="h-5 w-5" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <h1 className="text-base font-semibold leading-tight tracking-tight">
                      {state.displayName}
                    </h1>
                    <Badge variant="outline" className={statusStyle.badge}>
                      {state.statusLabel}
                    </Badge>
                    {isStale ? (
                      <Badge
                        variant="outline"
                        className="border-warning-border text-warning bg-warning-soft"
                      >
                        Stale
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                    <span>{state.name}</span>
                    {state.description ? (
                      <>
                        <span aria-hidden="true" className="opacity-30">·</span>
                        <span>{state.description}</span>
                      </>
                    ) : null}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <ClockIcon className="h-3.5 w-3.5" />
                        Last updated {updatedAtLabel}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{updatedAtTitle}</TooltipContent>
                  </Tooltip>
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
                  <RefreshIcon className="h-4 w-4" />
                  Refresh
                </Button>
                {nodeAction ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNodeAction}
                    disabled={state.loading}
                    className="gap-1.5"
                  >
                    {nodeAction.label}
                  </Button>
                ) : null}
                {canLaunchAgent ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLaunchAgent}
                    disabled={state.loading}
                    className="gap-1.5"
                  >
                    <LaunchIcon className="h-4 w-4" />
                    Launch Agent
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleOpen}
                  disabled={!state.url}
                  className="gap-1.5"
                >
                  <ExternalLinkIcon className="h-4 w-4" />
                  {canOpenAgentInstructions ? "Agent Instructions" : "Open in Jenkins"}
                </Button>
              </div>
            </div>
          </div>
          <div className={cn("h-0.5", STATUS_ACCENT[state.statusClass])} />
        </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 sm:py-5" aria-busy={state.loading}>
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

        <Tabs defaultValue="overview" className="space-y-5">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="executors">
              Executors
              <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border border-border bg-muted-soft px-1.5 text-xs text-muted-foreground">
                {state.executors.length + state.oneOffExecutors.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="labels">Labels</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-5">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-muted">
                    <ActivityIcon className="h-4 w-4" />
                  </div>
                  <CardTitle>Status</CardTitle>
                </div>
                <CardDescription>Current state, executors, and connectivity.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {overviewRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center gap-3 rounded-lg border border-mutedBorder bg-muted-soft px-4 py-3"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        {row.icon}
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          {row.label}
                        </div>
                        <div className="text-sm font-semibold">{row.value}</div>
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

          <TabsContent value="executors" className="space-y-5">
            <ExecutorsTableCard title="Executors" entries={state.executors} />
            {state.oneOffExecutors.length > 0 ? (
              <ExecutorsTableCard title="One-off Executors" entries={state.oneOffExecutors} />
            ) : null}
          </TabsContent>

          <TabsContent value="labels" className="space-y-5">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-muted">
                    <TagIcon className="h-4 w-4" />
                  </div>
                  <CardTitle>Labels</CardTitle>
                </div>
                <CardDescription>Assigned labels and capabilities.</CardDescription>
              </CardHeader>
              <CardContent>
                {state.labels.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {state.labels.map((label) => (
                      <Badge key={label} variant="secondary" className="text-xs">
                        {label}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-4 py-8 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <TagIcon className="h-5 w-5" />
                    </div>
                    <div className="text-sm text-muted-foreground">No labels assigned</div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-5">
            <Accordion
              type="single"
              collapsible
              onValueChange={handleDiagnosticsToggle}
              className="rounded-lg border border-border bg-muted-soft"
            >
              <AccordionItem value="diagnostics">
                <AccordionTrigger className="w-full px-4 py-3 hover:bg-muted-strong transition-colors">
                  <span className="font-medium">Monitor Data & Diagnostics</span>
                </AccordionTrigger>
                <AccordionContent className="border-t border-border px-4 pb-4 pt-3">
                  <div className="space-y-4">
                    {!state.advancedLoaded ? (
                      <div className="rounded border border-dashed border-border bg-muted-soft px-4 py-6 text-center text-sm text-muted-foreground">
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
                </AccordionContent>
              </AccordionItem>
            </Accordion>

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
                  <CopyIcon />
                  Copy
                </Button>
              </CardHeader>
              <CardContent>
                {state.rawJson ? (
                  <ScrollArea
                    orientation="both"
                    className="max-h-96 rounded-lg border border-border bg-muted-strong shadow-inner"
                  >
                    <pre className="m-0 p-4 text-xs font-mono whitespace-pre">
                      {state.rawJson}
                    </pre>
                  </ScrollArea>
                ) : (
                  <div className="text-sm text-muted-foreground">No JSON payload available.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

        <Toaster />
      </div>
    </TooltipProvider>
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
            <div className="flex h-7 w-7 items-center justify-center rounded bg-muted">
              <CpuIcon className="h-4 w-4" />
            </div>
            <CardTitle>{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-4 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <CpuIcon className="h-5 w-5" />
            </div>
            <div className="text-sm text-muted-foreground">No executor data available</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const [filter, setFilter] = useState<ExecutorFilter>("all");
  const filteredEntries = useMemo(() => {
    if (filter === "all") {
      return entries;
    }
    if (filter === "busy") {
      return entries.filter((entry) => Boolean(entry.workLabel));
    }
    return entries.filter((entry) => !entry.workLabel);
  }, [entries, filter]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-muted">
              <CpuIcon className="h-4 w-4" />
            </div>
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>Work currently assigned to this node.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filteredEntries.length.toLocaleString()} shown
          </span>
          <div className="hidden sm:block">
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(value) => {
                if (!value) {
                  return;
                }
                setFilter(value as ExecutorFilter);
              }}
              aria-label="Executor filter"
            >
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="busy">Busy</ToggleGroupItem>
              <ToggleGroupItem value="idle">Idle</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="sm:hidden w-[150px]">
            <Select value={filter} onValueChange={(value) => setFilter(value as ExecutorFilter)}>
              <SelectTrigger>
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All executors</SelectItem>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="idle">Idle</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-muted-soft">
                <TableHead>Executor #</TableHead>
                <TableHead>Build</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Link</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.length > 0 ? (
                filteredEntries.map((entry) => <ExecutorTableRow key={entry.id} entry={entry} />)
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    No executors match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

type ExecutorEntry = NodeDetailsState["executors"][number];

type ExecutorFilter = "all" | "busy" | "idle";

function ExecutorTableRow({ entry }: { entry: ExecutorEntry }): JSX.Element {
  const durationLabel = entry.workDurationLabel ?? "—";
  const hasWork = Boolean(entry.workLabel);
  const buildLabel = entry.workLabel ?? "Idle";
  const progressPercent =
    typeof entry.progressPercent === "number" ? entry.progressPercent : undefined;
  const progressLabel =
    entry.progressLabel ?? (progressPercent !== undefined ? `${progressPercent}%` : undefined);
  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground">{entry.id}</TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className={hasWork ? "text-foreground" : "text-muted-foreground"}>
            {buildLabel}
          </span>
          {!hasWork ? (
            <span className="text-xs text-muted-foreground">{entry.statusLabel}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{durationLabel}</TableCell>
      <TableCell>
        {progressPercent !== undefined ? (
          <div className="flex items-center gap-2">
            <div className="executor-progress-track w-24">
              <div
                className="executor-progress-bar"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{progressLabel}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {entry.workUrl ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-link hover:text-link-hover hover:underline"
            onClick={() => postVsCodeMessage({ type: "openExternal", url: entry.workUrl })}
          >
            Open
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
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
          <div className="rounded border border-dashed border-border bg-muted-soft px-4 py-6 text-center text-sm text-muted-foreground">
            No data available.
          </div>
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
      <CardContent>
        <Accordion type="multiple" className="space-y-2">
          {entries.map((entry) => (
            <AccordionItem
              key={entry.key}
              value={entry.key}
              className="overflow-hidden rounded-lg border border-mutedBorder bg-muted-soft transition-colors data-[state=open]:border-border data-[state=open]:bg-muted-strong"
            >
              <AccordionTrigger className="w-full px-4 py-2.5 hover:bg-accent-soft">
                <div className="flex flex-1 items-center justify-between gap-2">
                  <span className="text-xs font-mono text-muted-foreground">{entry.key}</span>
                  <span className="text-sm font-medium">{entry.summary}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="border-t border-border px-4 pb-4 pt-3">
                <ScrollArea
                  orientation="both"
                  className="max-h-64 rounded-lg border border-border bg-muted-strong shadow-inner"
                >
                  <pre className="m-0 p-3 text-xs font-mono text-muted-foreground whitespace-pre">
                    {formatJson(entry.raw)}
                  </pre>
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
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
    { label: "Status", value: state.statusLabel, icon: <StatusIcon className="h-4 w-4" /> },
    { label: "Idle", value: state.idleLabel, icon: <IdleIcon className="h-4 w-4" /> },
    {
      label: "Executors",
      value: state.executorsLabel,
      icon: <ExecutorsIcon className="h-4 w-4" />
    }
  ];

  if (state.jnlpAgentLabel) {
    rows.push({
      label: "JNLP Agent",
      value: state.jnlpAgentLabel,
      icon: <LaunchIcon className="h-4 w-4" />
    });
  }
  if (state.launchSupportedLabel) {
    rows.push({
      label: "Launch Supported",
      value: state.launchSupportedLabel,
      icon: <LaunchIcon className="h-4 w-4" />
    });
  }
  if (state.manualLaunchLabel) {
    rows.push({
      label: "Manual Launch",
      value: state.manualLaunchLabel,
      icon: <LaunchIcon className="h-4 w-4" />
    });
  }

  if (!state.jnlpAgentLabel && !state.launchSupportedLabel && !state.manualLaunchLabel) {
    rows.push({
      label: "Launch",
      value: "Not available",
      icon: <LaunchIcon className="h-4 w-4" />
    });
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
