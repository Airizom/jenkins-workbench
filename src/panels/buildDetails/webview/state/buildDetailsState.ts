import { EMPTY_TEST_RESULTS_LABEL } from "../../../shared/TestReportConstants";
import { readInitialPanelState } from "../../../shared/webview/state/createPanelStateHelpers";
import type {
  BuildDetailsCoverageStateViewModel,
  BuildDetailsTestStateViewModel,
  BuildDetailsUpdateMessage,
  BuildDetailsViewModel,
  BuildFailureInsightsViewModel,
  BuildTestsSummaryViewModel
} from "../../shared/BuildDetailsContracts";
import { splitBuildDetailsErrors } from "../../shared/BuildDetailsErrorHelpers";
import type { ConsoleHtmlModel } from "../lib/consoleHtml";
import { parseConsoleHtml } from "../lib/consoleHtml";

export type BuildDetailsState = BuildDetailsViewModel & {
  consoleHtmlModel?: ConsoleHtmlModel;
  pipelineNodeLogHtmlModel?: ConsoleHtmlModel;
  hasLoaded: boolean;
};

export type BuildDetailsAction =
  | { type: "appendConsole"; text: string }
  | { type: "appendConsoleHtml"; html: string }
  | { type: "setConsole"; text: string; truncated: boolean }
  | { type: "setConsoleHtml"; html: string; truncated: boolean }
  | { type: "setPipelineNodeLog"; log: BuildDetailsViewModel["pipelineNodeLog"] }
  | { type: "appendPipelineNodeLogHtml"; targetKey: string; html: string }
  | { type: "setPipelineNodeLogLoading"; targetKey?: string; loading: boolean }
  | { type: "setPipelineNodeLogError"; targetKey?: string; error: string }
  | { type: "setErrors"; errors: string[] }
  | { type: "setFollowLog"; value: boolean }
  | { type: "setLoading"; value: boolean }
  | { type: "updateDetails"; payload: BuildDetailsUpdateMessage };

export const DEFAULT_INSIGHTS: BuildFailureInsightsViewModel = {
  changelogItems: [],
  changelogOverflow: 0,
  testSummaryLabel: EMPTY_TEST_RESULTS_LABEL,
  hasFailedTests: false,
  testResultsHint: undefined,
  artifacts: [],
  artifactsOverflow: 0
};

export const DEFAULT_TESTS_SUMMARY: BuildTestsSummaryViewModel = {
  totalCount: 0,
  failedCount: 0,
  skippedCount: 0,
  passedCount: 0,
  summaryLabel: EMPTY_TEST_RESULTS_LABEL,
  hasAnyResults: false,
  hasDetailedResults: false,
  detailsUnavailable: false,
  logsIncluded: false,
  canLoadLogs: false
};

export const DEFAULT_TEST_STATE: BuildDetailsTestStateViewModel = {
  summary: DEFAULT_TESTS_SUMMARY,
  results: {
    items: [],
    loading: false
  }
};

export const DEFAULT_COVERAGE_STATE: BuildDetailsCoverageStateViewModel = {
  status: "disabled",
  showTab: false,
  qualityGates: [],
  modifiedFiles: [],
  summaryOnly: false
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
  pipelineNodeLog: {
    text: "",
    truncated: false,
    loading: false
  },
  testState: DEFAULT_TEST_STATE,
  coverageState: DEFAULT_COVERAGE_STATE,
  insights: DEFAULT_INSIGHTS,
  pendingInputs: [],
  consoleText: "",
  consoleHtml: undefined,
  consoleHtmlModel: undefined,
  pipelineNodeLogHtmlModel: undefined,
  consoleTruncated: false,
  consoleMaxChars: 0,
  errors: [],
  followLog: true,
  loading: true,
  hasLoaded: false
};

