import * as React from "react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from "react";
import type {
  BuildDetailsUpdateMessage,
  BuildDetailsViewModel,
  BuildFailureArtifact,
  BuildFailureChangelogItem,
  BuildFailureFailedTest,
  BuildFailureInsightsViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "../shared/BuildDetailsContracts";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Separator } from "./components/ui/separator";
import { Switch } from "./components/ui/switch";
import { stripAnsi } from "./lib/ansi";
import type { ConsoleHtmlModel } from "./lib/consoleHtml";
import { parseConsoleHtml, renderConsoleHtmlWithHighlights } from "./lib/consoleHtml";
import { cn } from "./lib/utils";
import { ConsoleSearchToolbar } from "./components/ConsoleSearchToolbar";
import { useConsoleSearch } from "./hooks/useConsoleSearch";

const { useEffect, useMemo, useReducer, useState } = React;

type VsCodeApi = {
  postMessage: (message: unknown) => void;
};

type BuildDetailsIncomingMessage =
  | { type: "appendConsole"; text?: string }
  | { type: "appendConsoleHtml"; html?: string }
  | { type: "setConsole"; text?: string; truncated?: boolean }
  | { type: "setConsoleHtml"; html?: string; truncated?: boolean }
  | { type: "setErrors"; errors?: string[] }
  | { type: "setFollowLog"; value?: unknown }
  | BuildDetailsUpdateMessage;

type BuildDetailsState = BuildDetailsViewModel & {
  consoleHtmlModel?: ConsoleHtmlModel;
};

type BuildDetailsAction =
  | { type: "appendConsole"; text: string }
  | { type: "appendConsoleHtml"; html: string }
  | { type: "setConsole"; text: string; truncated: boolean }
  | { type: "setConsoleHtml"; html: string; truncated: boolean }
  | { type: "setErrors"; errors: string[] }
  | { type: "setFollowLog"; value: boolean }
  | { type: "updateDetails"; payload: BuildDetailsUpdateMessage };

const DEFAULT_INSIGHTS: BuildFailureInsightsViewModel = {
  changelogItems: [],
  changelogOverflow: 0,
  testSummaryLabel: "No test results.",
  failedTests: [],
  failedTestsOverflow: 0,
  failedTestsMessage: "No failed tests.",
  artifacts: [],
  artifactsOverflow: 0
};

const FALLBACK_STATE: BuildDetailsState = {
  displayName: "Build Details",
  resultLabel: "Unknown",
  resultClass: "neutral",
  durationLabel: "Unknown",
  timestampLabel: "Unknown",
  culpritsLabel: "Unknown",
  pipelineStages: [],
  insights: DEFAULT_INSIGHTS,
  consoleText: "",
  consoleHtml: undefined,
  consoleHtmlModel: undefined,
  consoleTruncated: false,
  consoleMaxChars: 0,
  errors: [],
  followLog: true
};

const STATUS_CLASS_MAP: Record<string, string> = {
  success: "text-success",
  failure: "text-failure",
  unstable: "text-warning",
  aborted: "text-aborted",
  running: "text-warning",
  neutral: "text-foreground"
};

function getStatusClass(status?: string): string {
  if (!status) {
    return STATUS_CLASS_MAP.neutral;
  }
  return STATUS_CLASS_MAP[status] ?? STATUS_CLASS_MAP.neutral;
}

