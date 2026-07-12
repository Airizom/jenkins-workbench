export interface BuildParameterPayloadField {
  name: string;
  value: string;
}

export interface BuildParameterPayloadFile {
  name: string;
  filePath: string;
  fileName: string;
}

export interface BuildParameterPayload {
  fields: BuildParameterPayloadField[];
  files: BuildParameterPayloadFile[];
}

export interface BuildWithParametersRequest {
  body: string | Uint8Array;
  headers: Record<string, string>;
}

export interface PreparedBuildParametersRequest {
  hasParameters: boolean;
  request?: BuildWithParametersRequest;
}

export interface BuildParameterRequestPreparer {
  prepareBuildParameters(
    params: URLSearchParams | BuildParameterPayload | undefined
  ): Promise<PreparedBuildParametersRequest>;
}
