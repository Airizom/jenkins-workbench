import type { JenkinsJob, JenkinsJobKind } from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import { toBuildActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";
import type { JenkinsJobInfo, JobParameter } from "./JenkinsDataTypes";
import { mapJobParameter } from "./JenkinsParameterMapping";

export class JenkinsJobDataOperations {
  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getJobsForEnvironment(environment: JenkinsEnvironmentRef): Promise<JenkinsJobInfo[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "jobs");
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        const jobs = await client.getRootJobs();
        return this.mapJobs(client, jobs);
      },
      this.context.getCacheTtlMs()
    );
  }

  async getJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<JenkinsJob> {
    const client = await this.context.getClient(environment);
    return client.getJob(jobUrl);
  }

  async getJobsForFolder(
    environment: JenkinsEnvironmentRef,
    folderUrl: string
  ): Promise<JenkinsJobInfo[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "folder", folderUrl);
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        const jobs = await client.getFolderJobs(folderUrl);
        return this.mapJobs(client, jobs);
      },
      this.context.getCacheTtlMs()
    );
  }

  async getJobConfigXml(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<string> {
    const client = await this.context.getClient(environment);
    try {
      return await client.getJobConfigXml(jobUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async updateJobConfigXml(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    xml: string
  ): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.updateJobConfigXml(jobUrl, xml);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getJobParameters(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<JobParameter[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "parameters", jobUrl);
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        try {
          const parameters = await client.getJobParameters(jobUrl);
          return parameters.map((parameter) => mapJobParameter(parameter));
        } catch (error) {
          throw toBuildActionError(error);
        }
      },
      this.context.getCacheTtlMs()
    );
  }

  private mapJobs(
    client: { classifyJob(job: JenkinsJob): JenkinsJobKind },
    jobs: JenkinsJob[]
  ): JenkinsJobInfo[] {
    return jobs.map((job) => ({
      name: job.name,
      url: job.url,
      color: job.color,
      kind: client.classifyJob(job)
    }));
  }
}
