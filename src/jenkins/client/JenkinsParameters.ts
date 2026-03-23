import { formatParameterDefaultValue } from "../parameterDefaultValueFormat";
import type { JenkinsParameterDefinition } from "../types";

type JenkinsParameterContainer = {
  parameterDefinitions?: Array<{
    name?: string;
    type?: string;
    defaultParameterValue?: { value?: unknown };
    defaultValue?: unknown;
    choices?: unknown;
    description?: string;
    projectName?: unknown;
    multiSelectDelimiter?: unknown;
  }>;
} | null;

export interface JenkinsJobParametersResponse {
  actions?: JenkinsParameterContainer[];
  property?: JenkinsParameterContainer[];
}

export function extractParameterDefinitions(
  response: JenkinsJobParametersResponse
): JenkinsParameterDefinition[] {
  const definitions: JenkinsParameterDefinition[] = [];
  const seen = new Set<string>();

  const collectDefinitions = (containers?: JenkinsParameterContainer[]): void => {
    for (const container of containers ?? []) {
      if (!container || !Array.isArray(container.parameterDefinitions)) {
        continue;
      }

      for (const definition of container.parameterDefinitions) {
        if (!definition.name || seen.has(definition.name)) {
          continue;
        }

        const choices = Array.isArray(definition.choices)
          ? definition.choices.map((choice) => String(choice))
          : undefined;
        const rawDefault = definition.defaultParameterValue?.value ?? definition.defaultValue;
        const defaultValue = formatParameterDefaultValue(rawDefault);

        definitions.push({
          name: definition.name,
          type: definition.type,
          defaultValue,
          choices,
          description: definition.description,
          projectName:
            typeof definition.projectName === "string" ? definition.projectName : undefined,
          multiSelectDelimiter:
            typeof definition.multiSelectDelimiter === "string"
              ? definition.multiSelectDelimiter
              : undefined
        });
        seen.add(definition.name);
      }
    }
  };

  collectDefinitions(response.actions);
  collectDefinitions(response.property);

  return definitions;
}
