import * as vscode from "vscode";
import type {
  JenkinsBuild,
  JenkinsBuildCause,
  JenkinsBuildParameter,
  JenkinsChangeSetItem
} from "../jenkins/JenkinsClient";
import { formatDurationMs } from "./formatters";

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
  const items = collectChangeItems(build);
  if (items.length === 0) {
    return undefined;
  }

  const deduped = dedupeChangeItems(items);
  if (deduped.length === 0) {
    return undefined;
  }

  const last = deduped[deduped.length - 1];
  const rawMessage = normalizeWhitespace(last.msg ?? "");
  const rawAuthor = normalizeWhitespace(last.author?.fullName ?? "");
  const message = truncateText(rawMessage || "Commit", maxMessageLength).text;
  const author = rawAuthor || "Unknown author";

  return { message, author };
}

function resolveCauseSummary(build: JenkinsBuild): string | undefined {
  const causes = collectCauses(build);
  if (causes.length === 0) {
    return undefined;
  }

  const summaries: string[] = [];
  for (const cause of causes) {
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
  const parameters = collectParameters(build, options);
  if (parameters.length === 0) {
    return undefined;
  }

  const formatted = parameters.map((param) => {
    const value = param.isMasked
      ? options.parameterMaskValue
      : formatParameterValue(param.value);
    const truncated = truncateText(value, options.maxParameterValueLength).text;
    return `${param.name}=${truncated}`;
  });

  const visible = formatted.slice(0, options.maxParameterCount);
  const remaining = formatted.length - visible.length;
  const base = visible.join(", ");
  return remaining > 0 ? `${base} +${remaining} more` : base;
}

function resolveEstimatedDurationLabel(build: JenkinsBuild): string | undefined {
  if (!build.building || !Number.isFinite(build.estimatedDuration)) {
    return undefined;
  }

  const estimatedLabel = formatDurationMs(build.estimatedDuration as number);
  const elapsed = resolveBuildElapsedMs(build);
  if (!Number.isFinite(elapsed)) {
    return estimatedLabel;
  }

  const elapsedLabel = formatDurationMs(Math.max(0, elapsed as number));
  return `Elapsed ${elapsedLabel} | Estimated ${estimatedLabel}`;
}

function collectChangeItems(build: JenkinsBuild): JenkinsChangeSetItem[] {
  const items: JenkinsChangeSetItem[] = [];
  if (build.changeSet?.items) {
    items.push(...build.changeSet.items);
  }
  for (const changeSet of build.changeSets ?? []) {
    if (changeSet?.items) {
      items.push(...changeSet.items);
    }
  }
  return items;
}

function dedupeChangeItems(items: JenkinsChangeSetItem[]): JenkinsChangeSetItem[] {
  const results: JenkinsChangeSetItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const message = normalizeWhitespace(item.msg ?? "");
    const author = normalizeWhitespace(item.author?.fullName ?? "");
    const commitId = item.commitId?.trim();
    const key = commitId ? `id:${commitId}` : `${message}|${author}`;
    if (key && seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(item);
  }

  return results;
}

function collectCauses(build: JenkinsBuild): JenkinsBuildCause[] {
  const actions = build.actions ?? [];
  const results: JenkinsBuildCause[] = [];

  for (const action of actions) {
    if (!isActionWithCauses(action)) {
      continue;
    }
    for (const cause of action.causes) {
      results.push(cause);
    }
  }

  return results;
}

function collectParameters(
  build: JenkinsBuild,
  options: {
    parameterAllowList: string[];
    parameterDenyList: string[];
    parameterMaskPatterns: string[];
  }
): Array<JenkinsBuildParameter & { isMasked: boolean }> {
  const actions = build.actions ?? [];
  const results: Array<JenkinsBuildParameter & { isMasked: boolean }> = [];
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
      if (options.parameterAllowList.length > 0) {
        if (!matchesAnyPattern(name, options.parameterAllowList)) {
          continue;
        }
      }
      if (options.parameterDenyList.length > 0) {
        if (matchesAnyPattern(name, options.parameterDenyList)) {
          continue;
        }
      }
      seen.add(name);
      const isMasked = matchesAnyPattern(name, options.parameterMaskPatterns);
      results.push({ name, value: parameter.value, isMasked });
    }
  }

  return results;
}

function isActionWithCauses(
  action: BuildAction | null
): action is { causes: JenkinsBuildCause[] } {
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

function resolveBuildElapsedMs(build: JenkinsBuild): number | undefined {
  if (Number.isFinite(build.timestamp)) {
    return Math.max(0, Date.now() - (build.timestamp as number));
  }
  if (Number.isFinite(build.duration)) {
    return Math.max(0, build.duration as number);
  }
  return undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function includesCaseInsensitive(source: string, needle: string): boolean {
  return source.toLowerCase().includes(needle.toLowerCase());
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const normalized = value.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (maxChars <= 0 || value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  const clipped = value.slice(0, Math.max(0, maxChars - 3));
  return { text: `${clipped}...`, truncated: true };
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
