import type { JenkinsNodeInfo } from "../jenkins/JenkinsDataService";
import { collectAssignedLabelNames } from "../jenkins/labels";

export interface NodeLabelClassification {
  allLabels: string[];
  poolLabels: string[];
  hiddenLabels: string[];
  poolLabelSet: Set<string>;
  hiddenLabelSet: Set<string>;
}

export type NodeLabelInput = Pick<JenkinsNodeInfo, "displayName" | "name" | "assignedLabels">;

export function classifyNodeLabels(node: NodeLabelInput): NodeLabelClassification {
  const allLabels = collectAssignedLabelNames(node.assignedLabels);
  const selfKeys = new Set(
    [node.name, node.displayName].map((value) => normalizeLabelKey(value)).filter(Boolean)
  );
  const poolLabels: string[] = [];
  const hiddenLabels: string[] = [];
  for (const label of allLabels) {
    if (selfKeys.has(normalizeLabelKey(label))) {
      hiddenLabels.push(label);
    } else {
      poolLabels.push(label);
    }
  }
  return {
    allLabels,
    poolLabels,
    hiddenLabels,
    poolLabelSet: new Set(poolLabels.map((label) => normalizeLabelKey(label))),
    hiddenLabelSet: new Set(hiddenLabels.map((label) => normalizeLabelKey(label)))
  };
}

export function normalizeLabelKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}
