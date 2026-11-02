import { JenkinsDuplicateItemError, JenkinsRequestError } from "../errors";
import { buildMultibranchPipelineXml } from "../MultibranchPipelineXml";
import type {
  JenkinsJob,
  JenkinsJobKind,
  JenkinsModeCreateKind,
  JenkinsMultibranchCreateOptions,
  JenkinsParameterDefinition,
  JenkinsView,
  ScanMultibranchResult
} from "../types";
import {
  buildActionUrl,
  buildApiUrlFromBase,
  buildApiUrlFromItem,
  buildJobUrl,
  buildViewScopedJobUrl,
  ensureTrailingSlash,
  parseJobUrl
} from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import {
  extractParameterDefinitions,
  type JenkinsJobParametersResponse
} from "./JenkinsParameters";

const JOB_LIST_TREE = "jobs[name,url,_class,color]";
const JOB_DETAIL_TREE =
  "name,url,_class,color,inQueue,lastSuccessfulBuild[number,url,result,building,timestamp],lastCompletedBuild[number,result,timestamp],lastBuild[number,url,result,building,timestamp]";
const VIEW_LIST_TREE = "views[name,url]";
const JOB_PARAMETER_TREE =
  "parameterDefinitions[name,type,defaultParameterValue[value],defaultValue,choices,description,projectName,multiSelectDelimiter]";
const JOB_PARAMETERS_TREE = `actions[${JOB_PARAMETER_TREE}],property[${JOB_PARAMETER_TREE}]`;
const CREATE_ITEM_MODES: Record<JenkinsModeCreateKind, string> = {
  job: "hudson.model.FreeStyleProject",
  pipeline: "org.jenkinsci.plugins.workflow.job.WorkflowJob",
  folder: "com.cloudbees.hudson.plugins.folder.Folder"
};

const JOB_CLASSIFIER_TOKENS: Array<{ readonly token: string; readonly kind: JenkinsJobKind }> = [
  { token: "organizationfolder", kind: "folder" },
  { token: "folder", kind: "folder" },
  { token: "workflowmultibranchproject", kind: "multibranch" },
  { token: "workflowjob", kind: "pipeline" },
  { token: "job", kind: "job" }
];

