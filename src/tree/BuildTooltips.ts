import * as vscode from "vscode";
import type {
  JenkinsBuild,
  JenkinsBuildCause,
  JenkinsBuildParameter
} from "../jenkins/JenkinsClient";
import { resolveLastBuildChangeset } from "../jenkins/changesets/collectBuildChangesets";
import {
  shouldIncludeBuildParameter,
  shouldMaskBuildParameter
} from "../shared/build/BuildParameterFilters";
import { resolveBuildElapsedMs } from "./BuildTiming";
import { formatDurationMs, formatRelativeTime } from "./formatters";

const DEFAULT_MAX_COMMIT_MESSAGE_LENGTH = 120;
const DEFAULT_MAX_PARAMETER_COUNT = 5;
const DEFAULT_MAX_PARAMETER_VALUE_LENGTH = 80;
const DEFAULT_PARAMETER_MASK_VALUE = "[redacted]";

type BuildAction = NonNullable<NonNullable<JenkinsBuild["actions"]>[number]>;

export interface BuildTooltipOptions {
  includeParameters?: boolean;
  maxCommitMessageLength?: number;
  maxParameterCount?: number;
  maxParameterValueLength?: number;
  parameterAllowList?: string[];
  parameterDenyList?: string[];
  parameterMaskPatterns?: string[];
  parameterMaskValue?: string;
}

export function buildBuildTooltip(
  build: JenkinsBuild,
  options: BuildTooltipOptions = {}
): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  const maxCommitMessageLength =
    options.maxCommitMessageLength ?? DEFAULT_MAX_COMMIT_MESSAGE_LENGTH;
  const maxParameterCount = options.maxParameterCount ?? DEFAULT_MAX_PARAMETER_COUNT;
  const maxParameterValueLength =
    options.maxParameterValueLength ?? DEFAULT_MAX_PARAMETER_VALUE_LENGTH;
  const includeParameters = options.includeParameters ?? false;
  const parameterAllowList = options.parameterAllowList ?? [];
  const parameterDenyList = options.parameterDenyList ?? [];
  const parameterMaskPatterns = options.parameterMaskPatterns ?? [];
  const parameterMaskValue = options.parameterMaskValue ?? DEFAULT_PARAMETER_MASK_VALUE;

  let hasSection = false;
  const appendHeader = (label: string): void => {
    if (hasSection) {
      tooltip.appendMarkdown("\n\n");
    }
    tooltip.appendMarkdown(`**${label}:** `);
    hasSection = true;
  };

  const commit = resolveLastCommit(build, maxCommitMessageLength);
  if (commit) {
    appendHeader("Last commit");
    tooltip.appendText(commit.message);
    if (commit.author) {
      tooltip.appendText(" (");
      tooltip.appendText(commit.author);
      tooltip.appendText(")");
    }
  }

  const cause = resolveCauseSummary(build);
  if (cause) {
    appendHeader("Cause");
    tooltip.appendText(cause);
  }

  if (includeParameters) {
    const parameters = resolveParameterSummary(build, {
      maxParameterCount,
      maxParameterValueLength,
      parameterAllowList,
      parameterDenyList,
      parameterMaskPatterns,
      parameterMaskValue
    });
    if (parameters) {
      appendHeader("Parameters");
      tooltip.appendText(parameters);
    }
  }

  const timing = resolveTimingSummary(build);
  if (timing) {
    appendHeader(timing.label);
    tooltip.appendText(timing.value);
  }

  const estimatedDuration = resolveEstimatedDurationLabel(build);
  if (estimatedDuration) {
    appendHeader("Estimated duration");
    tooltip.appendText(estimatedDuration);
  }

  if (!hasSection) {
    tooltip.appendText(build.url);
  }

  return tooltip;
}

function resolveLastCommit(
  build: JenkinsBuild,
  maxMessageLength: number
): { message: string; author?: string } | undefined {
  const last = resolveLastBuildChangeset(build);
  if (!last) {
    return undefined;
  }

  const message = truncateText(last.message, maxMessageLength);
  return { message, author: last.author };
}

function resolveCauseSummary(build: JenkinsBuild): string | undefined {
  const summaries: string[] = [];
  for (const action of build.actions ?? []) {
    if (!isActionWithCauses(action)) {
      continue;
    }
    for (const cause of action.causes) {
      const description = normalizeWhitespace(cause.shortDescription ?? "");
      const user = normalizeWhitespace(cause.userName ?? cause.userId ?? "");
      if (description) {
        if (user && !includesCaseInsensitive(description, user)) {
          summaries.push(`${description} (${user})`);
        } else {
          summaries.push(description);
        }
        continue;
      }
      if (user) {
        summaries.push(`Triggered by ${user}`);
      }
    }
  }

  return summaries.length > 0 ? summaries.join(" | ") : undefined;
}

function resolveParameterSummary(
  build: JenkinsBuild,
  options: {
    maxParameterCount: number;
    maxParameterValueLength: number;
    parameterAllowList: string[];
    parameterDenyList: string[];
    parameterMaskPatterns: string[];
    parameterMaskValue: string;
  }
): string | undefined {
  if (options.maxParameterCount < 0 || !Number.isInteger(options.maxParameterCount)) {
    return resolveParameterSummaryWithSliceSemantics(build, options);
  }

  const visible: string[] = [];
  let total = 0;
  visitMatchingParameters(build, options, (name, value, isMasked) => {
    const formatted = formatParameterSummary(name, value, isMasked, options);
    total += 1;
    if (visible.length < options.maxParameterCount) {
      visible.push(formatted);
    }
  });

  if (total === 0) {
    return undefined;
  }

  const remaining = total - visible.length;
  const base = visible.join(", ");
  return remaining > 0 ? `${base} +${remaining} more` : base;
}

