import type {
  ArtifactTreeItem,
  BuildArtifactsFolderTreeItem,
  BuildTreeItem
} from "./TreeBuildItems";
import type {
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
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  JobsFolderTreeItem,
  NodesFolderTreeItem,
  PinnedJobsFolderTreeItem,
  PinnedSectionTreeItem,
  RootSectionTreeItem,
  ViewsFolderTreeItem
} from "./TreeRootItems";

export type WorkbenchTreeElement =
  | RootSectionTreeItem
  | InstanceTreeItem
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
  | QuickAccessJobTreeItem
  | QuickAccessPipelineTreeItem
  | StalePinnedJobTreeItem
  | BuildTreeItem
  | BuildArtifactsFolderTreeItem
  | ArtifactTreeItem
  | NodeTreeItem
  | QueueItemTreeItem
  | PlaceholderTreeItem;
