import type { JenkinsAuthConfig } from "../../jenkins/types";
import type { BrowserSsoAuthenticator } from "../../services/BrowserSsoAuthenticationService";
import {
  type EnvironmentAuthMode,
  promptBrowserSsoLoginUrl,
  promptHeadersJson,
  promptRequiredInput
} from "./EnvironmentPrompts";

type AuthConfigPromptOptions = {
  /** Prefills the basic-auth username. */
  username?: string;
  /** Prefills the Browser SSO sign-in URL. */
  loginUrl?: string;
  reason: "add" | "manual";
  currentAuthConfig?: JenkinsAuthConfig;
};

export async function promptAuthConfig(
  authMode: EnvironmentAuthMode,
  environmentUrl: string,
  browserSsoAuthenticator: BrowserSsoAuthenticator,
  options: AuthConfigPromptOptions = { reason: "add" }
): Promise<JenkinsAuthConfig | undefined> {
  switch (authMode) {
    case "none":
      return { type: "none" };
    case "basic": {
      const authUsername = await promptRequiredInput("Username", undefined, false, {
        value: options.username
      });
      if (!authUsername) {
        return undefined;
      }
      const authToken = await promptRequiredInput("API Token", undefined, true);
      if (!authToken) {
        return undefined;
      }
      return {
        type: "basic",
        username: authUsername,
        token: authToken
      };
    }
    case "bearer": {
      const token = await promptRequiredInput("Bearer Token", undefined, true);
      if (!token) {
        return undefined;
      }
      return {
        type: "bearer",
        token
      };
    }
    case "cookie": {
      const cookie = await promptRequiredInput("Cookie Header Value", undefined, true);
      if (!cookie) {
        return undefined;
      }
      return {
        type: "cookie",
        cookie
      };
    }
    case "headers": {
      const headers = await promptHeadersJson();
      if (!headers) {
        return undefined;
      }
      return {
        type: "headers",
        headers
      };
    }
    case "sso": {
      const loginUrl = await promptBrowserSsoLoginUrl(environmentUrl, options.loginUrl);
      if (!loginUrl) {
        return undefined;
      }
      return browserSsoAuthenticator.authenticate({
        environmentUrl,
        loginUrl,
        ...(options.currentAuthConfig ? { currentAuthConfig: options.currentAuthConfig } : {}),
        reason: options.reason
      });
    }
    default:
      return undefined;
  }
}