function resolveParameterSummaryWithSliceSemantics(
  build: JenkinsBuild,
  options: {
    maxParameterCount: number;
    maxParameterValueLength: number;
    parameterAllowList: string[];
    parameterDenyList: string[];
    parameterMaskPatterns: string[];
    parameterMaskValue: string;
  }
): string | undefined {
  const formatted: string[] = [];
  visitMatchingParameters(build, options, (name, value, isMasked) => {
    formatted.push(formatParameterSummary(name, value, isMasked, options));
  });

  if (formatted.length === 0) {
    return undefined;
  }

  const visible = formatted.slice(0, options.maxParameterCount);
  const remaining = formatted.length - visible.length;
  const base = visible.join(", ");
  return remaining > 0 ? `${base} +${remaining} more` : base;
}

function formatParameterSummary(
  name: string,
  rawValue: unknown,
  isMasked: boolean,
  options: {
    maxParameterValueLength: number;
    parameterMaskValue: string;
  }
): string {
  const value = isMasked ? options.parameterMaskValue : formatParameterValue(rawValue);
  const truncated = truncateText(value, options.maxParameterValueLength);
  return `${name}=${truncated}`;
}

function resolveEstimatedDurationLabel(build: JenkinsBuild): string | undefined {
  if (!Number.isFinite(build.estimatedDuration)) {
    return undefined;
  }

  const estimatedLabel = formatDurationMs(build.estimatedDuration as number);
  if (!build.building) {
    return estimatedLabel;
  }
  const elapsed = resolveBuildElapsedMs(build);
  if (!Number.isFinite(elapsed)) {
    return estimatedLabel;
  }

  const elapsedLabel = formatDurationMs(Math.max(0, elapsed as number));
  return `Elapsed ${elapsedLabel} | Estimated ${estimatedLabel}`;
}

function resolveTimingSummary(build: JenkinsBuild): { label: string; value: string } | undefined {
  if (!Number.isFinite(build.timestamp)) {
    return undefined;
  }

  if (build.building) {
    const startLabel = formatTimestamp(build.timestamp as number, true);
    return { label: "Started", value: startLabel };
  }

  const completionTimestamp = resolveBuildCompletionTimestamp(build);
  const completedAt = completionTimestamp ?? (build.timestamp as number);
  const completedLabel = formatTimestamp(completedAt, true);
  return { label: "Completed", value: completedLabel };
}

function formatTimestamp(timestampMs: number, includeRelative: boolean): string {
  const absolute = new Date(timestampMs).toLocaleString();
  if (!includeRelative) {
    return absolute;
  }
  const relative = formatRelativeTime(timestampMs);
  return relative ? `${absolute} (${relative})` : absolute;
}

function resolveBuildCompletionTimestamp(build: JenkinsBuild): number | undefined {
  if (!Number.isFinite(build.timestamp)) {
    return undefined;
  }
  const timestamp = build.timestamp as number;
  if (Number.isFinite(build.duration)) {
    return timestamp + (build.duration as number);
  }
  return timestamp;
}

function visitMatchingParameters(
  build: JenkinsBuild,
  options: {
    parameterAllowList: string[];
    parameterDenyList: string[];
    parameterMaskPatterns: string[];
  },
  visitor: (name: string, value: unknown, isMasked: boolean) => void
): void {
  const actions = build.actions ?? [];
  const seen = new Set<string>();

  for (const action of actions) {
    if (!isActionWithParameters(action)) {
      continue;
    }

    for (const parameter of action.parameters) {
      const name = normalizeWhitespace(parameter.name ?? "");
      if (!name || seen.has(name)) {
        continue;
      }
      if (
        !shouldIncludeBuildParameter(name, options.parameterAllowList, options.parameterDenyList)
      ) {
        continue;
      }
      seen.add(name);
      const isMasked = shouldMaskBuildParameter(name, options.parameterMaskPatterns);
      visitor(name, parameter.value, isMasked);
    }
  }
}

function isActionWithCauses(action: BuildAction | null): action is { causes: JenkinsBuildCause[] } {
  if (!action) {
    return false;
  }
  const record = action as { causes?: unknown };
  return Array.isArray(record.causes);
}

function isActionWithParameters(
  action: BuildAction | null
): action is { parameters: JenkinsBuildParameter[] } {
  if (!action) {
    return false;
  }
  const record = action as { parameters?: unknown };
  return Array.isArray(record.parameters);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function includesCaseInsensitive(source: string, needle: string): boolean {
  return source.toLowerCase().includes(needle.toLowerCase());
}

function truncateText(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return value;
  }
  const clipped = value.slice(0, Math.max(0, maxChars - 3));
  return `${clipped}...`;
}

function formatParameterValue(value: unknown): string {
  switch (typeof value) {
    case "string":
      return normalizeWhitespace(value);
    case "number":
    case "boolean":
      return value.toString();
    case "bigint":
      return value.toString();
    case "symbol":
      return value.description ?? value.toString();
    case "function":
      return value.name ? `[function ${value.name}]` : "[function]";
    case "undefined":
      return "Unknown";
    case "object":
      if (value === null) {
        return "null";
      }
      try {
        return normalizeWhitespace(JSON.stringify(value));
      } catch {
        return "[object]";
      }
    default:
      return "Unknown";
  }
}
