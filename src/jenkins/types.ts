export interface JenkinsClientOptions {
  baseUrl: string;
  username?: string;
  token?: string;
  authConfig?: JenkinsAuthConfig;
  requestTimeoutMs?: number;
}

export type JenkinsAuthType = "none" | "basic" | "bearer" | "cookie" | "headers";

export type JenkinsAuthConfig =
  | { type: "none" }
  | { type: "basic"; username: string; token: string }
  | { type: "bearer"; token: string }
  | { type: "cookie"; cookie: string }
  | { type: "headers"; headers: Record<string, string> };

export interface JenkinsJob {
  name: string;
  url: string;
  _class?: string;
  color?: string;
  lastCompletedBuild?: JenkinsBuildSummary;
  lastBuild?: JenkinsBuildSummary;
}

export interface JenkinsBuildSummary {
  number: number;
  url?: string;
  result?: string;
  building?: boolean;
  timestamp?: number;
}

export interface JenkinsBuild {
  number: number;
  url: string;
  result?: string;
  building?: boolean;
  timestamp?: number;
  duration?: number;
  estimatedDuration?: number;
  changeSet?: JenkinsChangeSet;
  changeSets?: JenkinsChangeSet[];
  actions?: Array<JenkinsBuildAction | null> | null;
}

export interface JenkinsUser {
  fullName: string;
}

export interface JenkinsArtifact {
  fileName: string;
  relativePath: string;
}

export interface JenkinsChangeSetItem {
  commitId?: string;
  msg?: string;
  author?: JenkinsUser;
}

export interface JenkinsChangeSet {
  items?: JenkinsChangeSetItem[];
}

export interface JenkinsTestSummaryAction {
  _class?: string;
  failCount?: number;
  skipCount?: number;
  totalCount?: number;
}

export interface JenkinsBuildCause {
  shortDescription?: string;
  userId?: string;
  userName?: string;
}

export interface JenkinsCauseAction {
  _class?: string;
  causes?: JenkinsBuildCause[];
}

export interface JenkinsBuildParameter {
  name?: string;
  value?: unknown;
}

export interface JenkinsParametersAction {
  _class?: string;
  parameters?: JenkinsBuildParameter[];
}

export type JenkinsBuildAction =
  | JenkinsCauseAction
  | JenkinsParametersAction
  | JenkinsTestSummaryAction;

export interface JenkinsTestReportCase {
  name?: string;
  className?: string;
  status?: string;
  errorDetails?: string;
  errorStackTrace?: string;
  duration?: number;
  stdout?: string;
  stderr?: string;
}

export interface JenkinsTestReportSuite {
  name?: string;
  cases?: JenkinsTestReportCase[];
}

export interface JenkinsTestReport {
  failCount?: number;
  skipCount?: number;
  totalCount?: number;
  suites?: JenkinsTestReportSuite[];
}

export interface JenkinsBuildDetails extends JenkinsBuild {
  displayName?: string;
  fullDisplayName?: string;
  culprits?: JenkinsUser[];
  artifacts?: JenkinsArtifact[];
}

export interface JenkinsPendingInputParameterDefinition {
  name?: string;
  type?: string;
  defaultParameterValue?: { value?: unknown };
  defaultValue?: unknown;
  choices?: unknown;
  description?: string;
}

export interface JenkinsPendingInputAction {
  id?: string;
  inputId?: string;
  message?: string;
  proceedText?: string;
  proceedUrl?: string;
  abortUrl?: string;
  submitter?: string;
  submitterParameter?: string;
  inputs?: JenkinsPendingInputParameterDefinition[];
  parameters?: JenkinsPendingInputParameterDefinition[];
}

export interface JenkinsWorkflowStep {
  id?: string;
  name?: string;
  status?: string;
  startTimeMillis?: number;
  durationMillis?: number;
  pauseDurationMillis?: number;
}

export interface JenkinsWorkflowStage {
  id?: string;
  name?: string;
  status?: string;
  startTimeMillis?: number;
  durationMillis?: number;
  pauseDurationMillis?: number;
  execNode?: string;
  execDurationMillis?: number;
  stageFlowNodes?: JenkinsWorkflowStep[];
  steps?: JenkinsWorkflowStep[];
  parallelStages?: JenkinsWorkflowStage[];
  branches?: JenkinsWorkflowStage[];
  children?: JenkinsWorkflowStage[];
}

export interface JenkinsWorkflowRun {
  id?: string;
  name?: string;
  status?: string;
  startTimeMillis?: number;
  endTimeMillis?: number;
  durationMillis?: number;
  queueDurationMillis?: number;
  pauseDurationMillis?: number;
  stages?: JenkinsWorkflowStage[];
}

export interface JenkinsConsoleText {
  text: string;
  truncated: boolean;
}

export interface JenkinsConsoleTextTail extends JenkinsConsoleText {
  nextStart: number;
  progressiveSupported: boolean;
}

export interface JenkinsProgressiveConsoleText {
  text: string;
  textSize: number;
  moreData: boolean;
}

export interface JenkinsProgressiveConsoleHtml {
  html: string;
  textSize: number;
  textSizeKnown: boolean;
  moreData: boolean;
  annotator?: string;
}

export interface JenkinsNode {
  displayName: string;
  name?: string;
  url?: string;
  assignedLabels?: Array<{
    name?: string;
  }>;
  offline: boolean;
  temporarilyOffline: boolean;
  offlineCauseReason?: string;
  offlineCause?: JenkinsNodeOfflineCause;
  jnlpAgent?: boolean;
  launchSupported?: boolean;
  manualLaunchAllowed?: boolean;
  numExecutors?: number;
  busyExecutors?: number;
}

export interface JenkinsNodeExecutable {
  number?: number;
  url?: string;
  displayName?: string;
  fullDisplayName?: string;
  result?: string;
  timestamp?: number;
  duration?: number;
  estimatedDuration?: number;
  building?: boolean;
}

export interface JenkinsNodeExecutor {
  number?: number;
  idle?: boolean;
  progress?: number;
  currentExecutable?: JenkinsNodeExecutable;
  currentWorkUnit?: JenkinsNodeExecutable;
}

export interface JenkinsNodeOfflineCause {
  _class?: string;
  description?: string;
  shortDescription?: string;
  timestamp?: number;
  name?: string;
}

export interface JenkinsNodeDetails extends JenkinsNode {
  _class?: string;
  description?: string;
  icon?: string;
  iconClassName?: string;
  idle?: boolean;
  jnlpAgent?: boolean;
  launchSupported?: boolean;
  manualLaunchAllowed?: boolean;
  monitorData?: Record<string, unknown>;
  loadStatistics?: Record<string, unknown>;
  executors?: JenkinsNodeExecutor[];
  oneOffExecutors?: JenkinsNodeExecutor[];
}

export interface JenkinsQueueTask {
  name?: string;
  url?: string;
}

export interface JenkinsQueueExecutable {
  number: number;
  url?: string;
}

export interface JenkinsQueueItem {
  id: number;
  task?: JenkinsQueueTask;
  why?: string;
  inQueueSince?: number;
  blocked?: boolean;
  buildable?: boolean;
  stuck?: boolean;
  cancelled?: boolean;
  executable?: JenkinsQueueExecutable;
}

export interface JenkinsParameterDefinition {
  name: string;
  type?: string;
  defaultValue?: string | number | boolean;
  choices?: string[];
  description?: string;
}

export type JenkinsJobKind = "folder" | "multibranch" | "pipeline" | "job" | "unknown";
