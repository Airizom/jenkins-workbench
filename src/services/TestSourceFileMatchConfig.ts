import * as vscode from "vscode";
import type {
  TestSourceFileMatchStrategyOptions,
  TestSourcePathPreference
} from "./TestSourceFileMatchStrategy";

const TEST_SOURCE_MATCHING_CONFIG_SECTION = "jenkinsWorkbench.buildDetails.testSourceMatching";

export interface TestSourceFileMatchConfig {
  getOptions(): Required<TestSourceFileMatchStrategyOptions>;
}

export class WorkspaceTestSourceFileMatchConfig implements TestSourceFileMatchConfig {
  getOptions(): Required<TestSourceFileMatchStrategyOptions> {
    const configuration = vscode.workspace.getConfiguration(TEST_SOURCE_MATCHING_CONFIG_SECTION);
    return {
      fileExtensions: readRequiredSetting(
        configuration,
        "fileExtensions",
        readStringArray,
        EMPTY_STRING_ARRAY
      ),
      excludeGlob: readRequiredSetting(configuration, "excludeGlob", readOptionalString, ""),
      maxResultsPerPattern: readRequiredSetting(
        configuration,
        "maxResultsPerPattern",
        readOptionalNumber,
        1
      ),
      preferredPathScores: readRequiredSetting(
        configuration,
        "preferredPathScores",
        readPathPreferences,
        EMPTY_PATH_PREFERENCES
      )
    };
  }
}

const EMPTY_STRING_ARRAY: readonly string[] = [];
const EMPTY_PATH_PREFERENCES: readonly TestSourcePathPreference[] = [];

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRequiredSetting<TValue>(
  configuration: vscode.WorkspaceConfiguration,
  key: string,
  reader: (value: unknown) => TValue | undefined,
  fallback: TValue
): TValue {
  const configuredValue = reader(configuration.get(key));
  if (typeof configuredValue !== "undefined") {
    return configuredValue;
  }
  const defaultValue = reader(configuration.inspect(key)?.defaultValue);
  return typeof defaultValue !== "undefined" ? defaultValue : fallback;
}

function readPathPreferences(value: unknown): TestSourcePathPreference[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const preferences = value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return undefined;
      }
      const fragment = "fragment" in entry ? readOptionalString(entry.fragment) : undefined;
      const score = "score" in entry ? readOptionalNumber(entry.score) : undefined;
      if (!fragment || typeof score === "undefined") {
        return undefined;
      }
      return { fragment, score };
    })
    .filter((entry): entry is TestSourcePathPreference => Boolean(entry));
  return preferences.length > 0 ? preferences : undefined;
}