function getVsCodeApi(): VsCodeApi {
  const api = (window as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi;
  if (api) {
    return api();
  }
  return { postMessage: () => undefined };
}

const vscode = getVsCodeApi();

function splitConsoleError(errors: string[]): { consoleError?: string; displayErrors: string[] } {
  let consoleError: string | undefined;
  const displayErrors: string[] = [];
  for (const error of errors) {
    if (
      !consoleError &&
      typeof error === "string" &&
      error.toLowerCase().startsWith("console output:")
    ) {
      consoleError = error.replace(/^console output:\s*/i, "").trim();
    } else {
      displayErrors.push(error);
    }
  }
  if (consoleError && consoleError.length === 0) {
    consoleError = undefined;
  }
  return { consoleError, displayErrors };
}

function buildInitialState(initialState: BuildDetailsViewModel): BuildDetailsState {
  const merged: BuildDetailsState = {
    ...FALLBACK_STATE,
    ...initialState,
    consoleHtmlModel: undefined
  };
  if (merged.consoleHtml) {
    return {
      ...merged,
      consoleHtmlModel: parseConsoleHtml(merged.consoleHtml),
      consoleHtml: undefined
    };
  }
  return merged;
}

function buildDetailsReducer(state: BuildDetailsState, action: BuildDetailsAction): BuildDetailsState {
  switch (action.type) {
    case "appendConsole": {
      if (!action.text) {
        return state;
      }
      return {
        ...state,
        consoleText: state.consoleText + action.text,
        consoleHtml: undefined,
        consoleHtmlModel: undefined,
        consoleError: undefined
      };
    }
    case "appendConsoleHtml": {
      if (!action.html) {
        return state;
      }
      const nextModel = appendConsoleHtmlModel(state.consoleHtmlModel, action.html);
      return {
        ...state,
        consoleHtml: undefined,
        consoleHtmlModel: nextModel,
        consoleError: undefined
      };
    }
    case "setConsole": {
      return {
        ...state,
        consoleText: action.text,
        consoleHtml: undefined,
        consoleHtmlModel: undefined,
        consoleTruncated: action.truncated,
        consoleError: undefined
      };
    }
    case "setConsoleHtml": {
      const nextModel = appendConsoleHtmlModel(undefined, action.html);
      return {
        ...state,
        consoleHtml: undefined,
        consoleHtmlModel: nextModel,
        consoleTruncated: action.truncated,
        consoleError: undefined
      };
    }
    case "setErrors": {
      const { consoleError, displayErrors } = splitConsoleError(action.errors);
      return {
        ...state,
        errors: displayErrors,
        consoleError
      };
    }
    case "setFollowLog": {
      return { ...state, followLog: action.value };
    }
    case "updateDetails": {
      const payload = action.payload;
      return {
        ...state,
        resultLabel: payload.resultLabel,
        resultClass: payload.resultClass,
        durationLabel: payload.durationLabel,
        timestampLabel: payload.timestampLabel,
        culpritsLabel: payload.culpritsLabel,
        insights: payload.insights,
        pipelineStages: payload.pipelineStages
      };
    }
    default:
      return state;
  }
}

function appendConsoleHtmlModel(
  current: ConsoleHtmlModel | undefined,
  htmlChunk: string
): ConsoleHtmlModel {
  const parsed = parseConsoleHtml(htmlChunk);
  if (!current) {
    return parsed;
  }
  return {
    nodes: [...current.nodes, ...parsed.nodes],
    text: current.text + parsed.text
  };
}

function formatOverflow(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  return `+${value.toLocaleString()} more`;
}

function collectStageKeys(
  stages: PipelineStageViewModel[],
  keys = new Set<string>()
): Set<string> {
  for (const stage of stages) {
    if (typeof stage.key === "string") {
      keys.add(stage.key);
    }
    if (Array.isArray(stage.parallelBranches)) {
      collectStageKeys(stage.parallelBranches, keys);
    }
  }
  return keys;
}

function pruneStageState(
  prev: Record<string, boolean>,
  validKeys: Set<string>
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(prev)) {
    if (validKeys.has(key)) {
      next[key] = value;
    }
  }
  return next;
}

function StatusText({
  label,
  status,
  className
}: {
  label: string;
  status?: string;
  className?: string;
}) {
  const statusClass = getStatusClass(status);
  return <span className={cn("font-semibold", statusClass, className)}>{label}</span>;
}

function StatusPill({
  label,
  status,
  className,
  id
}: {
  label: string;
  status?: string;
  className?: string;
  id?: string;
}) {
  const statusClass = getStatusClass(status);
  return (
    <Badge id={id} variant="outline" className={cn("border-current bg-muted text-xs", statusClass, className)}>
      {label}
    </Badge>
  );
}

