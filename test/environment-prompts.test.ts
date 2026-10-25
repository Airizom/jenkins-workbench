import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

type InputBoxOptions = {
  value?: string;
  placeHolder?: string;
  validateInput?: (input: string) => string | undefined;
};

let inputBoxOptions: InputBoxOptions | undefined;
let inputBoxResponse: ((options: InputBoxOptions) => string | undefined) | undefined;
let quickPickItems: Array<{ label: string; description?: string }> = [];
let quickPickIndex: number | undefined;
let warningResponse: string | undefined;
const warnings: Array<{ message: string; options: unknown; action: string }> = [];

vi.doMock("vscode", () => ({
  window: {
    showInputBox: async (options: InputBoxOptions) => {
      inputBoxOptions = options;
      return inputBoxResponse ? inputBoxResponse(options) : options.value;
    },
    showWarningMessage: async (message: string, options: unknown, action: string) => {
      warnings.push({ message, options, action });
      return warningResponse;
    },
    showQuickPick: async (items: Array<{ label: string; description?: string }>) => {
      quickPickItems = items;
      return quickPickIndex === undefined ? undefined : items[quickPickIndex];
    }
  }
}));

const {
  promptAuthMode,
  promptBrowserSsoLoginUrl,
  promptEditField,
  promptEnvironmentName,
  promptRequiredInput,
  promptTlsCertificateValidation
} = await import("../src/commands/environment/EnvironmentPrompts");

beforeEach(() => {
  inputBoxOptions = undefined;
  inputBoxResponse = undefined;
  quickPickItems = [];
  quickPickIndex = undefined;
  warningResponse = undefined;
  warnings.length = 0;
});

describe("promptBrowserSsoLoginUrl", () => {
  it.each([
    ["https://example.test/jenkins", "https://example.test/jenkins/__sso/login"],
    ["https://example.test", "https://example.test/__sso/login"],
    ["https://example.test/jenkins/", "https://example.test/jenkins/__sso/login"]
  ])("defaults %s to %s", async (environmentUrl, expectedLoginUrl) => {
    const loginUrl = await promptBrowserSsoLoginUrl(environmentUrl);

    assert.equal(inputBoxOptions?.value, expectedLoginUrl);
    assert.equal(loginUrl, expectedLoginUrl);
  });

  it("prefills a stored login URL instead of the default", async () => {
    const loginUrl = await promptBrowserSsoLoginUrl(
      "https://example.test/",
      "https://login.example/custom"
    );

    assert.equal(inputBoxOptions?.value, "https://login.example/custom");
    assert.equal(inputBoxOptions?.placeHolder, "https://example.test/__sso/login");
    assert.equal(loginUrl, "https://login.example/custom");
  });
});

describe("promptRequiredInput", () => {
  it("prefills the given value", async () => {
    const value = await promptRequiredInput("Jenkins URL", undefined, false, {
      value: "https://jenkins.example/"
    });

    assert.equal(inputBoxOptions?.value, "https://jenkins.example/");
    assert.equal(value, "https://jenkins.example/");
  });
});

describe("promptEnvironmentName", () => {
  it("prefills the current name and uses the host label as placeholder", async () => {
    inputBoxResponse = () => "  Production  ";

    const name = await promptEnvironmentName("https://jenkins.example/ci/", "Old");

    assert.equal(inputBoxOptions?.value, "Old");
    assert.equal(inputBoxOptions?.placeHolder, "jenkins.example/ci");
    assert.equal(name, "Production");
  });

  it("returns an empty string when cleared and undefined when dismissed", async () => {
    inputBoxResponse = () => "   ";
    assert.equal(await promptEnvironmentName("https://jenkins.example/"), "");

    inputBoxResponse = () => undefined;
    assert.equal(await promptEnvironmentName("https://jenkins.example/"), undefined);
  });

  it("rejects names longer than 80 characters", async () => {
    await promptEnvironmentName("https://jenkins.example/");
    const validate = inputBoxOptions?.validateInput;

    assert.equal(validate?.("a".repeat(80)), undefined);
    assert.equal(validate?.(` ${"a".repeat(80)} `), undefined);
    assert.match(validate?.("a".repeat(81)) ?? "", /80 characters/);
    assert.equal(validate?.(""), undefined);
  });
});

