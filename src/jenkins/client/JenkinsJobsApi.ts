import type {
  JenkinsItemCreateKind,
  JenkinsJob,
  JenkinsJobKind,
  JenkinsParameterDefinition,
  ScanMultibranchResult
} from "../types";
import {
  buildActionUrl,
  buildApiUrlFromBase,
  buildApiUrlFromItem,
  buildJobUrl,
  parseJobUrl
} from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import {
  type JenkinsJobParametersResponse,
  extractParameterDefinitions
} from "./JenkinsParameters";

const JOB_LIST_TREE = "jobs[name,url,_class,color]";
const JOB_DETAIL_TREE =
  "name,url,_class,color,lastCompletedBuild[number,result,timestamp],lastBuild[number,url,result,building,timestamp]";
const CREATE_ITEM_MODES: Record<JenkinsItemCreateKind, string> = {
  job: "hudson.model.FreeStyleProject",
  pipeline: "org.jenkinsci.plugins.workflow.job.WorkflowJob"
};

const JOB_CLASSIFIERS: Array<{ kind: JenkinsJobKind; tokens: string[] }> = [
  { kind: "folder", tokens: ["organizationfolder", "folder"] },
  { kind: "multibranch", tokens: ["workflowmultibranchproject"] },
  { kind: "pipeline", tokens: ["workflowjob"] },
  { kind: "job", tokens: ["job"] }
];

export class JenkinsJobsApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getRootJobs(): Promise<JenkinsJob[]> {
    const url = buildApiUrlFromBase(this.context.baseUrl, "api/json", JOB_LIST_TREE);
    return this.fetchJobs(url);
  }

  async getFolderJobs(folderUrl: string): Promise<JenkinsJob[]> {
    const url = buildApiUrlFromItem(folderUrl, JOB_LIST_TREE);
    return this.fetchJobs(url);
  }

  async getJob(jobUrl: string): Promise<JenkinsJob> {
    const url = buildApiUrlFromItem(jobUrl, JOB_DETAIL_TREE);
    return this.context.requestJson<JenkinsJob>(url);
  }

  classifyJob(job: JenkinsJob): JenkinsJobKind {
    const className = job._class?.trim();
    if (!className) {
      return "unknown";
    }

    const normalized = className.toLowerCase();
    for (const classifier of JOB_CLASSIFIERS) {
      if (classifier.tokens.some((token) => normalized.includes(token))) {
        return classifier.kind;
      }
    }
    return "unknown";
  }

  async getJobParameters(jobUrl: string): Promise<JenkinsParameterDefinition[]> {
    const parameterTree =
      "parameterDefinitions[name,type,defaultParameterValue[value],defaultValue,choices,description]";
    const tree = `actions[${parameterTree}],property[${parameterTree}]`;
    const url = buildApiUrlFromItem(jobUrl, tree);
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

    const parsed = parseJobUrl(jobUrl);
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
    const url = buildActionUrl(parentUrl, "createItem");
    const params = new URLSearchParams();
    params.set("name", newName);
    params.set("mode", "copy");
    params.set("from", sourceName);
    const fullUrl = `${url}?${params.toString()}`;
    const response = await this.context.requestPostWithCrumb(fullUrl);

    if (response.location) {
      return { newUrl: response.location };
    }

    return { newUrl: buildJobUrl(parentUrl, newName) };
  }

  async createItem(
    kind: JenkinsItemCreateKind,
    parentUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.createItemWithMode(parentUrl, newName, CREATE_ITEM_MODES[kind]);
  }

  private async fetchJobs(url: string): Promise<JenkinsJob[]> {
    const response = await this.context.requestJson<{ jobs?: JenkinsJob[] }>(url);
    return Array.isArray(response.jobs) ? response.jobs : [];
  }

  private async createItemWithMode(
    parentUrl: string,
    newName: string,
    mode: string
  ): Promise<{ newUrl: string }> {
    const url = buildActionUrl(parentUrl, "createItem");
    const params = new URLSearchParams();
    params.set("name", newName);
    params.set("mode", mode);
    const fullUrl = `${url}?${params.toString()}`;
    const response = await this.context.requestPostWithCrumb(fullUrl, "");

    if (response.location) {
      return { newUrl: response.location };
    }

    return { newUrl: buildJobUrl(parentUrl, newName) };
  }
}
