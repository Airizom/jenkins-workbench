import { useEffect, useMemo, useReducer, useState } from "react";
import type { ChangeEvent, MouseEvent } from "react";
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

type VsCodeApi = {
  postMessage: (message: unknown) => void;
};

type BuildDetailsIncomingMessage =
  | { type: "appendConsole"; text?: string }
  | { type: "setConsole"; text?: string; truncated?: boolean }
  | { type: "setErrors"; errors?: string[] }
  | { type: "setFollowLog"; value?: unknown }
  | BuildDetailsUpdateMessage;

type BuildDetailsAction =
  | { type: "appendConsole"; text: string }
  | { type: "setConsole"; text: string; truncated: boolean }
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

const FALLBACK_STATE: BuildDetailsViewModel = {
  displayName: "Build Details",
  resultLabel: "Unknown",
  resultClass: "neutral",
  durationLabel: "Unknown",
  timestampLabel: "Unknown",
  culpritsLabel: "Unknown",
  pipelineStages: [],
  insights: DEFAULT_INSIGHTS,
  consoleText: "",
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

function buildDetailsReducer(
  state: BuildDetailsViewModel,
  action: BuildDetailsAction
): BuildDetailsViewModel {
  switch (action.type) {
    case "appendConsole": {
      if (!action.text) {
        return state;
      }
      return {
        ...state,
        consoleText: state.consoleText + action.text,
        consoleError: undefined
      };
    }
    case "setConsole": {
      return {
        ...state,
        consoleText: action.text,
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

function StatusLabel({
  label,
  status,
  className
}: {
  label: string;
  status?: string;
  className?: string;
}) {
  const statusClass = getStatusClass(status);
  const classes = ["font-semibold", statusClass, className].filter(Boolean).join(" ");
  return <span className={classes}>{label}</span>;
}

function StepsList({ steps }: { steps: PipelineStageStepViewModel[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
      {steps.map((step, index) => (
        <li
          className="flex flex-col gap-1 rounded-md border border-panelBorder bg-editorWidget px-2 py-1.5"
          key={`${step.name}-${index}`}
        >
          <div className="text-xs font-semibold text-foreground">{step.name || "Step"}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-description">
            <StatusLabel
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
        <StatusLabel
          label={branch.statusLabel || "Unknown"}
          status={branch.statusClass}
          className="text-[11px]"
        />
        <div className="text-[11px] text-description">{branch.durationLabel || "Unknown"}</div>
      </div>
      {steps.length > 0 ? (
        <StepsList steps={steps} />
      ) : (
        <div className="rounded-lg border border-dashed border-panelBorder px-3 py-2.5 text-description">
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
  onToggleShowAll: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const hasBranches = stage.parallelBranches.length > 0;
  const hasSteps = Boolean(stage.hasSteps);
  const steps = showAll ? stage.stepsAll : stage.stepsFailedOnly;
  const titleLabel = expanded ? "Hide steps" : "Show steps";
  const expandedClass = expanded ? "border-focus ring-1 ring-focus" : "";

  return (
    <div
      className={`rounded-xl border border-panelBorder bg-background p-3.5 flex flex-col gap-2.5 transition-colors ${expandedClass}`}
      data-stage-key={stage.key}
    >
      <button
        type="button"
        className="w-full border-0 bg-transparent p-0 text-left cursor-pointer font-inherit text-inherit flex flex-col gap-1.5"
        onClick={onToggleExpanded}
      >
        <div className="flex items-center justify-between gap-2.5">
          <div className="text-sm font-semibold text-foreground">{stage.name || "Stage"}</div>
          <StatusLabel
            label={stage.statusLabel || "Unknown"}
            status={stage.statusClass}
            className="text-xs"
          />
        </div>
        <div className="flex items-center justify-between gap-2.5 text-xs text-description">
          <div>{stage.durationLabel || "Unknown"}</div>
          <div className="text-[11px] text-link">{titleLabel}</div>
        </div>
      </button>
      {hasBranches ? (
        <div className="flex flex-col gap-1.5">
          {stage.parallelBranches.map((branch, index) => (
            <div
              className="flex items-center justify-between gap-2 rounded-md border border-panelBorder bg-editorWidget px-2 py-1.5"
              key={`${branch.key}-${index}`}
            >
              <div className="text-xs font-semibold text-foreground">
                {branch.name || "Branch"}
              </div>
              <StatusLabel
                label={branch.statusLabel || "Unknown"}
                status={branch.statusClass}
                className="text-[11px]"
              />
              <div className="text-[11px] text-description">
                {branch.durationLabel || "Unknown"}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div
        className="border-t border-dashed border-panelBorder pt-2.5 flex flex-col gap-2.5"
        hidden={!expanded}
      >
        {hasSteps ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-description">
              Steps
            </div>
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-xs text-link cursor-pointer"
              onClick={onToggleShowAll}
            >
              {showAll ? "Show failed steps" : "Show all steps"}
            </button>
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
            <div className="rounded-lg border border-dashed border-panelBorder px-3 py-2.5 text-description">
              {showAll ? "No steps available." : "No failed steps."}
            </div>
          )
        ) : (
          <div className="rounded-lg border border-dashed border-panelBorder px-3 py-2.5 text-description">
            No steps available.
          </div>
        )}
      </div>
    </div>
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
            <div className="text-xs text-description break-words">{metaParts.join(" • ")}</div>
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
            <div className="text-xs text-description break-words">{item.className}</div>
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
            <button
              className="text-xs text-link hover:underline border-0 bg-transparent p-0 cursor-pointer"
              type="button"
              data-artifact-action="preview"
              data-artifact-path={item.relativePath}
              data-artifact-name={item.fileName ?? ""}
            >
              Preview
            </button>
            <button
              className="text-xs text-link hover:underline border-0 bg-transparent p-0 cursor-pointer"
              type="button"
              data-artifact-action="download"
              data-artifact-path={item.relativePath}
              data-artifact-name={item.fileName ?? ""}
            >
              Download
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BuildDetailsApp({ initialState }: { initialState: BuildDetailsViewModel }) {
  const [state, dispatch] = useReducer(buildDetailsReducer, initialState);
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [showAllStages, setShowAllStages] = useState<Record<string, boolean>>({});

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
        case "setConsole":
          dispatch({
            type: "setConsole",
            text: typeof message.text === "string" ? message.text : "",
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
    () => `${state.consoleText.length}-${state.consoleError ?? ""}`,
    [state.consoleText, state.consoleError]
  );

  useEffect(() => {
    if (!state.followLog) {
      return;
    }
    if (consoleScrollKey || consoleScrollKey === "") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    }
  }, [state.followLog, consoleScrollKey]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
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

  const handleFollowLogChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.checked;
    dispatch({ type: "setFollowLog", value: nextValue });
    vscode.postMessage({ type: "toggleFollowLog", value: nextValue });
    if (nextValue) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    }
  };

  return (
    <div className="box-border px-6 pt-5 pb-7 flex flex-col gap-5">
      {state.errors.length > 0 ? (
        <div
          id="errors"
          className="rounded-lg border border-inputErrorBorder bg-inputErrorBg text-inputErrorFg p-3 flex flex-col gap-1.5"
        >
          {state.errors.map((error) => (
            <div className="text-[13px]" key={error}>
              {error}
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <div id="detail-title" className="text-xl font-semibold text-foreground">
          {state.displayName}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-y-3 gap-x-5 rounded-lg border border-panelBorder bg-background p-3.5">
        <div className="flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-[0.08em] text-description">Result</div>
          <div
            id="detail-result"
            className={`text-sm font-semibold ${getStatusClass(state.resultClass)}`}
          >
            {state.resultLabel}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-[0.08em] text-description">Duration</div>
          <div id="detail-duration" className="text-sm">
            {state.durationLabel}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-[0.08em] text-description">
            Timestamp
          </div>
          <div id="detail-timestamp" className="text-sm">
            {state.timestampLabel}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-[0.08em] text-description">
            Culprit(s)
          </div>
          <div id="detail-culprits" className="text-sm">
            {state.culpritsLabel}
          </div>
        </div>
      </div>
      {pipelineStages.length > 0 ? (
        <section id="pipeline-section" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="text-[15px] font-semibold text-foreground">Pipeline Stages</div>
            <div className="text-xs text-description">
              Stage status, duration, and steps from Jenkins Pipeline.
            </div>
          </div>
          <div
            id="pipeline-stages"
            className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3"
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
        </section>
      ) : null}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-[15px] font-semibold text-foreground">Build Failure Insights</div>
          <div className="text-xs text-description">
            Changelog, test summary, and artifacts for this build.
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          <div className="min-h-[120px] rounded-lg border border-panelBorder bg-background p-3.5 flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-description">
              Changelog
            </div>
            {insights.changelogItems.length > 0 ? (
              <ChangelogList items={insights.changelogItems} />
            ) : (
              <div className="rounded-lg border border-dashed border-panelBorder px-3 py-2.5 text-description">
                No changes detected.
              </div>
            )}
            {insights.changelogOverflow > 0 ? (
              <div className="text-xs text-description">
                {formatOverflow(insights.changelogOverflow)}
              </div>
            ) : null}
          </div>
          <div className="min-h-[120px] rounded-lg border border-panelBorder bg-background p-3.5 flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-description">
              Tests
            </div>
            <div id="test-summary" className="text-[13px] font-semibold">
              {insights.testSummaryLabel}
            </div>
            {insights.failedTests.length > 0 ? (
              <FailedTestsList items={insights.failedTests} />
            ) : (
              <div className="rounded-lg border border-dashed border-panelBorder px-3 py-2.5 text-description">
                {insights.failedTestsMessage}
              </div>
            )}
            {insights.failedTestsOverflow > 0 ? (
              <div className="text-xs text-description">
                {formatOverflow(insights.failedTestsOverflow)}
              </div>
            ) : null}
          </div>
          <div className="min-h-[120px] rounded-lg border border-panelBorder bg-background p-3.5 flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-description">
              Artifacts
            </div>
            {insights.artifacts.length > 0 ? (
              <ArtifactsList items={insights.artifacts} />
            ) : (
              <div className="rounded-lg border border-dashed border-panelBorder px-3 py-2.5 text-description">
                No artifacts available.
              </div>
            )}
            {insights.artifactsOverflow > 0 ? (
              <div className="text-xs text-description">
                {formatOverflow(insights.artifactsOverflow)}
              </div>
            ) : null}
          </div>
        </div>
      </section>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-sm font-semibold text-foreground">Console Output</div>
            <label className="inline-flex items-center gap-1.5 text-xs text-description select-none">
              <input
                id="follow-log"
                type="checkbox"
                checked={state.followLog}
                onChange={handleFollowLogChange}
                className="m-0"
              />
              Follow Log
            </label>
          </div>
          {consoleNote ? (
            <div id="console-note" className="text-xs text-description">
              {consoleNote}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          {state.consoleError ? (
            <div
              id="console-error"
              className="rounded-lg border border-inputWarningBorder bg-inputWarningBg text-inputWarningFg px-3 py-2.5 text-[13px]"
            >
              {state.consoleError}
            </div>
          ) : null}
          {!state.consoleError && state.consoleText.length > 0 ? (
            <pre
              id="console-output"
              className="m-0 rounded-lg border border-panelBorder bg-background px-4 py-3.5 font-mono text-[length:var(--vscode-editor-font-size)] leading-6 whitespace-pre overflow-x-auto"
            >
              {state.consoleText}
            </pre>
          ) : null}
          {!state.consoleError && state.consoleText.length === 0 ? (
            <div
              id="console-empty"
              className="rounded-lg border border-dashed border-panelBorder px-3 py-2.5 text-description"
            >
              No console output available.
            </div>
          ) : null}
        </div>
      </div>
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
