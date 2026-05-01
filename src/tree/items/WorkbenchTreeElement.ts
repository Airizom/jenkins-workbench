import type {
  ArtifactTreeItem,
  BuildArtifactsFolderTreeItem,
  BuildTreeItem
} from "./TreeBuildItems";
import type {
  ActivityJobTreeItem,
  ActivityPipelineTreeItem,
  JenkinsFolderTreeItem,
  JenkinsViewTreeItem,
  JobTreeItem,
  PipelineTreeItem,
  QuickAccessJobTreeItem,
  QuickAccessPipelineTreeItem,
  StalePinnedJobTreeItem
} from "./TreeJobItems";
import type { NodeTreeItem } from "./TreeNodeItems";
import type { PlaceholderTreeItem } from "./TreePlaceholderItem";
import type { QueueItemTreeItem } from "./TreeQueueItems";
import type {
  ActivityFolderTreeItem,
  ActivityGroupTreeItem,
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  JobsFolderTreeItem,
  NodesFolderTreeItem,
  PinnedJobsFolderTreeItem,
  PinnedSectionTreeItem,
  RootSectionTreeItem,
  ViewsFolderTreeItem
} from "./TreeRootItems";
import type {
  WorkspaceDirectoryTreeItem,
  WorkspaceFileTreeItem,
  WorkspaceRootTreeItem
} from "./TreeWorkspaceItems";

export type WorkbenchTreeElement =
  | RootSectionTreeItem
  | InstanceTreeItem
  | ActivityFolderTreeItem
  | ActivityGroupTreeItem
  | ViewsFolderTreeItem
  | JobsFolderTreeItem
  | BuildQueueFolderTreeItem
  | NodesFolderTreeItem
  | PinnedJobsFolderTreeItem
  | JenkinsViewTreeItem
  | PinnedSectionTreeItem
  | JenkinsFolderTreeItem
  | JobTreeItem
  | PipelineTreeItem
  | ActivityJobTreeItem
  | ActivityPipelineTreeItem
  | QuickAccessJobTreeItem
  | QuickAccessPipelineTreeItem
  | StalePinnedJobTreeItem
  | BuildTreeItem
  | BuildArtifactsFolderTreeItem
  | ArtifactTreeItem
  | WorkspaceRootTreeItem
  | WorkspaceDirectoryTreeItem
  | WorkspaceFileTreeItem
  | NodeTreeItem
  | QueueItemTreeItem
  | PlaceholderTreeItem;
