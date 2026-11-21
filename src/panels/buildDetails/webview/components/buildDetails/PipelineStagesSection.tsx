import * as React from "react";
import { Accordion } from "../../../../shared/webview/components/ui/accordion";
import type {
  PipelineLogTargetViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";
import type { PipelineStageRequest } from "./pipelineSectionState";
import {
  defaultShowAllSteps,
  getStageId,
  pruneStageFlags
} from "./pipelineStages/pipelineStagesUtils";
import { StageNode } from "./pipelineStages/StageNode";

const { useMemo, useState } = React;
export function PipelineStagesSection({
  stages,
  expandRequest,
  onRestartStage,
  onSelectPipelineLog
}: {
  stages: PipelineStageViewModel[];
  /** Stage to open on each new request (the default failed stage, a strip click). */
  expandRequest?: PipelineStageRequest;
  onRestartStage: (stageName: string) => void;
  onSelectPipelineLog: (target: PipelineLogTargetViewModel) => void;
}) {
  const [openStages, setOpenStages] = useState<string[]>([]);
  const [showAllStages, setShowAllStages] = useState<Record<string, boolean>>({});

  const stageIds = useMemo(() => stages.map((stage, index) => getStageId(stage, index)), [stages]);
  const stageIdSet = useMemo(() => new Set(stageIds), [stageIds]);

  const [previousStageIds, setPreviousStageIds] = useState(stageIdSet);
  if (previousStageIds !== stageIdSet) {
    setPreviousStageIds(stageIdSet);
    setOpenStages(openStages.filter((id) => stageIdSet.has(id)));
    setShowAllStages(pruneStageFlags(showAllStages, stageIdSet));
  }

  const expandedStageId =
    expandRequest && stageIdSet.has(expandRequest.stageKey) ? expandRequest.stageKey : undefined;
  const requestId = expandRequest?.id;
  const [previousRequest, setPreviousRequest] = useState<{ stageId?: string; id?: number }>({});
  if (previousRequest.stageId !== expandedStageId || previousRequest.id !== requestId) {
    setPreviousRequest({ stageId: expandedStageId, id: requestId });
    if (expandedStageId && requestId !== undefined) {
      setOpenStages((open) => (open.includes(expandedStageId) ? open : [...open, expandedStageId]));
    }
  }

  return (
    <Accordion type="multiple" value={openStages} onValueChange={setOpenStages}>
      {stages.map((stage, index) => {
        const stageId = stageIds[index];
        const showAll = showAllStages[stageId] ?? defaultShowAllSteps(stage);
        const isLast = index === stages.length - 1;
        return (
          <StageNode
            key={stageId}
            stageId={stageId}
            stage={stage}
            showAll={showAll}
            isLast={isLast}
            onRestartStage={onRestartStage}
            onSelectPipelineLog={onSelectPipelineLog}
            onShowAllChange={(next) =>
              setShowAllStages((prev) => ({
                ...prev,
                [stageId]: next
              }))
            }
          />
        );
      })}
    </Accordion>
  );
}
