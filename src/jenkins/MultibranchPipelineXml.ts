import { randomUUID } from "node:crypto";
import { escapeXml } from "../shared/xml";
import type { JenkinsMultibranchCreateOptions } from "./types";

/**
 * Builds a minimal Multibranch Pipeline config.xml with one Git branch source that discovers
 * branches and reads the Pipeline from `scriptPath`. Jenkins fills in the remaining defaults.
 */
export function buildMultibranchPipelineXml(
  options: JenkinsMultibranchCreateOptions,
  createSourceId: () => string = randomUUID
): string {
  const repositoryUrl = options.repositoryUrl.trim();
  if (!repositoryUrl) {
    throw new Error("Enter a Git repository URL.");
  }
  const scriptPath = options.scriptPath.trim();
  if (!scriptPath) {
    throw new Error("Enter a script path.");
  }
  const credentialsId = options.credentialsId?.trim();
  const credentialsLine = credentialsId
    ? `\n            <credentialsId>${escapeXml(credentialsId)}</credentialsId>`
    : "";

  return `<?xml version='1.1' encoding='UTF-8'?>
<org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject>
  <sources class="jenkins.branch.MultiBranchProject$BranchSourceList">
    <data>
      <jenkins.branch.BranchSource>
        <source class="jenkins.plugins.git.GitSCMSource">
          <id>${escapeXml(createSourceId())}</id>
          <remote>${escapeXml(repositoryUrl)}</remote>${credentialsLine}
          <traits>
            <jenkins.plugins.git.traits.BranchDiscoveryTrait/>
          </traits>
        </source>
      </jenkins.branch.BranchSource>
    </data>
  </sources>
  <factory class="org.jenkinsci.plugins.workflow.multibranch.WorkflowBranchProjectFactory">
    <scriptPath>${escapeXml(scriptPath)}</scriptPath>
  </factory>
</org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject>
`;
}
