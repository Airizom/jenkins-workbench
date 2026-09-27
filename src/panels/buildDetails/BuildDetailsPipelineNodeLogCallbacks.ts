import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import type { PipelineNodeLogManagerCallbacks } from "./PipelineNodeLogManager";
import type { PipelineNodeLogViewModel } from "./shared/BuildDetailsContracts";
import type { BuildDetailsOutgoingMessage } from "./shared/BuildDetailsPanelMessages";

export interface BuildDetailsPipelineNodeLogCallbackHooks {
  postMessage: (message: BuildDetailsOutgoingMessage) => void;
  getActiveLog: () => PipelineNodeLogViewModel | undefined;
}

export function createBuildDetailsPipelineNodeLogCallbacks(
  state: BuildDetailsPanelState,
  hooks: BuildDetailsPipelineNodeLogCallbackHooks
): PipelineNodeLogManagerCallbacks {
  return {
    onSetLog: (log) => {
      state.setPipelineNodeLog(log);
      hooks.postMessage({ type: "setPipelineNodeLog", log });
    },
    onAppendHtml: (targetKey, html) => {
      const activeLog = hooks.getActiveLog();
      if (activeLog) {
        state.setPipelineNodeLog(activeLog);
      }
      hooks.postMessage({ type: "appendPipelineNodeLogHtml", targetKey, html });
    },
    onLoading: (targetKey, loading) => {
      hooks.postMessage({ type: "setPipelineNodeLogLoading", targetKey, loading });
    },
    onError: (targetKey, error) => {
      const nextLog = { ...state.pipelineNodeLog, loading: false, error };
      state.setPipelineNodeLog(nextLog);
      hooks.postMessage({ type: "setPipelineNodeLogError", targetKey, error });
    }
  };
}
