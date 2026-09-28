import type {
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacityViewModel
} from "../../../src/shared/nodeCapacity/NodeCapacityContracts";
import type { QueueWorkItemViewModel } from "../../../src/shared/queueWork/QueueWorkContracts";

const now = Date.now();

function queueItem(
  id: number,
  name: string,
  label: string,
  minutes: number,
  stuck = false
): QueueWorkItemViewModel {
  return {
    id,
    name,
    position: id,
    statusLabel: stuck ? "Stuck" : "Waiting",
    reason: `Waiting for next available executor on ‘${label}’`,
    queuedForLabel: label,
    queuedForLabels: [label],
    inQueueSince: now - minutes * 60_000,
    queuedDurationLabel: `${minutes}m`,
    taskUrl: `https://jenkins.example.com/job/${name}/`,
    blocked: false,
    buildable: true,
    stuck
  };
}

function node(
  name: string,
  labels: string[],
  total: number,
  busy: number,
  offline = false,
  offlineReason?: string
): NodeCapacityNodeViewModel {
  const idle = offline ? 0 : total - busy;
  return {
    displayName: name,
    name,
    nodeUrl: `https://jenkins.example.com/computer/${name}/`,
    statusLabel: offline ? "Offline" : busy > 0 ? "Online" : "Idle",
    isOffline: offline,
    isTemporarilyOffline: false,
    offlineReason,
    labels,
    poolLabels: labels,
    hiddenLabels: [],
    totalExecutors: total,
    busyExecutors: offline ? 0 : busy,
    idleExecutors: idle,
    offlineExecutors: offline ? total : 0,
    executorSummary: offline ? `${total} offline` : `${busy}/${total} busy`,
    executorsLoaded: true,
    executors: Array.from({ length: total }, (_, index) => ({
      id: `#${index}`,
      statusLabel: offline ? "Offline" : index < busy ? "Busy" : "Idle",
      isIdle: offline || index >= busy,
      workLabel: !offline && index < busy ? `web-app » main #${1480 + index}` : undefined,
      workUrl:
        !offline && index < busy
          ? `https://jenkins.example.com/job/web-app/${1480 + index}/`
          : undefined
    })),
    matchingQueueItems: [],
    anyQueueItems: [],
    selfLabelQueueItems: []
  };
}

function pool(
  id: string,
  label: string,
  severity: NodeCapacityPoolViewModel["severity"],
  statusLabel: string,
  nodes: NodeCapacityNodeViewModel[],
  queueItems: QueueWorkItemViewModel[]
): NodeCapacityPoolViewModel {
  const sum = (key: "totalExecutors" | "busyExecutors" | "idleExecutors" | "offlineExecutors") =>
    nodes.reduce((total, item) => total + item[key], 0);
  const offlineNodes = nodes.filter((item) => item.isOffline);
  return {
    id,
    label,
    kind: "label",
    severity,
    statusLabel,
    nodes,
    queueItems,
    totalNodes: nodes.length,
    onlineNodes: nodes.length - offlineNodes.length,
    offlineNodes: offlineNodes.length,
    totalExecutors: sum("totalExecutors"),
    busyExecutors: sum("busyExecutors"),
    idleExecutors: sum("idleExecutors"),
    offlineExecutors: sum("offlineExecutors"),
    queuedCount: queueItems.length,
    stuckCount: queueItems.filter((item) => item.stuck).length,
    blockedCount: 0,
    buildableCount: queueItems.length
  };
}

const pools: NodeCapacityPoolViewModel[] = [
  pool(
    "linux",
    "linux",
    "critical",
    "Stuck queue",
    [
      node("build-agent-01", ["linux", "docker"], 4, 4),
      node("build-agent-02", ["linux", "docker"], 4, 4),
      node("build-agent-03", ["linux"], 4, 0, true, "Disconnected: ChannelClosedException")
    ],
    [
      queueItem(1, "web-app-pr-842", "linux", 14, true),
      queueItem(2, "api-gateway", "linux", 6),
      queueItem(3, "billing-service", "linux", 2)
    ]
  ),
  pool(
    "macos",
    "macos",
    "warning",
    "Queue pressure",
    [node("mac-mini-01", ["macos", "xcode"], 2, 2), node("mac-mini-02", ["macos", "xcode"], 2, 1)],
    [queueItem(4, "ios-app", "macos", 3)]
  ),
  pool("windows", "windows", "normal", "Available", [node("win-agent-01", ["windows"], 2, 0)], [])
];

const busy: NodeCapacityViewModel = {
  environmentLabel: "jenkins.example.com",
  updatedAt: new Date(now - 20_000).toISOString(),
  summary: {
    totalNodes: 6,
    onlineNodes: 5,
    offlineNodes: 1,
    totalExecutors: 18,
    busyExecutors: 11,
    idleExecutors: 3,
    offlineExecutors: 4,
    queuedCount: 5,
    stuckCount: 1,
    blockedCount: 0,
    buildableCount: 5,
    saturatedPoolCount: 1
  },
  pools,
  hiddenLabelQueueItems: [queueItem(5, "docs-site", "hugo", 1)],
  errors: [],
  loading: false
};

const empty: NodeCapacityViewModel = {
  ...busy,
  summary: {
    ...busy.summary,
    totalNodes: 0,
    onlineNodes: 0,
    offlineNodes: 0,
    totalExecutors: 0,
    busyExecutors: 0,
    idleExecutors: 0,
    offlineExecutors: 0,
    queuedCount: 0,
    stuckCount: 0,
    buildableCount: 0,
    saturatedPoolCount: 0
  },
  pools: [],
  hiddenLabelQueueItems: []
};

const error: NodeCapacityViewModel = {
  ...empty,
  environmentLabel: "jenkins.example.com",
  errors: ["Request failed with status 503 (Service Unavailable)."]
};

export const nodeCapacityScenarios: Record<string, NodeCapacityViewModel> = {
  busy,
  empty,
  error
};
