export type OpenExternalHandler = (url: string) => void;
export type OpenNodeDetailsHandler = (nodeUrl: string, label?: string) => void;
export type OpenBuildDetailsHandler = (buildUrl: string, label?: string) => void;
export type RetryExecutorsHandler = (nodeUrl: string) => void;
