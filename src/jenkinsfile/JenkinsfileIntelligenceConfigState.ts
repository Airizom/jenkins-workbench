import type { JenkinsfileIntelligenceConfig } from "./JenkinsfileIntelligenceTypes";

interface JenkinsfileIntelligenceConfigRuntimeSurface {
  updateConfig(config: JenkinsfileIntelligenceConfig): void;
}

export class JenkinsfileIntelligenceConfigState
  implements JenkinsfileIntelligenceConfigRuntimeSurface
{
  private config: JenkinsfileIntelligenceConfig;

  constructor(config: JenkinsfileIntelligenceConfig) {
    this.config = config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  updateConfig(config: JenkinsfileIntelligenceConfig): void {
    this.config = config;
  }
}
