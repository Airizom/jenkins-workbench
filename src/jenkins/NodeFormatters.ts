import { firstNonEmpty } from "../shared/stringValues";

export interface JenkinsNodeOfflineCauseFields {
  offlineCauseReason?: string;
  offlineCause?: {
    description?: string;
    shortDescription?: string;
  };
}

export function formatNodeOfflineReason(node?: JenkinsNodeOfflineCauseFields): string | undefined {
  return firstNonEmpty(
    node?.offlineCauseReason,
    node?.offlineCause?.description,
    node?.offlineCause?.shortDescription
  );
}
