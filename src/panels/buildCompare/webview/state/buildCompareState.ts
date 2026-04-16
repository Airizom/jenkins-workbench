import type {
  BuildCompareConsoleSectionViewModel,
  BuildCompareViewModel
} from "../../shared/BuildCompareContracts";

export type BuildCompareState = BuildCompareViewModel;

export type BuildCompareAction = {
  type: "updateConsoleSection";
  console: BuildCompareConsoleSectionViewModel;
};

export function buildCompareReducer(
  state: BuildCompareState,
  action: BuildCompareAction
): BuildCompareState {
  switch (action.type) {
    case "updateConsoleSection":
      return {
        ...state,
        console: action.console
      };
    default:
      return state;
  }
}

export function getInitialState(): BuildCompareViewModel | undefined {
  return (window as { __INITIAL_STATE__?: BuildCompareViewModel }).__INITIAL_STATE__;
}
