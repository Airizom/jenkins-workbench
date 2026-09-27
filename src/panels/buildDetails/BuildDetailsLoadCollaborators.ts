import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { BuildDetailsBackend, BuildDetailsPendingInputProvider } from "./BuildDetailsBackend";
import {
  getBuildDetailsCoverageEnabled,
  getBuildDetailsRefreshIntervalMs,
  getTestReportIncludeCaseLogs,
  MAX_CONSOLE_CHARS
} from "./BuildDetailsConfig";
import type { BuildDetailsDiagnosticConsoleSync } from "./BuildDetailsDiagnosticConsoleSync";
import { formatError } from "./BuildDetailsFormatters";
import type { BuildDetailsPanelRuntime } from "./BuildDetailsPanelRuntime";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import type { BuildDetailsPanelView } from "./BuildDetailsPanelView";
import {
  type BuildDetailsPipelineNodeLogCallbackHooks,
  createBuildDetailsPipelineNodeLogCallbacks
} from "./BuildDetailsPipelineNodeLogCallbacks";
import {
  type BuildDetailsPollingCallbackHooks,
  createBuildDetailsPollingCallbacks
} from "./BuildDetailsPollingCallbacks";
import { BuildDetailsPollingController } from "./BuildDetailsPollingController";
import type { BuildDetailsCanOpenTestSource } from "./BuildDetailsTestSource";
import { PipelineNodeLogManager } from "./PipelineNodeLogManager";

/** The build a Build Details panel load is bound to. */
export interface BuildDetailsLoadTarget {
  backend: BuildDetailsBackend;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
}

export function createBuildDetailsPipelineNodeLogManager(
  target: BuildDetailsLoadTarget,
  state: BuildDetailsPanelState,
  hooks: BuildDetailsPipelineNodeLogCallbackHooks
): PipelineNodeLogManager {
  return new PipelineNodeLogManager({
    backend: target.backend.console,
    environment: target.environment,
    buildUrl: target.buildUrl,
    getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
    formatError,
    callbacks: createBuildDetailsPipelineNodeLogCallbacks(state, hooks)
  });
}

export interface BuildDetailsPanelPollingControllerOptions {
  state: BuildDetailsPanelState;
  token: number;
  view: Pick<BuildDetailsPanelView, "postMessage" | "setTitle">;
  runtime: Pick<
    BuildDetailsPanelRuntime,
    "showCompletionToast" | "handleBuildCompleted" | "handlePipelineLoading"
  >;
  diagnosticConsoleSync: Pick<
    BuildDetailsDiagnosticConsoleSync,
    "appendAndNotify" | "replaceAndNotify" | "sync"
  >;
  pendingInputProvider?: BuildDetailsPendingInputProvider;
  canOpenTestSource?: BuildDetailsCanOpenTestSource;
  isTokenCurrent: (token: number) => boolean;
  publishErrors: () => void;
  onBuildDetailsChanged?: (details: JenkinsBuildDetails) => void;
}

export function createBuildDetailsPanelPollingController(
  target: BuildDetailsLoadTarget,
  options: BuildDetailsPanelPollingControllerOptions
): BuildDetailsPollingController {
  const { backend, environment, buildUrl } = target;
  return new BuildDetailsPollingController({
    statusBackend: backend.status,
    testsBackend: backend.tests,
    consoleBackend: backend.console,
    pendingInputsBackend: backend.pendingInputs,
    pendingInputProvider: options.pendingInputProvider,
    environment,
    buildUrl,
    maxConsoleChars: MAX_CONSOLE_CHARS,
    getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
    testReportOptions: { includeCaseLogs: getTestReportIncludeCaseLogs() },
    formatError,
    callbacks: createBuildDetailsPollingCallbacks(
      options.state,
      options.token,
      createPanelPollingCallbackHooks(options)
    )
  });
}

function createPanelPollingCallbackHooks(
  options: BuildDetailsPanelPollingControllerOptions
): BuildDetailsPollingCallbackHooks {
  const { state, view, runtime, diagnosticConsoleSync, canOpenTestSource } = options;
  return {
    postMessage: (message) => view.postMessage(message),
    setTitle: (title) => view.setTitle(title),
    publishErrors: () => options.publishErrors(),
    isTokenCurrent: (token) => options.isTokenCurrent(token),
    showCompletionToast: (details) => {
      void runtime.showCompletionToast(details);
    },
    handleBuildCompleted: (details, token) => {
      runtime.handleBuildCompleted(details, token);
    },
    getCoverageEnabled: () => getBuildDetailsCoverageEnabled(),
    canOpenSource: (className) =>
      canOpenTestSource?.(state.environment, state.currentBuildUrl, className) ?? false,
    onPipelineLoading: (token) => runtime.handlePipelineLoading(token),
    onBuildDetailsChanged: (details) => options.onBuildDetailsChanged?.(details),
    onConsoleTextAppend: (text) => diagnosticConsoleSync.appendAndNotify(text),
    onConsoleTextSet: (text) => diagnosticConsoleSync.replaceAndNotify(text),
    onConsoleHtmlChanged: (textRange, appendedTextRange) => {
      void diagnosticConsoleSync.sync(textRange, appendedTextRange);
    }
  };
}
