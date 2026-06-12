import { trimToUndefined } from "../../shared/stringValues";
import type { JenkinsChangeSetItem } from "../types";
import type { JenkinsChangesetViewModel } from "./JenkinsChangesetViewModel";

export interface BuildChangesetSource {
  changeSet?: { items?: JenkinsChangeSetItem[] };
  changeSets?: Array<{ items?: JenkinsChangeSetItem[] }>;
}

function changesetDedupeKey(message: string, author: string, commitId?: string): string {
  return commitId ? `id:${commitId}|${message}|${author}` : `${message}|${author}`;
}

function toViewModel(item: JenkinsChangeSetItem): JenkinsChangesetViewModel {
  const message = trimToUndefined(item.msg);
  const author = trimToUndefined(item.author?.fullName);
  const commitId = trimToUndefined(item.commitId);
  return {
    message: message || "Commit",
    author: author || "Unknown author",
    commitId
  };
}

export function collectBuildChangesets(
  source?: BuildChangesetSource | null
): JenkinsChangesetViewModel[] {
  if (!source) {
    return [];
  }

  const items: JenkinsChangeSetItem[] = [];
  if (source.changeSet?.items) {
    items.push(...source.changeSet.items);
  }
  for (const changeSet of source.changeSets ?? []) {
    if (changeSet.items) {
      items.push(...changeSet.items);
    }
  }

  const seen = new Set<string>();
  const results: JenkinsChangesetViewModel[] = [];

  for (const item of items) {
    const viewModel = toViewModel(item);
    const key = changesetDedupeKey(viewModel.message, viewModel.author, viewModel.commitId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(viewModel);
  }

  return results;
}

export function resolveLastBuildChangeset(
  source?: BuildChangesetSource | null
): JenkinsChangesetViewModel | undefined {
  const items = collectBuildChangesets(source);
  return items.length > 0 ? items[items.length - 1] : undefined;
}
