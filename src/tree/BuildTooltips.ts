import * as vscode from "vscode";
import { formatLocaleTimestampWithRelative } from "../formatters/DisplayFormatters";
import { resolveLastBuildChangeset } from "../jenkins/changesets/collectBuildChangesets";
import type { JenkinsBuild, JenkinsBuildCause } from "../jenkins/JenkinsClient";
import {
  type BuildParameterFilterOptions,
  visitMatchingBuildParameters
} from "../shared/build/BuildParameterCollection";
import { formatBuildParameterValueForTooltip } from "../shared/build/BuildParameterFormatting";
import { normalizeWhitespace } from "../shared/stringValues";
import { resolveBuildElapsedMs } from "./BuildTiming";
import { formatDurationMs } from "./formatters";

const DEFAULT_MAX_COMMIT_MESSAGE_LENGTH = 120;
const DEFAULT_MAX_PARAMETER_COUNT = 5;
const DEFAULT_MAX_PARAMETER_VALUE_LENGTH = 80;
const DEFAULT_PARAMETER_MASK_VALUE = "[redacted]";
const EMPTY_STRING_LIST: readonly string[] = [];

type BuildAction = NonNullable<NonNullable<JenkinsBuild["actions"]>[number]>;

type BuildParameterSummaryOptions = BuildParameterFilterOptions & {
  maxParameterCount: number;
  maxParameterValueLength: number;
  parameterMaskValue: string;
};

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
  const parameterAllowList = options.parameterAllowList ?? EMPTY_STRING_LIST;
  const parameterDenyList = options.parameterDenyList ?? EMPTY_STRING_LIST;
  const parameterMaskPatterns = options.parameterMaskPatterns ?? EMPTY_STRING_LIST;
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
      allowList: parameterAllowList,
      denyList: parameterDenyList,
      maskPatterns: parameterMaskPatterns,
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
  const actions = build.actions;
  if (!actions) {
    return undefined;
  }

  let summaries: string[] | undefined;
  for (const action of actions) {
    if (!isActionWithCauses(action)) {
      continue;
    }
    for (const cause of action.causes) {
      const summary = formatCauseSummary(cause);
      if (summary) {
        summaries ??= [];
        summaries.push(summary);
      }
    }
  }

  return summaries ? summaries.join(" | ") : undefined;
}

function formatCauseSummary(cause: JenkinsBuildCause): string | undefined {
  const description = normalizeWhitespace(cause.shortDescription ?? "");
  const user = normalizeWhitespace(cause.userName ?? cause.userId ?? "");
  if (description) {
    return user && !includesCaseInsensitive(description, user)
      ? `${description} (${user})`
      : description;
  }
  return user ? `Triggered by ${user}` : undefined;
}

function resolveParameterSummary(
  build: JenkinsBuild,
  options: BuildParameterSummaryOptions
): string | undefined {
  // Configuration validates this as a count, but programmatic callers can bypass it.
  // Floor fractional values and clamp negative or non-finite values to zero.
  const maxParameterCount = Number.isFinite(options.maxParameterCount)
    ? Math.max(0, Math.floor(options.maxParameterCount))
    : 0;

  const visible: string[] = [];
  let total = 0;
  visitMatchingParameters(build, options, (name, value, isMasked) => {
    const formatted = formatParameterSummary(name, value, isMasked, options);
    total += 1;
    if (visible.length < maxParameterCount) {
      visible.push(formatted);
    }
  });

  if (total === 0) {
    return undefined;
  }

  const remaining = total - visible.length;
  const base = visible.join(", ");
  if (remaining === 0) {
    return base;
  }
  return base ? `${base} +${remaining} more` : `+${remaining} more`;
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
  const value = isMasked
    ? options.parameterMaskValue
    : formatBuildParameterValueForTooltip(rawValue);
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
  const timestamp = build.timestamp as number;

  if (build.building) {
    const startLabel = formatLocaleTimestampWithRelative(timestamp, true);
    return { label: "Started", value: startLabel };
  }

  const completedAt = Number.isFinite(build.duration)
    ? timestamp + (build.duration as number)
    : timestamp;
  const completedLabel = formatLocaleTimestampWithRelative(completedAt, true);
  return { label: "Completed", value: completedLabel };
}

function visitMatchingParameters(
  build: JenkinsBuild,
  options: BuildParameterSummaryOptions,
  visitor: (name: string, value: unknown, isMasked: boolean) => void
): void {
  visitMatchingBuildParameters(build.actions, options, (name, parameter, isMasked) => {
    visitor(name, parameter.value, isMasked);
  });
}

function isActionWithCauses(action: BuildAction | null): action is { causes: JenkinsBuildCause[] } {
  if (!action) {
    return false;
  }
  const record = action as { causes?: unknown };
  return Array.isArray(record.causes);
}

function includesCaseInsensitive(source: string, needle: string): boolean {
  return source.includes(needle) || source.toLowerCase().includes(needle.toLowerCase());
}

function truncateText(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return value;
  }
  const clipped = value.slice(0, Math.max(0, maxChars - 3));
  return `${clipped}...`;
}
