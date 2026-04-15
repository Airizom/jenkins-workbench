export interface JenkinsCoverageQualityGate {
  name: string;
  status: string;
  threshold?: number;
  value?: string;
}

export interface JenkinsCoverageOverview {
  projectCoverage?: string;
  modifiedFilesCoverage?: string;
  modifiedLinesCoverage?: string;
  overallQualityGateStatus?: string;
  qualityGates: JenkinsCoverageQualityGate[];
}

export interface JenkinsModifiedCoverageBlock {
  startLine: number;
  endLine: number;
  type: "covered" | "missed" | "partial";
}

export interface JenkinsModifiedCoverageFile {
  path: string;
  blocks: JenkinsModifiedCoverageBlock[];
}
