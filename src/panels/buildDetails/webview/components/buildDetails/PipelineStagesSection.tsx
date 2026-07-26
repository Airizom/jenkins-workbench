import * as React from "react";
import { Accordion } from "../../../../shared/webview/components/ui/accordion";
import type {
  PipelineLogTargetViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";
import { getStageId, pruneStageFlags } from "./pipelineStages/pipelineStagesUtils";
import { StageNode } from "./pipelineStages/StageNode";

const { useEffect, useMemo, useState } = React;
export function PipelineStagesSection({
  stages,
  onRestartStage,
  onSelectPipelineLog
}: {
  stages: PipelineStageViewModel[];
  onRestartStage: (stageName: string) => void;
  onSelectPipelineLog: (target: PipelineLogTargetViewModel) => void;
}) {
  const [openStages, setOpenStages] = useState<string[]>([]);
  const [showAllStages, setShowAllStages] = useState<Record<string, boolean>>({});

  const stageIds = useMemo(() => stages.map((stage, index) => getStageId(stage, index)), [stages]);
  const stageIdSet = useMemo(() => new Set(stageIds), [stageIds]);

  useEffect(() => {
    setOpenStages((prev) => prev.filter((id) => stageIdSet.has(id)));
    setShowAllStages((prev) => pruneStageFlags(prev, stageIdSet));
  }, [stageIdSet]);

  return (
    <Accordion type="multiple" value={openStages} onValueChange={setOpenStages}>
      {stages.map((stage, index) => {
        const stageId = stageIds[index];
        const showAll = showAllStages[stageId] ?? false;
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
