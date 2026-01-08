import type { JenkinsBuildDetails } from "../../jenkins/types";
import { toPipelineRun } from "../../jenkins/pipeline/JenkinsPipelineAdapter";
import type { BuildDetailsOutgoingMessage } from "./BuildDetailsMessages";
import type { BuildDetailsPollingCallbacks } from "./BuildDetailsPollingController";
import { buildDetailsUpdateMessage } from "./BuildDetailsUpdateBuilder";
import { formatError } from "./BuildDetailsFormatters";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";

export interface BuildDetailsPollingCallbackHooks {
  postMessage: (message: BuildDetailsOutgoingMessage) => void;
  setTitle: (title: string) => void;
  publishErrors: () => void;
  isTokenCurrent: (token: number) => boolean;
  showCompletionToast: (details: JenkinsBuildDetails) => void;
}

export function createBuildDetailsPollingCallbacks(
  state: BuildDetailsPanelState,
  token: number,
  hooks: BuildDetailsPollingCallbackHooks
): BuildDetailsPollingCallbacks {
  return {
    onDetails: (details) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      state.updateDetails(details);
      hooks.postMessage(
        buildDetailsUpdateMessage(
          details,
          state.currentTestReport,
          state.currentPipelineRun,
          state.currentPendingInputs
        )
      );
    },
    onWorkflowRun: (workflowRun) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      state.setPipelineRun(toPipelineRun(workflowRun));
      hooks.publishErrors();
      if (state.currentDetails) {
        hooks.postMessage(
          buildDetailsUpdateMessage(
            state.currentDetails,
            state.currentTestReport,
            state.currentPipelineRun,
            state.currentPendingInputs
          )
        );
      }
    },
    onWorkflowError: (error) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      state.setPipelineError(`Pipeline stages: ${formatError(error)}`);
      hooks.publishErrors();
    },
    onTitle: (title) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      hooks.setTitle(title);
    },
    onConsoleAppend: (text) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      hooks.postMessage({ type: "appendConsole", text });
    },
    onConsoleHtmlAppend: (html) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      hooks.postMessage({ type: "appendConsoleHtml", html });
    },
    onConsoleSet: (payload) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      hooks.postMessage({
        type: "setConsole",
        text: payload.text,
        truncated: payload.truncated
      });
    },
    onConsoleHtmlSet: (payload) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      hooks.postMessage({
        type: "setConsoleHtml",
        html: payload.html,
        truncated: payload.truncated
      });
    },
    onErrors: (errors) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      state.setBaseErrors(errors);
      hooks.publishErrors();
    },
    onPendingInputs: (pendingInputs) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      state.setPendingInputs(pendingInputs);
      if (state.currentDetails) {
        hooks.postMessage(
          buildDetailsUpdateMessage(
            state.currentDetails,
            state.currentTestReport,
            state.currentPipelineRun,
            state.currentPendingInputs
          )
        );
      }
    },
    onComplete: (details) => {
      if (!hooks.isTokenCurrent(token)) {
        return;
      }
      hooks.showCompletionToast(details);
    }
  };
}
