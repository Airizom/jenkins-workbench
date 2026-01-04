export interface JenkinsClientOptions {
  baseUrl: string;
  username?: string;
  token?: string;
  requestTimeoutMs?: number;
}

export interface JenkinsJob {
  name: string;
  url: string;
  _class?: string;
  color?: string;
  lastCompletedBuild?: JenkinsBuildSummary;
}

export interface JenkinsBuildSummary {
  number: number;
  result?: string;
  timestamp?: number;
}

export interface JenkinsBuild {
  number: number;
  url: string;
  result?: string;
  building?: boolean;
  timestamp?: number;
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

export interface JenkinsTestReportCase {
  name?: string;
  className?: string;
  status?: string;
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
  duration?: number;
  displayName?: string;
  fullDisplayName?: string;
  culprits?: JenkinsUser[];
  artifacts?: JenkinsArtifact[];
  changeSet?: JenkinsChangeSet;
  changeSets?: JenkinsChangeSet[];
  actions?: Array<JenkinsTestSummaryAction | null> | null;
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

export interface JenkinsNode {
  displayName: string;
  offline: boolean;
  temporarilyOffline: boolean;
}

export interface JenkinsQueueTask {
  name?: string;
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
}

export interface JenkinsParameterDefinition {
  name: string;
  type?: string;
  defaultValue?: string | number | boolean;
  choices?: string[];
  description?: string;
}

export type JenkinsJobKind = "folder" | "multibranch" | "pipeline" | "job" | "unknown";
