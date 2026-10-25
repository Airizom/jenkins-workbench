import {
  canonicalizeBuildUrlForEnvironment,
  canonicalizeJobUrlForEnvironment
} from "../../jenkins/urls";
import {
  BuildTreeItem,
  JobTreeItem,
  QueueItemTreeItem,
  StalePinnedJobTreeItem,
  type WorkbenchTreeElement
} from "../../tree/TreeItems";

export type BulkAction = "stop" | "cancel" | "watch" | "unwatch" | "pin" | "unpin";

export type BulkActionTarget =
  | { kind: "build"; item: BuildTreeItem; url: string }
  | { kind: "queue"; item: QueueItemTreeItem }
  | { kind: "job"; item: JobTreeItem | StalePinnedJobTreeItem; url: string; aliases: string[] };

export function isBulkActionEligible(action: BulkAction, item: WorkbenchTreeElement): boolean {
  switch (action) {
    case "stop":
      return item instanceof BuildTreeItem && item.isBuilding;
    case "cancel":
      return item instanceof QueueItemTreeItem;
    case "unpin":
      return item instanceof JobTreeItem || item instanceof StalePinnedJobTreeItem;
    default:
      return item instanceof JobTreeItem;
  }
}

export function resolveBulkActionTargets(
  action: BulkAction,
  items: readonly WorkbenchTreeElement[]
) {
  const targets: BulkActionTarget[] = [];
  const incompatible: WorkbenchTreeElement[] = [];
  const duplicates: WorkbenchTreeElement[] = [];
  const seen = new Map<string, BulkActionTarget>();
  for (const item of items) {
    if (!isBulkActionEligible(action, item)) {
      incompatible.push(item);
      continue;
    }
    const resolved = resolveTarget(item);
    if (!resolved) {
      continue;
    }
    const { target, identity } = resolved;
    const key = JSON.stringify([
      target.item.environment.scope,
      target.item.environment.environmentId,
      target.kind,
      identity
    ]);
    const existing = seen.get(key);
    if (existing) {
      duplicates.push(item);
      if (existing.kind === "job" && target.kind === "job") {
        existing.aliases = [...new Set([...existing.aliases, ...target.aliases])];
      }
      continue;
    }
    seen.set(key, target);
    targets.push(target);
  }
  return { targets, incompatible, duplicates };
}

function resolveTarget(
  item: WorkbenchTreeElement
): { target: BulkActionTarget; identity: string } | undefined {
  let target: BulkActionTarget;
  let identity: string;
  if (item instanceof BuildTreeItem) {
    const url =
      canonicalizeBuildUrlForEnvironment(item.environment.url, item.buildUrl) ?? item.buildUrl;
    target = { kind: "build", item, url };
    identity = url;
  } else if (item instanceof QueueItemTreeItem) {
    target = { kind: "queue", item };
    identity = String(item.queueId);
  } else if (item instanceof JobTreeItem || item instanceof StalePinnedJobTreeItem) {
    const url = canonicalizeJobUrlForEnvironment(item.environment.url, item.jobUrl) ?? item.jobUrl;
    target = { kind: "job", item, url, aliases: [...new Set([item.jobUrl, url])] };
    identity = url;
  } else {
    return undefined;
  }
  return { target, identity };
}
