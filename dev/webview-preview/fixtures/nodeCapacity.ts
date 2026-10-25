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
    reason: label
      ? `Waiting for next available executor on ‘${label}’`
      : "Waiting for next available executor",
    queuedForLabel: label || undefined,
    queuedForLabels: label ? [label] : [],
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
  offline: false | "offline" | "temporary" = false,
  offlineReason?: string
): NodeCapacityNodeViewModel {
  const idle = offline ? 0 : total - busy;
  return {
    displayName: name,
    name,
    nodeUrl: `https://jenkins.example.com/computer/${name}/`,
    statusLabel:
      offline === "temporary"
        ? "Temporarily offline"
        : offline
          ? "Offline"
          : busy > 0
            ? "Online"
            : "Idle",
    isOffline: offline !== false,
    isTemporarilyOffline: offline === "temporary",
    offlineReason,
    // Jenkins adds each agent's own name as a label; the host hides it from pools.
    labels: [...labels, name],
    poolLabels: labels,
    hiddenLabels: [name],
    totalExecutors: total,
    busyExecutors: offline ? 0 : busy,
    idleExecutors: idle,
    offlineExecutors: offline ? total : 0,
    executorSummary: offline ? `${total} offline` : `${busy}/${total} busy`,
    executorsLoaded: true,
    executors: Array.from({ length: total }, (_, index) => ({
      id: `#${index}`,
      statusLabel: offline ? "Offline" : index < busy ? "Busy" : "Idle",
      isIdle: offline !== false || index >= busy,
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
  label: string | { any: true },
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
    label: typeof label === "string" ? label : "Any node",
    kind: typeof label === "string" ? "label" : "any",
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

const linuxNodes = [
  node("build-agent-01", ["linux", "docker"], 4, 4),
  node("build-agent-02", ["linux", "docker"], 4, 4),
  node(
    "build-agent-03",
    ["linux"],
    4,
    0,
    "offline",
    "Disconnected: java.nio.channels.ClosedChannelException. The agent process exited after the controller restarted; check the agent log on the machine for the full stack trace."
  ),
  node("build-agent-04", ["linux"], 2, 0, "temporary", "Draining for kernel upgrade (mia)")
];
const macNodes = [
  node("mac-mini-01", ["macos", "xcode"], 2, 2),
  node("mac-mini-02", ["macos", "xcode"], 2, 1)
];
const windowsNodes = [node("win-agent-01", ["windows"], 2, 0)];

const pools: NodeCapacityPoolViewModel[] = [
  pool("linux", "linux", "critical", "Stuck queue", linuxNodes, [
    queueItem(1, "web-app-pr-842", "linux", 14, true),
    queueItem(2, "api-gateway", "linux", 6),
    queueItem(3, "billing-service", "linux", 2)
  ]),
  pool("macos", "macos", "warning", "Queue pressure", macNodes, [
    queueItem(4, "ios-app", "macos", 3)
  ]),
  pool(
    "any",
    { any: true },
    "normal",
    "Available",
    [...linuxNodes, ...macNodes, ...windowsNodes],
    []
  ),
  pool("windows", "windows", "normal", "Available", windowsNodes, [])
];

const busy: NodeCapacityViewModel = {
  environmentLabel: "jenkins.example.com",
  updatedAt: new Date(now - 20_000).toISOString(),
  summary: {
    totalNodes: 7,
    onlineNodes: 5,
    offlineNodes: 2,
    totalExecutors: 20,
    busyExecutors: 11,
    idleExecutors: 3,
    offlineExecutors: 6,
    queuedCount: 5,
    stuckCount: 1,
    blockedCount: 0,
    buildableCount: 5,
    saturatedPoolCount: 1
  },
  pools,
  hiddenLabelQueueItems: [queueItem(5, "docs-site", "mac-mini-02", 1)],
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

const stale: NodeCapacityViewModel = {
  ...busy,
  updatedAt: new Date(now - 5 * 60_000).toISOString(),
  hiddenLabelQueueItems: [
    queueItem(5, "docs-site", "mac-mini-02", 1),
    queueItem(6, "firmware-flash", "build-agent-03", 32, true)
  ]
};

// A larger controller: a long "Any node" list, many label pools, and a mix of
// severities to exercise the filter, the node cap, and Collapse all.
const fleetNodes = Array.from({ length: 28 }, (_, index) => {
  const name = `fleet-${String(index + 1).padStart(2, "0")}`;
  if (index === 17) {
    return node(name, ["fleet", "arm64"], 2, 0, "offline", "Agent went offline unexpectedly");
  }
  return node(name, ["fleet", index % 2 === 0 ? "amd64" : "arm64"], 2, index % 3 === 0 ? 2 : 1);
});
const fleetPools: NodeCapacityPoolViewModel[] = [
  pool("fleet", "fleet", "warning", "Queue pressure", fleetNodes, [
    queueItem(7, "integration-tests", "fleet", 4)
  ]),
  pool("any", { any: true }, "normal", "Available", fleetNodes, []),
  ...["amd64", "arm64", "gpu", "k8s-small", "k8s-large", "perf", "release", "sandbox"].map(
    (label, index) =>
      pool(
        label,
        label,
        "normal",
        "Available",
        fleetNodes.filter((_, nodeIndex) => nodeIndex % 8 === index),
        []
      )
  )
];
const fleet: NodeCapacityViewModel = {
  ...busy,
  summary: {
    ...busy.summary,
    totalNodes: 28,
    onlineNodes: 27,
    offlineNodes: 1,
    totalExecutors: 54,
    busyExecutors: 36,
    idleExecutors: 18,
    offlineExecutors: 2,
    queuedCount: 1,
    stuckCount: 0,
    buildableCount: 1,
    saturatedPoolCount: 0
  },
  pools: fleetPools,
  hiddenLabelQueueItems: []
};

export const nodeCapacityScenarios: Record<string, NodeCapacityViewModel> = {
  busy,
  stale,
  fleet,
  empty,
  error
};
