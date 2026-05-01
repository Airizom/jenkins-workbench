import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import type {
  PendingInputParameterViewModel,
  PendingInputViewModel
} from "./shared/BuildDetailsContracts";

const PARAMETER_KIND_LABELS: Record<string, string> = {
  boolean: "Boolean",
  choice: "Choice",
  credentials: "Credentials",
  file: "File",
  multiChoice: "Multi Choice",
  password: "Password",
  run: "Run",
  string: "String",
  text: "Text"
};

export function buildPendingInputsViewModel(
  pendingInputs?: PendingInputAction[]
): PendingInputViewModel[] {
  if (!pendingInputs || pendingInputs.length === 0) {
    return [];
  }

  return pendingInputs.map((action) => {
    const parameters: PendingInputParameterViewModel[] = action.parameters.map((param) => ({
      name: param.name,
      kind: PARAMETER_KIND_LABELS[param.kind] ?? "String",
      description: param.description,
      choices: param.choices,
      defaultValue: param.defaultValue
    }));
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
      parameters
    };
  });
}