function StepsList({ steps }: { steps: PipelineStageStepViewModel[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {steps.map((step, index) => (
        <li
          className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2"
          key={`${step.name}-${index}`}
        >
          <div className="text-xs font-semibold text-foreground">{step.name || "Step"}</div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <StatusText
              label={step.statusLabel || "Unknown"}
              status={step.statusClass}
              className="text-[11px]"
            />
            <span>{step.durationLabel || "Unknown"}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BranchSteps({
  branch,
  showAll
}: {
  branch: PipelineStageViewModel;
  showAll: boolean;
}) {
  const steps = showAll ? branch.stepsAll : branch.stepsFailedOnly;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="font-semibold text-foreground">{branch.name || "Branch"}</div>
        <StatusText
          label={branch.statusLabel || "Unknown"}
          status={branch.statusClass}
          className="text-[11px]"
        />
        <div className="text-[11px] text-muted-foreground">{branch.durationLabel || "Unknown"}</div>
      </div>
      {steps.length > 0 ? (
        <StepsList steps={steps} />
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
          {showAll ? "No steps available." : "No failed steps."}
        </div>
      )}
    </div>
  );
}

function StageCard({
  stage,
  expanded,
  showAll,
  onToggleExpanded,
  onToggleShowAll
}: {
  stage: PipelineStageViewModel;
  expanded: boolean;
  showAll: boolean;
  onToggleExpanded: () => void;
  onToggleShowAll: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const hasBranches = stage.parallelBranches.length > 0;
  const hasSteps = Boolean(stage.hasSteps);
  const steps = showAll ? stage.stepsAll : stage.stepsFailedOnly;
  const titleLabel = expanded ? "Hide steps" : "Show steps";
  const expandedClass = expanded ? "border-ring ring-1 ring-ring" : "";

  return (
    <Card className={cn("bg-background transition-colors", expandedClass)} data-stage-key={stage.key}>
      <div className="flex flex-col gap-3 p-3">
        <button
          type="button"
          className="w-full border-0 bg-transparent p-0 text-left cursor-pointer font-inherit text-inherit flex flex-col gap-2"
          onClick={onToggleExpanded}
        >
          <div className="flex items-center justify-between gap-2.5">
            <div className="text-sm font-semibold text-foreground">{stage.name || "Stage"}</div>
            <StatusPill
              label={stage.statusLabel || "Unknown"}
              status={stage.statusClass}
              className="text-[11px]"
            />
          </div>
          <div className="flex items-center justify-between gap-2.5 text-xs text-muted-foreground">
            <div>{stage.durationLabel || "Unknown"}</div>
            <div className="text-[11px] text-primary">{titleLabel}</div>
          </div>
        </button>
        {hasBranches ? (
          <div className="flex flex-col gap-2">
            {stage.parallelBranches.map((branch, index) => (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2"
                key={`${branch.key}-${index}`}
              >
                <div className="text-xs font-semibold text-foreground">
                  {branch.name || "Branch"}
                </div>
                <StatusText
                  label={branch.statusLabel || "Unknown"}
                  status={branch.statusClass}
                  className="text-[11px]"
                />
                <div className="text-[11px] text-muted-foreground">
                  {branch.durationLabel || "Unknown"}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div
          className="border-t border-dashed border-border pt-3 flex flex-col gap-3"
          hidden={!expanded}
        >
          {hasSteps ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Steps
              </div>
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0 text-xs"
                onClick={onToggleShowAll}
              >
                {showAll ? "Show failed steps" : "Show all steps"}
              </Button>
            </div>
          ) : null}
          {hasBranches ? (
            stage.parallelBranches.map((branch, index) => (
              <BranchSteps branch={branch} showAll={showAll} key={`${branch.key}-${index}`} />
            ))
          ) : hasSteps ? (
            steps.length > 0 ? (
              <StepsList steps={steps} />
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
                {showAll ? "No steps available." : "No failed steps."}
              </div>
            )
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
              No steps available.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
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
            <div className="text-[13px] font-semibold text-foreground">{item.message}</div>
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
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {items.map((item, index) => (
        <li className="flex flex-col gap-1" key={`${item.name}-${index}`}>
          <div className="text-[13px] font-semibold text-foreground">
            {item.name || "Unnamed test"}
          </div>
          {item.className ? (
            <div className="text-xs text-muted-foreground break-words">{item.className}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ArtifactsList({ items }: { items: BuildFailureArtifact[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {items.map((item, index) => (
        <li className="flex items-center justify-between gap-2" key={`${item.relativePath}-${index}`}>
          <div className="text-[13px] break-words">{item.name || "Artifact"}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs"
              data-artifact-action="preview"
              data-artifact-path={item.relativePath}
              data-artifact-name={item.fileName ?? ""}
            >
              Preview
            </Button>
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs"
              data-artifact-action="download"
              data-artifact-path={item.relativePath}
              data-artifact-name={item.fileName ?? ""}
            >
              Download
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BuildDetailsApp({ initialState }: { initialState: BuildDetailsViewModel }) {
  const [state, dispatch] = useReducer(buildDetailsReducer, initialState, buildInitialState);
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [showAllStages, setShowAllStages] = useState<Record<string, boolean>>({});
  const displayConsoleText = useMemo(() => stripAnsi(state.consoleText), [state.consoleText]);
  const consoleHtmlModel = state.consoleHtmlModel;
  const consoleSourceText = consoleHtmlModel?.text ?? displayConsoleText;
  const consoleSearch = useConsoleSearch(consoleSourceText);
  const consoleSegments = useMemo(() => {
    if (consoleHtmlModel) {
      return renderConsoleHtmlWithHighlights(
        consoleHtmlModel,
        consoleSearch.matches,
        consoleSearch.activeMatchIndex
      );
    }
    return consoleSearch.consoleSegments;
  }, [
    consoleHtmlModel,
    consoleSearch.matches,
    consoleSearch.activeMatchIndex,
    consoleSearch.consoleSegments
  ]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as BuildDetailsIncomingMessage | null;
      if (!message || typeof message !== "object") {
        return;
      }
      switch (message.type) {
        case "appendConsole":
          if (typeof message.text === "string" && message.text.length > 0) {
            dispatch({ type: "appendConsole", text: message.text });
          }
          break;
        case "appendConsoleHtml":
          if (typeof message.html === "string" && message.html.length > 0) {
            dispatch({ type: "appendConsoleHtml", html: message.html });
          }
          break;
        case "setConsole":
          dispatch({
            type: "setConsole",
            text: typeof message.text === "string" ? message.text : "",
            truncated: Boolean(message.truncated)
          });
          break;
        case "setConsoleHtml":
          dispatch({
            type: "setConsoleHtml",
            html: typeof message.html === "string" ? message.html : "",
            truncated: Boolean(message.truncated)
          });
          break;
        case "updateDetails":
          dispatch({ type: "updateDetails", payload: message });
          break;
        case "setErrors":
          dispatch({
            type: "setErrors",
            errors: Array.isArray(message.errors) ? message.errors : []
          });
          break;
        case "setFollowLog":
          dispatch({ type: "setFollowLog", value: Boolean(message.value) });
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const validKeys = collectStageKeys(state.pipelineStages);
    setExpandedStages((prev) => pruneStageState(prev, validKeys));
    setShowAllStages((prev) => pruneStageState(prev, validKeys));
  }, [state.pipelineStages]);

  const consoleScrollKey = useMemo(
    () => `${consoleSourceText.length}-${state.consoleError ?? ""}`,
    [consoleSourceText, state.consoleError]
  );

  useEffect(() => {
    if (!state.followLog || consoleSearch.isSearchActive) {
      return;
    }
    if (consoleScrollKey || consoleScrollKey === "") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    }
  }, [state.followLog, consoleScrollKey, consoleSearch.isSearchActive]);

  useEffect(() => {
    const handleClick = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const artifactLink = target.closest("[data-artifact-action]") as HTMLElement | null;
      if (artifactLink) {
        const action = artifactLink.getAttribute("data-artifact-action");
        const relativePath = artifactLink.getAttribute("data-artifact-path");
        const fileName = artifactLink.getAttribute("data-artifact-name") ?? undefined;
        if (!action || !relativePath) {
          return;
        }
        event.preventDefault();
        vscode.postMessage({
          type: "artifactAction",
          action,
          relativePath,
          fileName
        });
        return;
      }
      const link = target.closest("a[data-external-url]") as HTMLElement | null;
      if (link) {
        const url = link.getAttribute("data-external-url");
        if (!url) {
          return;
        }
        event.preventDefault();
        vscode.postMessage({ type: "openExternal", url });
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const consoleNote = useMemo(() => {
    if (!state.consoleTruncated) {
      return "";
    }
    const maxChars = Number.isFinite(state.consoleMaxChars) ? state.consoleMaxChars : 0;
    return `Showing last ${maxChars.toLocaleString()} characters of console output.`;
  }, [state.consoleTruncated, state.consoleMaxChars]);

  const pipelineStages = state.pipelineStages;
  const insights = state.insights ?? DEFAULT_INSIGHTS;
  const hasConsoleOutput = consoleSourceText.length > 0;

  const handleFollowLogChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.checked;
    dispatch({ type: "setFollowLog", value: nextValue });
    vscode.postMessage({ type: "toggleFollowLog", value: nextValue });
    if (nextValue) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    }
  };

  const handleExportLogs = () => {
    vscode.postMessage({ type: "exportConsole" });
  };

  return (
    <div className="min-h-screen px-6 py-6 flex flex-col gap-6">
      {state.errors.length > 0 ? (
        <Alert id="errors" variant="destructive" className="flex flex-col gap-1.5">
          {state.errors.map((error) => (
            <AlertDescription className="text-[13px]" key={error}>
              {error}
            </AlertDescription>
          ))}
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle id="detail-title" className="text-xl">
                {state.displayName}
              </CardTitle>
              <CardDescription>Build status and runtime metadata.</CardDescription>
            </div>
            <StatusPill
              id="detail-result"
              label={state.resultLabel}
              status={state.resultClass}
              className="text-sm"
            />
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-y-3 gap-x-5">
            <div className="flex flex-col gap-1">
              <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                Duration
              </div>
              <div id="detail-duration" className="text-sm font-medium">
                {state.durationLabel}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                Timestamp
              </div>
              <div id="detail-timestamp" className="text-sm font-medium">
                {state.timestampLabel}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                Culprit(s)
              </div>
              <div id="detail-culprits" className="text-sm font-medium">
                {state.culpritsLabel}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {pipelineStages.length > 0 ? (
        <Card id="pipeline-section">
          <CardHeader>
            <CardTitle className="text-base">Pipeline Stages</CardTitle>
            <CardDescription>Stage status, duration, and steps from Jenkins Pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              id="pipeline-stages"
              className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3"
            >
              {pipelineStages.map((stage, index) => {
                const stageKey = typeof stage.key === "string" ? stage.key : "";
                const expanded = expandedStages[stageKey] ?? false;
                const showAll = showAllStages[stageKey] ?? false;
                return (
                  <StageCard
                    key={stageKey || `stage-${index}`}
                    stage={stage}
                    expanded={expanded}
                    showAll={showAll}
                    onToggleExpanded={() =>
                      setExpandedStages((prev) => ({
                        ...prev,
                        [stageKey]: !expanded
                      }))
                    }
                    onToggleShowAll={(event) => {
                      event.stopPropagation();
                      setShowAllStages((prev) => ({
                        ...prev,
                        [stageKey]: !showAll
                      }));
                    }}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Build Failure Insights</CardTitle>
          <CardDescription>Changelog, test summary, and artifacts for this build.</CardDescription>
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
                  <ArtifactsList items={insights.artifacts} />
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

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-base">Console Output</CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={handleExportLogs}>
                Export Logs
              </Button>
              <div className="flex items-center gap-2">
                <Switch id="follow-log" checked={state.followLog} onChange={handleFollowLogChange} />
                <label htmlFor="follow-log" className="text-xs text-muted-foreground select-none">
                  Follow Log
                </label>
              </div>
            </div>
          </div>
          <ConsoleSearchToolbar
            visible={consoleSearch.showSearchToolbar}
            query={consoleSearch.searchQuery}
            useRegex={consoleSearch.useRegex}
            matchCountLabel={consoleSearch.matchCountLabel}
            matchCount={consoleSearch.matchCount}
            isSearchActive={consoleSearch.isSearchActive}
            error={consoleSearch.searchError}
            tooManyMatchesLabel={consoleSearch.tooManyMatchesLabel}
            inputRef={consoleSearch.searchInputRef}
            onChange={consoleSearch.handleSearchChange}
            onKeyDown={consoleSearch.handleSearchKeyDown}
            onToggleRegex={() => consoleSearch.setUseRegex((prev) => !prev)}
            onPrev={() => consoleSearch.handleSearchStep("prev")}
            onNext={() => consoleSearch.handleSearchStep("next")}
            onClear={consoleSearch.handleClearSearch}
          />
          {consoleNote ? (
            <div id="console-note" className="text-xs text-muted-foreground">
              {consoleNote}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {state.consoleError ? (
            <Alert id="console-error" variant="warning">
              <AlertDescription className="text-[13px]">{state.consoleError}</AlertDescription>
            </Alert>
          ) : null}
          {!state.consoleError && hasConsoleOutput ? (
            <pre
              id="console-output"
              ref={consoleSearch.consoleOutputRef}
              className="m-0 rounded-lg border border-border bg-background px-4 py-3.5 font-mono text-[length:var(--vscode-editor-font-size)] leading-6 whitespace-pre overflow-x-auto"
            >
              {consoleSegments}
            </pre>
          ) : null}
          {!state.consoleError && !hasConsoleOutput ? (
            <div
              id="console-empty"
              className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground"
            >
              No console output available.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function getInitialState(): BuildDetailsViewModel {
  const candidate = (window as { __INITIAL_STATE__?: BuildDetailsViewModel }).__INITIAL_STATE__;
  if (!candidate) {
    return FALLBACK_STATE;
  }
  return {
    ...FALLBACK_STATE,
    ...candidate,
    insights: candidate.insights ?? DEFAULT_INSIGHTS
  };
}
