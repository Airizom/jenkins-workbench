module.exports = {
  content: [
    "./src/panels/buildDetails/webview/**/*.{ts,tsx}",
    "./src/panels/buildDetails/BuildDetailsRenderer.ts"
  ],
  theme: {
    extend: {
      colors: {
        foreground: "var(--vscode-editor-foreground)",
        background: "var(--vscode-editor-background)",
        panelBorder: "var(--vscode-panel-border)",
        description: "var(--vscode-descriptionForeground)",
        link: "var(--vscode-textLink-foreground)",
        focus: "var(--vscode-focusBorder)",
        editorWidget: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        success: "var(--vscode-testing-iconPassed, var(--vscode-editor-foreground))",
        failure: "var(--vscode-testing-iconFailed, var(--vscode-editor-foreground))",
        warning: "var(--vscode-testing-iconQueued, var(--vscode-editor-foreground))",
        aborted: "var(--vscode-testing-iconSkipped, var(--vscode-editor-foreground))",
        inputWarningBorder: "var(--vscode-inputValidation-warningBorder)",
        inputWarningBg: "var(--vscode-inputValidation-warningBackground)",
        inputWarningFg: "var(--vscode-inputValidation-warningForeground)",
        inputErrorBorder: "var(--vscode-inputValidation-errorBorder)",
        inputErrorBg: "var(--vscode-inputValidation-errorBackground)",
        inputErrorFg: "var(--vscode-inputValidation-errorForeground)"
      },
      fontFamily: {
        body: ["var(--vscode-font-family)"],
        mono: ["var(--vscode-editor-font-family)"]
      }
    }
  }
};
