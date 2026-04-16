export interface BuildParameterRedactionOptions {
  allowList: string[];
  denyList: string[];
  maskPatterns: string[];
  maskValue: string;
}

export interface BuildCompareConsoleOptions {
  maxBytes: number;
  maxLines: number;
}

export interface BuildCompareOptions {
  console: BuildCompareConsoleOptions;
  parameterRedaction: BuildParameterRedactionOptions;
}