describe("promptAuthMode", () => {
  it("lists the current method first and marks it", async () => {
    quickPickIndex = 0;

    const mode = await promptAuthMode("sso");

    assert.equal(mode, "sso");
    assert.equal(quickPickItems[0].label, "Browser SSO (current)");
    assert.equal(quickPickItems.length, 6);
    assert.equal(quickPickItems.filter((item) => item.label.includes("(current)")).length, 1);
  });

  it("keeps the default order without a current method", async () => {
    await promptAuthMode();

    assert.deepEqual(
      quickPickItems.map((item) => item.label),
      ["None", "Basic", "Bearer token", "Cookie header", "Custom headers (JSON)", "Browser SSO"]
    );
  });
});

describe("promptEditField", () => {
  it("describes the current name, URL, and auth type", async () => {
    quickPickIndex = 1;

    const field = await promptEditField(
      { name: "Production", displayUrl: "https://jenkins.example/" },
      "basic"
    );

    assert.equal(field, "url");
    assert.deepEqual(
      quickPickItems.map((item) => [item.label, item.description]),
      [
        ["Rename", "Production"],
        ["Change URL", "https://jenkins.example/"],
        ["Update Credentials", "Basic"],
        ["TLS Certificate Validation", "Verify certificates"]
      ]
    );
  });

  it("shows Not set for a missing name and returns undefined when dismissed", async () => {
    const field = await promptEditField({ displayUrl: "https://jenkins.example/" });

    assert.equal(field, undefined);
    assert.equal(quickPickItems[0].description, "Not set");
  });
});

describe("TLS certificate validation prompts", () => {
  it("defaults to certificate verification without a warning", async () => {
    quickPickIndex = 0;
    assert.equal(await promptTlsCertificateValidation(), false);
    assert.equal(quickPickItems[0].label, "Verify certificates (recommended)");
    assert.equal(warnings.length, 0);
  });

  it("requires explicit confirmation to enable insecure TLS", async () => {
    quickPickIndex = 1;
    assert.equal(await promptTlsCertificateValidation(false), undefined);
    assert.equal(warnings[0].action, "Allow Insecure TLS");
    assert.deepEqual(warnings[0].options, { modal: true });
    assert.match(warnings[0].message, /hostname checks/);
    assert.match(warnings[0].message, /intercept credentials/);
    warningResponse = "Allow Insecure TLS";
    assert.equal(await promptTlsCertificateValidation(false), true);
  });

  it("marks the current choice and does not reconfirm an unchanged setting", async () => {
    quickPickIndex = 1;
    assert.equal(await promptTlsCertificateValidation(true), true);
    assert.equal(quickPickItems[1].label, "Allow insecure TLS (current)");
    assert.equal(warnings.length, 0);
    quickPickIndex = 0;
    assert.equal(await promptTlsCertificateValidation(true), false);
    assert.equal(warnings.length, 0);
  });

  it("returns undefined when selection is dismissed", async () => {
    assert.equal(await promptTlsCertificateValidation(), undefined);
    assert.equal(warnings.length, 0);
  });

  it("only shows TLS editing for HTTPS and describes disabled verification", async () => {
    await promptEditField({ displayUrl: "https://jenkins.example/", allowInsecureTls: true });
    assert.equal(quickPickItems.at(-1)?.description, "TLS verification disabled");
    await promptEditField({ displayUrl: "http://jenkins.example/", allowInsecureTls: true });
    assert.equal(quickPickItems.length, 3);
  });
});
