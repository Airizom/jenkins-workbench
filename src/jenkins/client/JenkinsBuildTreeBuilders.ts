import type { JenkinsTestReportOptions } from "../JenkinsTestReportOptions";

export function buildBuildsTree(options?: {
  includeDetails?: boolean;
  includeParameters?: boolean;
}): string {
  const parts: string[] = [
    "builds[",
    "number,url,result,building,timestamp,duration,estimatedDuration"
  ];

  if (options?.includeDetails) {
    parts.push(",changeSet[items[commitId,msg,author[fullName]]]");
    parts.push(",changeSets[items[commitId,msg,author[fullName]]]");
  }

  const includeCauses = Boolean(options?.includeDetails);
  const includeParameters = Boolean(options?.includeParameters);
  if (includeCauses || includeParameters) {
    const actionParts = ["_class", "urlName"];
    if (includeCauses) {
      actionParts.push("causes[shortDescription,userId,userName]");
    }
    if (includeParameters) {
      actionParts.push("parameters[name,value]");
    }
    parts.push(`,actions[${actionParts.join(",")}]`);
  }

  parts.push("]{limit}");
  return parts.join("");
}

export function buildBuildDetailsTree(options?: {
  includeCauses?: boolean;
  includeParameters?: boolean;
}): string {
  const actionParts = ["_class", "urlName", "failCount", "skipCount", "totalCount"];
  if (options?.includeCauses) {
    actionParts.push("causes[shortDescription,userId,userName]");
  }
  if (options?.includeParameters) {
    actionParts.push("parameters[name,value]");
  }
  return [
    "number,url,result,building,timestamp,duration,estimatedDuration,",
    "displayName,fullDisplayName,culprits[fullName],",
    "artifacts[fileName,relativePath],",
    "changeSet[items[commitId,msg,author[fullName]]],",
    "changeSets[items[commitId,msg,author[fullName]]],",
    `actions[${actionParts.join(",")}]`
  ].join("");
}

export function buildTestReportTree(options?: JenkinsTestReportOptions): string {
  const caseFields = ["name", "className", "status", "errorDetails", "duration"];
  if (options?.includeCaseLogs) {
    caseFields.push("errorStackTrace", "stdout", "stderr");
  }
  return `failCount,skipCount,totalCount,suites[cases[${caseFields.join(",")}]]`;
}