export class JenkinsJobsApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getRootJobs(): Promise<JenkinsJob[]> {
    const url = buildApiUrlFromBase(this.context.baseUrl, "api/json", JOB_LIST_TREE);
    return this.fetchJobs(url);
  }

  async getViews(): Promise<JenkinsView[]> {
    const url = buildApiUrlFromBase(this.context.baseUrl, "api/json", VIEW_LIST_TREE);
    return this.fetchViews(url);
  }

  async getFolderJobs(folderUrl: string): Promise<JenkinsJob[]> {
    const url = buildApiUrlFromItem(folderUrl, JOB_LIST_TREE);
    return this.fetchJobs(url);
  }

  async getFolderJobsInView(folderUrl: string, viewUrl: string): Promise<JenkinsJob[]> {
    return this.getFolderJobs(buildViewScopedJobUrl(viewUrl, folderUrl, this.context.baseUrl));
  }

  async getViewJobs(viewUrl: string): Promise<JenkinsJob[]> {
    const url = buildApiUrlFromItem(viewUrl, JOB_LIST_TREE);
    return this.fetchJobs(url);
  }

  async getJob(jobUrl: string): Promise<JenkinsJob> {
    const url = buildApiUrlFromItem(jobUrl, JOB_DETAIL_TREE);
    return this.context.requestJson<JenkinsJob>(url);
  }

  async getNextBuildNumber(jobUrl: string): Promise<number> {
    const url = buildApiUrlFromItem(jobUrl, "nextBuildNumber");
    const response = await this.context.requestJson<{ nextBuildNumber?: unknown }>(url);
    const nextBuildNumber = response?.nextBuildNumber;
    if (
      typeof nextBuildNumber !== "number" ||
      !Number.isSafeInteger(nextBuildNumber) ||
      nextBuildNumber <= 0
    ) {
      throw new Error(`Jenkins returned an invalid next build number for ${jobUrl}.`);
    }
    return nextBuildNumber;
  }

  classifyJob(job: JenkinsJob): JenkinsJobKind {
    const className = job._class;
    if (!className) {
      return "unknown";
    }

    const normalized = className.toLowerCase();
    const kind = JOB_CLASSIFIER_TOKENS.find((c) => normalized.includes(c.token))?.kind;
    if (kind) {
      return kind;
    }

    // Jenkins exposes many concrete job subclasses that are still job-like
    // from the tree's perspective, such as FreeStyleProject and MatrixProject.
    return className.trim() ? "job" : "unknown";
  }

  async getJobParameters(jobUrl: string): Promise<JenkinsParameterDefinition[]> {
    const url = buildApiUrlFromItem(jobUrl, JOB_PARAMETERS_TREE);
    const response = await this.context.requestJson<JenkinsJobParametersResponse>(url);
    return extractParameterDefinitions(response);
  }

  async getJobConfigXml(jobUrl: string): Promise<string> {
    const url = buildActionUrl(jobUrl, "config.xml");
    return this.context.requestText(url);
  }

  async updateJobConfigXml(jobUrl: string, xml: string): Promise<void> {
    const url = buildActionUrl(jobUrl, "config.xml");
    await this.context.requestPostWithCrumbRaw(url, xml, {
      "Content-Type": "application/xml; charset=utf-8"
    });
  }

  async enableJob(jobUrl: string): Promise<void> {
    const url = buildActionUrl(jobUrl, "enable");
    await this.context.requestVoidWithCrumb(url);
  }

  async disableJob(jobUrl: string): Promise<void> {
    const url = buildActionUrl(jobUrl, "disable");
    await this.context.requestVoidWithCrumb(url);
  }

  async scanMultibranch(folderUrl: string): Promise<ScanMultibranchResult> {
    const url = buildActionUrl(folderUrl, "build");
    const response = await this.context.requestPostWithCrumb(url);
    return { queueLocation: response.location };
  }

  async renameJob(jobUrl: string, newName: string): Promise<{ newUrl: string }> {
    const url = buildActionUrl(jobUrl, "doRename");
    const body = `newName=${encodeURIComponent(newName)}`;
    const response = await this.context.requestPostWithCrumb(url, body);

    if (response.location) {
      return { newUrl: response.location };
    }

    const parsed = parseJobUrl(jobUrl, this.context.baseUrl);
    if (parsed) {
      return { newUrl: buildJobUrl(parsed.parentUrl, newName) };
    }

    return { newUrl: jobUrl.replace(/\/[^/]+\/$/, `/${encodeURIComponent(newName)}/`) };
  }

  async deleteJob(jobUrl: string): Promise<void> {
    const url = buildActionUrl(jobUrl, "doDelete");
    await this.context.requestPostWithCrumb(url);
  }

  async copyJob(
    parentUrl: string,
    sourceName: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.createItemWithMode(parentUrl, newName, "copy", sourceName);
  }

  async createItem(
    kind: JenkinsModeCreateKind,
    parentUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.createItemWithMode(parentUrl, newName, CREATE_ITEM_MODES[kind]);
  }

  async createMultibranchPipeline(
    parentUrl: string,
    newName: string,
    options: JenkinsMultibranchCreateOptions
  ): Promise<{ newUrl: string }> {
    return this.createItemFromXml(parentUrl, newName, buildMultibranchPipelineXml(options));
  }

  async createItemFromXml(
    parentUrl: string,
    newName: string,
    xml: string
  ): Promise<{ newUrl: string }> {
    const url = new URL(buildActionUrl(parentUrl, "createItem"));
    url.searchParams.set("name", newName);
    const response = await withDuplicateNameError(newName, () =>
      this.context.requestPostWithCrumbRaw(url.toString(), xml, {
        "Content-Type": "application/xml; charset=utf-8"
      })
    );
    return { newUrl: resolveCreatedItemUrl(parentUrl, newName, response.location) };
  }

  private async fetchJobs(url: string): Promise<JenkinsJob[]> {
    const response = await this.context.requestJson<{ jobs?: JenkinsJob[] }>(url);
    return Array.isArray(response.jobs) ? response.jobs : [];
  }

  private async fetchViews(url: string): Promise<JenkinsView[]> {
    const response = await this.context.requestJson<{ views?: JenkinsView[] }>(url);
    return Array.isArray(response.views) ? response.views : [];
  }

  private async createItemWithMode(
    parentUrl: string,
    newName: string,
    mode: string,
    sourceName?: string
  ): Promise<{ newUrl: string }> {
    const url = buildActionUrl(parentUrl, "createItem");
    const params = new URLSearchParams();
    params.set("name", newName);
    params.set("mode", mode);
    if (sourceName !== undefined) {
      params.set("from", sourceName);
    }
    const fullUrl = `${url}?${params.toString()}`;
    const response = await withDuplicateNameError(newName, () =>
      this.context.requestPostWithCrumb(fullUrl, "")
    );

    return { newUrl: resolveCreatedItemUrl(parentUrl, newName, response.location) };
  }
}

const DUPLICATE_ITEM_PATTERN = /already exists|already contains an item/i;

/**
 * Jenkins rejects a taken name with a 400 or 500 whose only explanation is in the response body
 * or `X-Error` header, which the generic request error leaves out of its message.
 */
async function withDuplicateNameError<T>(newName: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof JenkinsRequestError && isDuplicateItemResponse(error)) {
      throw new JenkinsDuplicateItemError(
        `An item named "${newName}" already exists in this location.`,
        error.statusCode,
        error.responseText,
        error.responseHeaders
      );
    }
    throw error;
  }
}

function isDuplicateItemResponse(error: JenkinsRequestError): boolean {
  if (error.statusCode !== 400 && error.statusCode !== 500) {
    return false;
  }
  const header = error.responseHeaders?.["x-error"];
  const headerText = Array.isArray(header) ? header.join(" ") : (header ?? "");
  return (
    DUPLICATE_ITEM_PATTERN.test(headerText) || DUPLICATE_ITEM_PATTERN.test(error.responseText ?? "")
  );
}

/**
 * Jenkins answers a form-style createItem with a redirect to the new item's `configure` page,
 * sometimes relative, and an XML createItem with no Location at all. Both map to the item URL.
 */
function resolveCreatedItemUrl(parentUrl: string, newName: string, location?: string): string {
  if (location) {
    try {
      const resolved = new URL(location, ensureTrailingSlash(parentUrl));
      resolved.pathname = ensureTrailingSlash(resolved.pathname.replace(/\/configure\/?$/, "/"));
      resolved.search = "";
      resolved.hash = "";
      return resolved.toString();
    } catch {
      // Fall back to the URL Jenkins uses for a new child item.
    }
  }
  return buildJobUrl(parentUrl, newName);
}
