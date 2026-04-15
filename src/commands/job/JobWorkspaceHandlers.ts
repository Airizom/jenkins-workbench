import type { WorkspaceFileTreeItem } from "../../tree/TreeItems";
import type { WorkspacePreviewer } from "../../ui/WorkspacePreviewer";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";

export async function previewWorkspaceFile(
  previewer: WorkspacePreviewer,
  item?: WorkspaceFileTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a workspace file to preview.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  await withActionErrorMessage(`Unable to open workspace file ${label}`, async () => {
    await previewer.preview(
      selected.environment,
      selected.jobUrl,
      selected.relativePath,
      selected.fileName
    );
  });
}
