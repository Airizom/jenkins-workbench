import type { JenkinsTestReportOptions } from "../JenkinsTestReportOptions";

const BUILD_CHANGE_SET_FIELDS = [
  "changeSet[items[commitId,msg,author[fullName]]]",
  "changeSets[items[commitId,msg,author[fullName]]]"
];

const BUILD_ACTION_BASE_FIELDS = ["_class", "urlName"];
const BUILD_ACTION_CAUSE_FIELD = "causes[shortDescription,userId,userName]";
const BUILD_ACTION_PARAMETER_FIELD = "parameters[name,value]";

export function buildBuildsTree(options?: {
  includeDetails?: boolean;
  includeParameters?: boolean;
}): string {
  const parts: string[] = [
    "builds[",
    "number,url,result,building,timestamp,duration,estimatedDuration"
  ];

  if (options?.includeDetails) {
    parts.push(",", BUILD_CHANGE_SET_FIELDS.join(","));
  }

  const includeCauses = Boolean(options?.includeDetails);
  const includeParameters = Boolean(options?.includeParameters);
  if (includeCauses || includeParameters) {
    parts.push(`,actions[${buildActionFields({ includeCauses, includeParameters }).join(",")}]`);
  }

  parts.push("]{limit}");
  return parts.join("");
}

export function buildBuildDetailsTree(options?: {
  includeCauses?: boolean;
  includeParameters?: boolean;
  statusOnly?: boolean;
}): string {
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
  const caseFields = ["name", "className", "status", "errorDetails", "duration"];
  if (options?.includeCaseLogs) {
    caseFields.push("errorStackTrace", "stdout", "stderr");
  }
  return `failCount,skipCount,totalCount,suites[cases[${caseFields.join(",")}]]`;
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
