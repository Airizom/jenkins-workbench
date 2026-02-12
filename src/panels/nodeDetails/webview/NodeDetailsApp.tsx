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
          {state.loading ? <Progress indeterminate className="h-px rounded-none" /> : null}
          <div className="mx-auto max-w-6xl px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted ${statusStyle.icon}`}
                >
                  <ServerIcon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-sm font-semibold leading-tight truncate">
                      {state.displayName}
                    </h1>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusStyle.badge)}>
                      {state.statusLabel}
                    </Badge>
                    {isStale ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-warning-border text-warning bg-warning-soft"
                      >
                        Stale
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{state.name}</span>
                    {state.description ? (
                      <>
                        <span aria-hidden="true" className="opacity-30">·</span>
                        <span className="truncate">{state.description}</span>
                      </>
                    ) : null}
                    <span aria-hidden="true" className="opacity-30">·</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1">
                          <ClockIcon className="h-3 w-3" />
                          {updatedAtLabel}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{updatedAtTitle}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={state.loading}
                      aria-label="Refresh node details"
                      className="h-7 w-7 p-0"
                    >
                      <RefreshIcon className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
                {nodeAction ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNodeAction}
                    disabled={state.loading}
                    className="h-7 px-2 text-xs"
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
                    className="gap-1 h-7 px-2 text-xs"
                  >
                    <LaunchIcon className="h-3.5 w-3.5" />
                    Launch
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpen}
                  disabled={!state.url}
                  className="gap-1 h-7 px-2 text-xs"
                >
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {canOpenAgentInstructions ? "Instructions" : "Jenkins"}
                  </span>
                </Button>
              </div>
            </div>
          </div>
          <div className={cn("h-px", STATUS_ACCENT[state.statusClass])} />
        </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-3" aria-busy={state.loading}>
        {showOfflineBanner ? (
          <Alert variant="warning" className="mb-3 py-2">
            <AlertTitle className="text-xs">{state.statusLabel}</AlertTitle>
            <AlertDescription className="text-xs">
              {state.offlineReason ?? "Jenkins reported this node as offline."}
            </AlertDescription>
          </Alert>
        ) : null}

        {state.errors.length > 0 ? (
          <Alert variant="destructive" className="mb-3 py-2">
            <AlertTitle className="text-xs">Unable to load full node details</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {state.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <Tabs defaultValue="overview" className="space-y-3">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="executors" className="text-xs">
              Executors
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border border-border bg-muted-soft px-1 text-[10px] text-muted-foreground">
                {state.executors.length + state.oneOffExecutors.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="labels" className="text-xs">Labels</TabsTrigger>
            <TabsTrigger value="advanced" className="text-xs">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {overviewRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted">
                    {row.icon}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {row.label}
                    </div>
                    <div className="text-xs font-semibold">{row.value}</div>
                  </div>
                </div>
              ))}
            </div>
            {state.offlineReason ? (
              <Alert variant="warning" className="py-2">
                <AlertDescription className="text-xs">
                  <span className="font-semibold">Offline reason: </span>
                  {state.offlineReason}
                </AlertDescription>
              </Alert>
            ) : null}
          </TabsContent>

          <TabsContent value="executors" className="space-y-3">
            <ExecutorsTableCard title="Executors" entries={state.executors} />
            {state.oneOffExecutors.length > 0 ? (
              <ExecutorsTableCard title="One-off Executors" entries={state.oneOffExecutors} />
            ) : null}
          </TabsContent>

          <TabsContent value="labels" className="space-y-3">
            {state.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {state.labels.map((label) => (
                  <Badge key={label} variant="secondary" className="text-[11px] px-1.5 py-0">
                    {label}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center">
                <TagIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">No labels assigned</span>
              </div>
            )}
          </TabsContent>

          <TabsContent value="advanced" className="space-y-3">
            <Accordion
              type="single"
              collapsible
              onValueChange={handleDiagnosticsToggle}
              className="rounded border border-border bg-muted-soft"
            >
              <AccordionItem value="diagnostics">
                <AccordionTrigger className="w-full px-3 py-2 hover:bg-muted-strong transition-colors">
                  <span className="text-xs font-medium">Monitor Data & Diagnostics</span>
                </AccordionTrigger>
                <AccordionContent className="border-t border-border px-3 pb-3 pt-2">
                  <div className="space-y-2">
                    {!state.advancedLoaded ? (
                      <div className="rounded border border-dashed border-border bg-muted-soft px-3 py-4 text-center text-xs text-muted-foreground">
                        {state.loading
                          ? "Loading diagnostics..."
                          : "Expand to load diagnostics."}
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

            <div className="rounded border border-border">
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-muted-soft">
                <div>
                  <div className="text-xs font-medium">Raw JSON</div>
                  <div className="text-[11px] text-muted-foreground">
                    {state.advancedLoaded ? "Full payload." : "Current detail level."}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyJson}
                  disabled={!state.rawJson}
                  className="gap-1 h-6 px-2 text-[11px]"
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
              {state.rawJson ? (
                <ScrollArea
                  orientation="both"
                  className="max-h-72"
                >
                  <pre className="m-0 px-3 py-2 text-[11px] font-mono whitespace-pre">
                    {state.rawJson}
                  </pre>
                </ScrollArea>
              ) : (
                <div className="px-3 py-3 text-xs text-muted-foreground">No JSON payload available.</div>
              )}
            </div>
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
      <div className="flex items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center">
        <CpuIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">No {title.toLowerCase()} data available</span>
      </div>
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
    <div className="rounded border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted-soft border-b border-border">
        <div className="flex items-center gap-1.5">
          <CpuIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{title}</span>
          <span className="text-[11px] text-muted-foreground">
            ({filteredEntries.length})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
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
          <div className="sm:hidden w-[120px]">
            <Select value={filter} onValueChange={(value) => setFilter(value as ExecutorFilter)}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="idle">Idle</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-muted-soft">
              <TableHead className="text-[11px] py-1.5 px-3">#</TableHead>
              <TableHead className="text-[11px] py-1.5 px-3">Build</TableHead>
              <TableHead className="text-[11px] py-1.5 px-3">Duration</TableHead>
              <TableHead className="text-[11px] py-1.5 px-3">Progress</TableHead>
              <TableHead className="text-[11px] py-1.5 px-3">Link</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEntries.length > 0 ? (
              filteredEntries.map((entry) => <ExecutorTableRow key={entry.id} entry={entry} />)
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="py-4 text-center text-xs text-muted-foreground"
                >
                  No executors match this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
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
      <TableCell className="font-mono text-[11px] text-muted-foreground py-1.5 px-3">{entry.id}</TableCell>
      <TableCell className="py-1.5 px-3">
        <div className="flex flex-col">
          <span className={cn("text-xs", hasWork ? "text-foreground" : "text-muted-foreground")}>
            {buildLabel}
          </span>
          {!hasWork ? (
            <span className="text-[11px] text-muted-foreground">{entry.statusLabel}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground py-1.5 px-3">{durationLabel}</TableCell>
      <TableCell className="py-1.5 px-3">
        {progressPercent !== undefined ? (
          <div className="flex items-center gap-1.5">
            <div className="executor-progress-track w-20">
              <div
                className="executor-progress-bar"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">{progressLabel}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="py-1.5 px-3">
        {entry.workUrl ? (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-[11px] text-link hover:text-link-hover hover:underline"
            onClick={() => postVsCodeMessage({ type: "openExternal", url: entry.workUrl })}
          >
            Open
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
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

interface OverviewRow {
  label: string;
  value: string;
  icon: JSX.Element;
}

function buildOverviewRows(state: NodeDetailsState): OverviewRow[] {
  const rows: OverviewRow[] = [
    { label: "Status", value: state.statusLabel, icon: <StatusIcon className="h-3.5 w-3.5" /> },
    { label: "Idle", value: state.idleLabel, icon: <IdleIcon className="h-3.5 w-3.5" /> },
    {
      label: "Executors",
      value: state.executorsLabel,
      icon: <ExecutorsIcon className="h-3.5 w-3.5" />
    }
  ];

  if (state.jnlpAgentLabel) {
    rows.push({
      label: "JNLP Agent",
      value: state.jnlpAgentLabel,
      icon: <LaunchIcon className="h-3.5 w-3.5" />
    });
  }
  if (state.launchSupportedLabel) {
    rows.push({
      label: "Launch Supported",
      value: state.launchSupportedLabel,
      icon: <LaunchIcon className="h-3.5 w-3.5" />
    });
  }
  if (state.manualLaunchLabel) {
    rows.push({
      label: "Manual Launch",
      value: state.manualLaunchLabel,
      icon: <LaunchIcon className="h-3.5 w-3.5" />
    });
  }

  if (!state.jnlpAgentLabel && !state.launchSupportedLabel && !state.manualLaunchLabel) {
    rows.push({
      label: "Launch",
      value: "Not available",
      icon: <LaunchIcon className="h-3.5 w-3.5" />
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
