import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";

export function getStageId(stage: PipelineStageViewModel, index: number): string {
  if (typeof stage.key === "string" && stage.key.length > 0) {
    return stage.key;
  }
  if (typeof stage.name === "string" && stage.name.length > 0) {
    return `${stage.name}-${index}`;
  }
  return `stage-${index}`;
}

export function pruneStageFlags(
  prev: Record<string, boolean>,
  validKeys: Set<string>
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(prev)) {
    if (validKeys.has(key)) {
      next[key] = value;
    }
  }
  return next;
}
