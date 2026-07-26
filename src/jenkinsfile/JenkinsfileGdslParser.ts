import { scanContributorBlocks, scanMethodCalls } from "./gdsl/JenkinsfileGdslBlockScanner";
import { toStepDefinition } from "./gdsl/JenkinsfileGdslStepBuilder";
import type {
  JenkinsfileStepCatalog,
  JenkinsfileStepDefinition
} from "./JenkinsfileIntelligenceTypes";
import { createStepCatalog } from "./JenkinsfileStepCatalogUtils";

export function parseJenkinsfileGdsl(text: string): JenkinsfileStepCatalog {
  const steps: JenkinsfileStepDefinition[] = [];

  for (const block of scanContributorBlocks(text)) {
    for (const methodCall of scanMethodCalls(block.body)) {
      const step = toStepDefinition(methodCall.call, methodCall.requiresNodeContext);
      if (!step) {
        continue;
      }
      steps.push(step);
    }
  }

  return createStepCatalog(steps);
}
