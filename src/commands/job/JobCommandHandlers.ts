import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import type { JobConfigPreviewer } from "../../ui/JobConfigPreviewer";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";

export async function viewJobConfig(
  dataService: JenkinsDataService,
  previewer: JobConfigPreviewer,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a job or pipeline to view its config.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  await withActionErrorMessage(`Unable to open config.xml for ${label}`, async () => {
    const configXml = await dataService.getJobConfigXml(selected.environment, selected.jobUrl);
    await previewer.preview(configXml);
  });
}
