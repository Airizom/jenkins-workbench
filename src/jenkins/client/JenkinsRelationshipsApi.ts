import type { JenkinsBuild, JenkinsJob } from "../types";
import { buildApiUrlFromItem } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";

const RELATIONSHIP_CAUSES = "causes[upstreamProject,upstreamUrl,upstreamBuild]";

/** Separate projections keep history scans free of changelogs, parameters, and artifacts. */
export class JenkinsRelationshipsApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getDownstreamProjects(
    jobUrl: string,
    limit = 201,
    beforeRequest?: () => void,
    signal?: AbortSignal
  ): Promise<JenkinsJob[]> {
    const response = await this.context.requestJson<{ downstreamProjects?: JenkinsJob[] }>(
      buildApiUrlFromItem(jobUrl, `downstreamProjects[name,url,_class]{0,${limit}}`),
      { beforeRequest, signal }
    );
    return Array.isArray(response.downstreamProjects) ? response.downstreamProjects : [];
  }

  async getRelationshipJobs(
    parentUrl: string,
    limit: number,
    beforeRequest?: () => void,
    signal?: AbortSignal
  ): Promise<JenkinsJob[]> {
    const response = await this.context.requestJson<{ jobs?: JenkinsJob[] }>(
      buildApiUrlFromItem(parentUrl, `jobs[name,url,_class]{0,${limit}}`),
      { beforeRequest, signal }
    );
    return Array.isArray(response.jobs) ? response.jobs : [];
  }

  async getRelationshipBuilds(
    jobUrl: string,
    offset: number,
    limit: number,
    beforeRequest?: () => void,
    signal?: AbortSignal
  ): Promise<JenkinsBuild[]> {
    const tree = `allBuilds[number,url,result,building,timestamp,actions[${RELATIONSHIP_CAUSES}]]{${offset},${offset + limit}}`;
    const response = await this.context.requestJson<{ allBuilds?: JenkinsBuild[] }>(
      buildApiUrlFromItem(jobUrl, tree),
      { beforeRequest, signal }
    );
    return Array.isArray(response.allBuilds) ? response.allBuilds : [];
  }
}
