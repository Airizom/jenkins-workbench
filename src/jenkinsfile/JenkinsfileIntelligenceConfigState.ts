import type { JenkinsfileIntelligenceConfig } from "./JenkinsfileIntelligenceTypes";

export class JenkinsfileIntelligenceConfigState {
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
