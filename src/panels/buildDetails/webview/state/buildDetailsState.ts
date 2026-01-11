import type {
  BuildDetailsUpdateMessage,
  BuildDetailsViewModel,
  BuildFailureInsightsViewModel
} from "../../shared/BuildDetailsContracts";
import type { ConsoleHtmlModel } from "../lib/consoleHtml";
import { parseConsoleHtml } from "../lib/consoleHtml";

type BuildDetailsIncomingMessage =
  | { type: "appendConsole"; text?: string }
  | { type: "appendConsoleHtml"; html?: string }
  | { type: "setConsole"; text?: string; truncated?: boolean }
  | { type: "setConsoleHtml"; html?: string; truncated?: boolean }
  | { type: "setErrors"; errors?: string[] }
  | { type: "setFollowLog"; value?: unknown }
  | BuildDetailsUpdateMessage;

export type { BuildDetailsIncomingMessage };

export type BuildDetailsState = BuildDetailsViewModel & {
  consoleHtmlModel?: ConsoleHtmlModel;
};

export type BuildDetailsAction =
  | { type: "appendConsole"; text: string }
  | { type: "appendConsoleHtml"; html: string }
  | { type: "setConsole"; text: string; truncated: boolean }
  | { type: "setConsoleHtml"; html: string; truncated: boolean }
  | { type: "setErrors"; errors: string[] }
  | { type: "setFollowLog"; value: boolean }
  | { type: "updateDetails"; payload: BuildDetailsUpdateMessage };

export const DEFAULT_INSIGHTS: BuildFailureInsightsViewModel = {
  changelogItems: [],
  changelogOverflow: 0,
  testSummaryLabel: "No test results.",
  failedTests: [],
  failedTestsOverflow: 0,
  failedTestsMessage: "No failed tests.",
  artifacts: [],
  artifactsOverflow: 0
};

export const FALLBACK_STATE: BuildDetailsState = {
  displayName: "Build Details",
  resultLabel: "Unknown",
  resultClass: "neutral",
  durationLabel: "Unknown",
  timestampLabel: "Unknown",
  culpritsLabel: "Unknown",
  pipelineStagesLoading: false,
  pipelineStages: [],
  insights: DEFAULT_INSIGHTS,
  pendingInputs: [],
  consoleText: "",
  consoleHtml: undefined,
  consoleHtmlModel: undefined,
  consoleTruncated: false,
  consoleMaxChars: 0,
  errors: [],
  followLog: true
};

export function buildInitialState(initialState: BuildDetailsViewModel): BuildDetailsState {
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

export function buildDetailsReducer(
  state: BuildDetailsState,
  action: BuildDetailsAction
): BuildDetailsState {
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
        pipelineStagesLoading: payload.pipelineStagesLoading,
        insights: payload.insights,
        pipelineStages: payload.pipelineStages,
        pendingInputs: payload.pendingInputs ?? []
      };
    }
    default:
      return state;
  }
}

export function getInitialState(): BuildDetailsViewModel {
  const candidate = (window as { __INITIAL_STATE__?: BuildDetailsViewModel }).__INITIAL_STATE__;
  if (!candidate) {
    return FALLBACK_STATE;
  }
  return {
    ...FALLBACK_STATE,
    ...candidate,
    insights: candidate.insights ?? DEFAULT_INSIGHTS,
    pendingInputs: candidate.pendingInputs ?? []
  };
}

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
