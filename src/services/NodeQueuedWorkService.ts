import type { JenkinsDataService, JenkinsNodeInfo } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { NodeQueuedWorkViewModel } from "../shared/queueWork/QueueWorkContracts";
import { classifyNodeLabels } from "./NodeLabelClassification";
import { buildNodeQueuedWorkViewModel, buildQueueWorkItems } from "./QueueWorkViewModel";

export class NodeQueuedWorkService {
  constructor(private readonly dataService: JenkinsDataService) {}

  async getQueuedWorkForNode(
    environment: JenkinsEnvironmentRef,
    node: Pick<JenkinsNodeInfo, "displayName" | "name" | "assignedLabels">
  ): Promise<NodeQueuedWorkViewModel> {
    const [queueItems, nodes] = await Promise.all([
      this.dataService.getQueueItems(environment),
      this.dataService.getNodes(environment, { mode: "cached" }).catch(() => [node])
    ]);
    const labels = classifyNodeLabels(node);
    const queueViewModels = buildQueueWorkItems(queueItems, { nodes });
    return buildNodeQueuedWorkViewModel(queueViewModels, labels);
  }
}
