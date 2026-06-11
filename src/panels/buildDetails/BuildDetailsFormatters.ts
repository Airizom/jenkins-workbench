import type { JenkinsBuildDetails } from "../../jenkins/types";
import { formatBuildHeaderLabels } from "../../shared/build/BuildHeaderLabels";

export function formatBuildDetailsHeaderLabels(details?: JenkinsBuildDetails): {
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
} {
  return {
    ...formatBuildHeaderLabels(details),
    culpritsLabel: details ? formatCulprits(details.culprits) : "Unknown"
  };
}

function formatCulprits(culprits: JenkinsBuildDetails["culprits"] | undefined): string {
  if (!culprits || culprits.length === 0) {
    return "None";
  }
  return culprits.map((culprit) => culprit.fullName).join(", ");
}

export function truncateConsoleText(
  text: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(text.length - maxChars),
    truncated: true
  };
}

export { formatError } from "../../formatters/ErrorFormatters";
