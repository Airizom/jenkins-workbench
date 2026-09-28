import { readInjectedPanelState } from "../../../shared/webview/state/createPanelStateHelpers";
import type {
  BuildCompareConsoleSectionViewModel,
  BuildCompareViewModel
} from "../../shared/BuildCompareContracts";

/** Host round trips the webview starts; the header disables both while one runs. */
export type BuildCompareBusyAction = "refresh" | "swap";

export interface BuildCompareActionError {
  action: BuildCompareBusyAction;
  message: string;
}

export interface BuildCompareState {
  model: BuildCompareViewModel;
  busyAction?: BuildCompareBusyAction;
  /** Last refresh/swap failure; the previous comparison stays on screen. */
  actionError?: BuildCompareActionError;
  /** Increments each time a refresh/swap lands, so the app can confirm it once. */
  completedAction?: { action: BuildCompareBusyAction; sequence: number };
}

export type BuildCompareAction =
  | { type: "updateConsoleSection"; console: BuildCompareConsoleSectionViewModel }
  | { type: "replaceComparison"; model: BuildCompareViewModel }
  | { type: "startAction"; action: BuildCompareBusyAction }
  | { type: "actionFailed"; message: string };

export function createBuildCompareState(model: BuildCompareViewModel): BuildCompareState {
  return { model };
}

export function buildCompareReducer(
  state: BuildCompareState,
  action: BuildCompareAction
): BuildCompareState {
  switch (action.type) {
    case "updateConsoleSection":
      return { ...state, model: { ...state.model, console: action.console } };
    case "replaceComparison":
      return {
        model: action.model,
        completedAction: state.busyAction
          ? {
              action: state.busyAction,
              sequence: (state.completedAction?.sequence ?? 0) + 1
            }
          : state.completedAction
      };
    case "startAction":
      return { ...state, busyAction: action.action, actionError: undefined };
    case "actionFailed":
      return {
        ...state,
        busyAction: undefined,
        actionError: { action: state.busyAction ?? "refresh", message: action.message }
      };
    default:
      return state;
  }
}

export function getInitialState(): BuildCompareViewModel | undefined {
  return readInjectedPanelState<BuildCompareViewModel>();
}
