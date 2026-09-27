import type { JenkinsTestReportOptions } from "../JenkinsTestReportOptions";

const BUILD_CHANGE_SET_FIELDS = [
  "changeSet[items[commitId,msg,author[fullName]]]",
  "changeSets[items[commitId,msg,author[fullName]]]"
];

const BUILD_ACTION_BASE_FIELDS = ["_class", "urlName", "lastBuiltRevision[SHA1]", "remoteUrls"];
const REVISION_FIELDS =
  "_class,lastBuiltRevision[SHA1],remoteUrls,revision[_class,pullHash,mergeHash,head[sourceOwner,sourceRepo,checkoutStrategy]]";
const BUILD_ACTION_CAUSE_FIELD = "causes[shortDescription,userId,userName]";
const BUILD_ACTION_PARAMETER_FIELD = "parameters[name,value]";

export function buildBuildsTree(options?: {
  offset?: number;
  includeDetails?: boolean;
  includeParameters?: boolean;
  includeRevisions?: boolean;
}): string {
  const parts: string[] = [
    options?.offset === undefined ? "builds[" : "allBuilds[",
    "number,url,result,building,timestamp,duration,estimatedDuration"
  ];

  if (options?.includeDetails) {
    parts.push(",", BUILD_CHANGE_SET_FIELDS.join(","));
  }

  const includeCauses = Boolean(options?.includeDetails);
  const includeParameters = Boolean(options?.includeParameters);
  if (options?.includeRevisions) {
    parts.push(`,actions[${REVISION_FIELDS}]`);
  } else if (includeCauses || includeParameters) {
    parts.push(`,actions[${buildActionFields({ includeCauses, includeParameters }).join(",")}]`);
  }

  parts.push("]{limit}");
  return parts.join("");
}

export function buildBuildDetailsTree(options?: {
  includeCauses?: boolean;
  includeParameters?: boolean;
  statusOnly?: boolean;
  revisionsOnly?: boolean;
}): string {
  if (options?.revisionsOnly) {
    return `number,url,result,building,timestamp,actions[${REVISION_FIELDS}]`;
  }
  if (options?.statusOnly) {
    return "number,url,result,building";
  }

  const actionParts = buildActionFields({
    extraFields: ["failCount", "skipCount", "totalCount"],
    includeCauses: options?.includeCauses,
    includeParameters: options?.includeParameters
  });
  return [
    "number,url,result,building,timestamp,duration,estimatedDuration,",
    "displayName,fullDisplayName,culprits[fullName],",
    "artifacts[fileName,relativePath],",
    `${BUILD_CHANGE_SET_FIELDS.join(",")},`,
    `actions[${actionParts.join(",")}]`
  ].join("");
}

export function buildTestReportTree(options?: JenkinsTestReportOptions): string {
  const caseFields = ["name", "className", "status", "age", "failedSince"];
  if (options?.projection !== "history") {
    caseFields.push("errorDetails", "duration");
  }
  if (options?.includeCaseLogs && options.projection !== "history") {
    caseFields.push("errorStackTrace", "stdout", "stderr");
  }
  return `passCount,failCount,skipCount,totalCount,suites[name,cases[${caseFields.join(",")}]]`;
}

function buildActionFields(options?: {
  extraFields?: string[];
  includeCauses?: boolean;
  includeParameters?: boolean;
}): string[] {
  const fields = [...BUILD_ACTION_BASE_FIELDS, ...(options?.extraFields ?? [])];
  if (options?.includeCauses) {
    fields.push(BUILD_ACTION_CAUSE_FIELD);
  }
  if (options?.includeParameters) {
    fields.push(BUILD_ACTION_PARAMETER_FIELD);
  }
  return fields;
}
