import type { JenkinsClientContext } from "../../src/jenkins/client/JenkinsClientContext";

export function createJenkinsClientContext(
  overrides: Partial<JenkinsClientContext> = {}
): JenkinsClientContext {
  return {
    baseUrl: "https://jenkins.example.com/",
    requestJson: async <T>(): Promise<T> => {
      throw new Error("not implemented");
    },
    requestHeaders: async () => ({}),
    requestText: async () => "",
    requestTextWithHeaders: async () => ({ text: "", headers: {} }),
    requestBufferWithHeaders: async () => ({ data: new Uint8Array(), headers: {} }),
    requestStream: async () => {
      throw new Error("not implemented");
    },
    requestVoidWithCrumb: async () => undefined,
    requestPostWithCrumb: async () => ({}),
    requestPostWithCrumbRaw: async () => ({}),
    requestPostTextWithCrumbRaw: async () => "",
    ...overrides
  };
}
