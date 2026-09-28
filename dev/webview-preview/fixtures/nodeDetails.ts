import type { NodeDetailsViewModel } from "../../../src/panels/nodeDetails/shared/NodeDetailsContracts";

const now = Date.now();

const online: NodeDetailsViewModel = {
  detailsAvailable: true,
  displayName: "build-agent-01",
  name: "build-agent-01",
  description: "Ubuntu 24.04 · 16 vCPU · Docker 27",
  url: "https://jenkins.example.com/computer/build-agent-01/",
  updatedAt: new Date(now - 15_000).toISOString(),
  statusLabel: "Online",
  statusClass: "online",
  isOffline: false,
  isTemporarilyOffline: false,
  canTakeOffline: true,
  canBringOnline: false,
  canLaunchAgent: false,
  canOpenAgentInstructions: false,
  activityLabel: "Running builds",
  executorsLabel: "3 of 4 busy",
  labels: ["linux", "docker", "x86_64", "build-agent-01"],
  jnlpAgentLabel: "No",
  launchSupportedLabel: "Yes",
  manualLaunchLabel: "No",
  executors: [
    {
      id: "0",
      statusLabel: "Busy",
      isIdle: false,
      workLabel: "web-app » main #1483",
      workUrl: "https://jenkins.example.com/job/web-app/job/main/1483/",
      progressPercent: 42,
      progressLabel: "42%",
      workDurationLabel: "1m 40s",
      workDurationMs: 100_000
    },
    {
      id: "1",
      statusLabel: "Busy",
      isIdle: false,
      workLabel: "api-gateway » PR-311 #7",
      workUrl: "https://jenkins.example.com/job/api-gateway/job/PR-311/7/",
      progressPercent: 88,
      progressLabel: "88%",
      workDurationLabel: "6m 02s",
      workDurationMs: 362_000
    },
    {
      id: "2",
      statusLabel: "Busy",
      isIdle: false,
      workLabel: "billing-service » main #402",
      workUrl: "https://jenkins.example.com/job/billing-service/job/main/402/",
      workDurationLabel: "12s",
      workDurationMs: 12_000
    },
    { id: "3", statusLabel: "Idle", isIdle: true }
  ],
  oneOffExecutors: [],
  queuedWork: {
    matchingQueueItems: [
      {
        id: 91,
        name: "web-app-pr-842",
        position: 1,
        statusLabel: "Waiting",
        reason: "Waiting for next available executor on ‘linux’",
        queuedForLabel: "linux",
        queuedForLabels: ["linux"],
        inQueueSince: now - 4 * 60_000,
        queuedDurationLabel: "4m",
        taskUrl: "https://jenkins.example.com/job/web-app-pr-842/",
        blocked: false,
        buildable: true,
        stuck: false
      }
    ],
    anyQueueItems: [],
    selfLabelQueueItems: []
  },
  monitorData: [
    {
      key: "hudson.node_monitors.DiskSpaceMonitor",
      summary: "48.2 GB free",
      raw: { size: 51_753_000_000 }
    },
    { key: "hudson.node_monitors.ResponseTimeMonitor", summary: "42 ms", raw: { average: 42 } },
    {
      key: "hudson.node_monitors.ArchitectureMonitor",
      summary: "Linux (amd64)",
      raw: "Linux (amd64)"
    }
  ],
  loadStatistics: [],
  rawJson: JSON.stringify(
    { displayName: "build-agent-01", numExecutors: 4, offline: false },
    null,
    2
  ),
  errors: [],
  advancedLoaded: true
};

const offline: NodeDetailsViewModel = {
  ...online,
  displayName: "build-agent-03",
  name: "build-agent-03",
  statusLabel: "Offline",
  statusClass: "offline",
  isOffline: true,
  canTakeOffline: false,
  canBringOnline: true,
  canLaunchAgent: true,
  canOpenAgentInstructions: true,
  offlineReason: "Disconnected: java.nio.channels.ClosedChannelException",
  activityLabel: "Offline",
  executorsLabel: "4 offline",
  executors: online.executors.map((executor) => ({
    id: executor.id,
    statusLabel: "Offline",
    isIdle: true
  })),
  queuedWork: { matchingQueueItems: [], anyQueueItems: [], selfLabelQueueItems: [] },
  updatedAt: new Date(now - 20 * 60_000).toISOString()
};

const temporary: NodeDetailsViewModel = {
  ...online,
  displayName: "build-agent-02",
  name: "build-agent-02",
  statusLabel: "Temporarily offline",
  statusClass: "temporary",
  isOffline: true,
  isTemporarilyOffline: true,
  canTakeOffline: false,
  canBringOnline: true,
  offlineReason: "Draining for kernel upgrade (mia)",
  executorsLabel: "1 busy · 3 offline",
  executors: online.executors.map((executor, index) =>
    index === 0 ? executor : { id: executor.id, statusLabel: "Idle", isIdle: true }
  )
};

const idle: NodeDetailsViewModel = {
  ...online,
  displayName: "Windows build agent",
  name: "win-agent-01",
  description: undefined,
  statusLabel: "Idle",
  statusClass: "idle",
  activityLabel: "Idle",
  executorsLabel: "0 of 4 busy",
  executors: online.executors.map((executor) => ({
    id: executor.id,
    statusLabel: "Idle",
    isIdle: true
  })),
  queuedWork: { matchingQueueItems: [], anyQueueItems: [], selfLabelQueueItems: [] }
};

const error: NodeDetailsViewModel = {
  ...online,
  detailsAvailable: false,
  displayName: "Node Details",
  name: "Unknown",
  description: undefined,
  statusLabel: "Unknown",
  statusClass: "unknown",
  canTakeOffline: false,
  activityLabel: "Not available",
  executorsLabel: "Not available",
  labels: [],
  jnlpAgentLabel: undefined,
  launchSupportedLabel: undefined,
  manualLaunchLabel: undefined,
  executors: [],
  queuedWork: { matchingQueueItems: [], anyQueueItems: [], selfLabelQueueItems: [] },
  monitorData: [],
  rawJson: "",
  advancedLoaded: false,
  errors: ["Request failed with status 404 (Not Found)."]
};

export const nodeDetailsScenarios: Record<string, NodeDetailsViewModel> = {
  online,
  offline,
  temporary,
  idle,
  error
};
