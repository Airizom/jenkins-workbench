import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsFlowNodeLog } from "../../jenkins/types";
import type { BuildDetailsConsoleBackend } from "./BuildDetailsBackend";
import { escapeHtml, htmlToText } from "./PipelineNodeLogContent";
import type {
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel
} from "./shared/BuildDetailsContracts";

export interface PipelineNodeLogFetchResult {
  log?: PipelineNodeLogViewModel;
  appendHtml?: string;
  cachedLog?: PipelineNodeLogViewModel;
}

export interface PipelineNodeLogFetcherOptions {
  backend: BuildDetailsConsoleBackend;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
}

export class PipelineNodeLogFetcher {
  private progressiveSupported: boolean | undefined;
  private progressiveOffset = 0;
  private annotator: string | undefined;

  constructor(private readonly options: PipelineNodeLogFetcherOptions) {}

  reset(): void {
    this.progressiveSupported = undefined;
    this.progressiveOffset = 0;
    this.annotator = undefined;
  }

  async fetch(
    target: PipelineLogTargetViewModel,
    initial: boolean,
    cached: PipelineNodeLogViewModel | undefined
  ): Promise<PipelineNodeLogFetchResult> {
    const nodeId = target.nodeId;
    if (!nodeId) {
      return {
        log: {
          target,
          text: "",
          truncated: false,
          loading: false,
          polling: false,
          error: "This pipeline node does not expose a Jenkins flow-node log."
        }
      };
    }

    if (this.progressiveSupported !== false) {
      const progressive = await this.tryFetchProgressive(target, nodeId, initial, cached);
      if (progressive) {
        return progressive;
      }
    }

    const snapshot = await this.options.backend.getFlowNodeLog(
      this.options.environment,
      this.options.buildUrl,
      nodeId
    );
    return { log: this.buildSnapshotLog(target, snapshot) };
  }

  private async tryFetchProgressive(
    target: PipelineLogTargetViewModel,
    nodeId: string,
    initial: boolean,
    cached: PipelineNodeLogViewModel | undefined
  ): Promise<PipelineNodeLogFetchResult | undefined> {
    try {
      const chunk = await this.options.backend.getFlowNodeLogHtmlProgressive(
        this.options.environment,
        this.options.buildUrl,
        nodeId,
        this.progressiveOffset,
        this.annotator
      );
      if (!chunk?.textSizeKnown) {
        this.progressiveSupported = false;
        return undefined;
      }
      this.progressiveSupported = true;
      this.progressiveOffset = chunk.textSize;
      if (chunk.annotator) {
        this.annotator = chunk.annotator;
      }
      if (!initial && cached && chunk.html) {
        return {
          appendHtml: chunk.html,
          cachedLog: {
            ...cached,
            html: undefined,
            text: cached.text + htmlToText(chunk.html),
            loading: false,
            polling: chunk.moreData,
            error: undefined
          }
        };
      }
      if (!initial && cached && !chunk.html) {
        return {
          log: {
            ...cached,
            target,
            loading: false,
            polling: chunk.moreData,
            error: undefined
          }
        };
      }
      return {
        log: {
          target,
          html: chunk.html,
          text: htmlToText(chunk.html),
          truncated: this.progressiveOffset > 0 && initial === false,
          loading: false,
          polling: chunk.moreData
        }
      };
    } catch {
      this.progressiveSupported = false;
      return undefined;
    }
  }

  private buildSnapshotLog(
    target: PipelineLogTargetViewModel,
    snapshot: JenkinsFlowNodeLog | undefined
  ): PipelineNodeLogViewModel {
    if (!snapshot) {
      return {
        target,
        text: "",
        truncated: false,
        loading: false,
        polling: false,
        error: "This Jenkins instance did not return a log for the selected pipeline node."
      };
    }
    const text = snapshot.text ?? "";
    return {
      target,
      html: escapeHtml(text),
      text,
      truncated: Boolean(snapshot.hasMore),
      loading: false,
      polling: Boolean(snapshot.hasMore) || isFlowNodeLogActive(snapshot.nodeStatus),
      consoleUrl: snapshot.consoleUrl
    };
  }
}

function isFlowNodeLogActive(status: string | undefined): boolean {
  const normalized = status?.trim().toUpperCase();
  return (
    normalized === "IN_PROGRESS" ||
    normalized === "PAUSED_PENDING_INPUT" ||
    normalized === "QUEUED" ||
    normalized === "NOT_STARTED" ||
    normalized === "RUNNING"
  );
}
