import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import {
  formatPendingInputParameterKind,
  requiresBrowserForPendingInput
} from "../../ui/buildParameterPrompts/PendingInputParameterSupport";
import type {
  PendingInputParameterViewModel,
  PendingInputViewModel
} from "./shared/BuildDetailsContracts";

export function buildPendingInputsViewModel(
  pendingInputs?: PendingInputAction[]
): PendingInputViewModel[] {
  if (!pendingInputs || pendingInputs.length === 0) {
    return [];
  }

  return pendingInputs.map((action) => {
    const parameters: PendingInputParameterViewModel[] = action.parameters.map((param) => {
      const parameter: PendingInputParameterViewModel = {
        name: param.name,
        kind: formatPendingInputParameterKind(param),
        description: param.description,
        choices: param.choices,
        defaultValue: param.defaultValue
      };
      if (requiresBrowserForPendingInput(param)) {
        parameter.requiresBrowser = true;
      }
      return parameter;
    });
    const parametersLabel =
      parameters.length > 0
        ? `Parameters: ${parameters.map((param) => `${param.name} (${param.kind})`).join(", ")}`
        : "No parameters";
    const submitterLabel = action.submitter ? `Submitter: ${action.submitter}` : "Submitter: Any";

    return {
      id: action.id,
      message: action.message,
      submitterLabel,
      parametersLabel,
      parameters,
      requiresBrowser: parameters.some((param) => param.requiresBrowser === true)
    };
  });
}