export function buildInitialState(initialState: BuildDetailsViewModel): BuildDetailsState {
  const mergedDefaults = mergeBuildDetailsDefaults(initialState);
  const merged: BuildDetailsState = {
    ...mergedDefaults,
    pipelineNodeLog: initialState.pipelineNodeLog ?? FALLBACK_STATE.pipelineNodeLog,
    pipelineNodeLogHtmlModel: initialState.pipelineNodeLog.html
      ? parseConsoleHtml(initialState.pipelineNodeLog.html)
      : undefined,
    consoleHtmlModel: undefined,
    hasLoaded: !(initialState.loading ?? false)
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
    case "setPipelineNodeLog": {
      return {
        ...state,
        pipelineNodeLog: action.log,
        pipelineNodeLogHtmlModel: action.log.html ? parseConsoleHtml(action.log.html) : undefined
      };
    }
    case "appendPipelineNodeLogHtml": {
      if (state.pipelineNodeLog.target?.key !== action.targetKey || !action.html) {
        return state;
      }
      const nextModel = appendConsoleHtmlModel(state.pipelineNodeLogHtmlModel, action.html);
      return {
        ...state,
        pipelineNodeLog: {
          ...state.pipelineNodeLog,
          text: nextModel.text,
          html: undefined,
          loading: false,
          error: undefined
        },
        pipelineNodeLogHtmlModel: nextModel
      };
    }
    case "setPipelineNodeLogLoading": {
      if (!matchesPipelineLogTarget(state, action.targetKey)) {
        return state;
      }
      return {
        ...state,
        pipelineNodeLog: {
          ...state.pipelineNodeLog,
          loading: action.loading
        }
      };
    }
    case "setPipelineNodeLogError": {
      if (!matchesPipelineLogTarget(state, action.targetKey)) {
        return state;
      }
      return {
        ...state,
        pipelineNodeLog: {
          ...state.pipelineNodeLog,
          loading: false,
          error: action.error
        }
      };
    }
    case "setErrors": {
      const { consoleError, displayErrors } = splitBuildDetailsErrors(action.errors);
      return {
        ...state,
        errors: displayErrors,
        consoleError
      };
    }
    case "setFollowLog": {
      return { ...state, followLog: action.value };
    }
    case "setLoading": {
      return { ...state, loading: action.value };
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
        testState: payload.testState,
        coverageState: payload.coverageState,
        insights: payload.insights,
        pipelineStages: payload.pipelineStages,
        pipelineNodeLog: payload.pipelineNodeLog,
        pipelineNodeLogHtmlModel: payload.pipelineNodeLog.html
          ? parseConsoleHtml(payload.pipelineNodeLog.html)
          : state.pipelineNodeLog.target?.key === payload.pipelineNodeLog.target?.key
            ? state.pipelineNodeLogHtmlModel
            : undefined,
        pendingInputs: payload.pendingInputs ?? [],
        hasLoaded: true
      };
    }
    default:
      return state;
  }
}

export function getInitialState(): BuildDetailsViewModel {
  return readInitialPanelState(FALLBACK_STATE, mergeInitialViewModel);
}

function mergeInitialViewModel(candidate: BuildDetailsViewModel): BuildDetailsViewModel {
  return mergeBuildDetailsDefaults(candidate);
}

function mergeBuildDetailsDefaults<T extends BuildDetailsViewModel>(candidate: T): T {
  return {
    ...FALLBACK_STATE,
    ...candidate,
    testState: candidate.testState ?? DEFAULT_TEST_STATE,
    coverageState: candidate.coverageState ?? DEFAULT_COVERAGE_STATE,
    insights: candidate.insights ?? DEFAULT_INSIGHTS,
    pendingInputs: candidate.pendingInputs ?? [],
    loading: candidate.loading ?? false
  };
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

function matchesPipelineLogTarget(state: BuildDetailsState, targetKey?: string): boolean {
  return !targetKey || state.pipelineNodeLog.target?.key === targetKey;
}
