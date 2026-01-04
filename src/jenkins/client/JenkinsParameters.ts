import type { JenkinsParameterDefinition } from "../types";

export interface JenkinsJobParametersResponse {
  actions?: Array<{
    parameterDefinitions?: Array<{
      name?: string;
      type?: string;
      defaultParameterValue?: { value?: unknown };
      defaultValue?: unknown;
      choices?: unknown;
      description?: string;
    }>;
  } | null>;
}

export function extractParameterDefinitions(
  response: JenkinsJobParametersResponse
): JenkinsParameterDefinition[] {
  const definitions: JenkinsParameterDefinition[] = [];
  const seen = new Set<string>();
  const formatDefaultValue = (value: unknown): string | number | boolean | undefined => {
    switch (typeof value) {
      case "string":
      case "number":
      case "boolean":
        return value;
      case "undefined":
        return undefined;
      case "bigint":
        return value.toString();
      case "symbol":
        return value.description ?? value.toString();
      case "function":
        return value.name ? `[function ${value.name}]` : "[function]";
      case "object":
        if (value === null) {
          return undefined;
        }
        try {
          return JSON.stringify(value);
        } catch {
          return "[object]";
        }
      default:
        return undefined;
    }
  };

  for (const action of response.actions ?? []) {
    if (!action || !Array.isArray(action.parameterDefinitions)) {
      continue;
    }

    for (const definition of action.parameterDefinitions) {
      if (!definition.name || seen.has(definition.name)) {
        continue;
      }

      const choices = Array.isArray(definition.choices)
        ? definition.choices.map((choice) => String(choice))
        : undefined;
      const rawDefault = definition.defaultParameterValue?.value ?? definition.defaultValue;
      const defaultValue = formatDefaultValue(rawDefault);

      definitions.push({
        name: definition.name,
        type: definition.type,
        defaultValue,
        choices,
        description: definition.description
      });
      seen.add(definition.name);
    }
  }

  return definitions;
}
