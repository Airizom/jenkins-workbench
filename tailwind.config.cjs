module.exports = {
  content: [
    "./src/panels/buildDetails/webview/**/*.{ts,tsx}",
    "./src/panels/buildDetails/BuildDetailsRenderer.ts",
    "./src/panels/nodeDetails/webview/**/*.{ts,tsx}",
    "./src/panels/nodeDetails/NodeDetailsRenderer.ts",
    "./src/panels/shared/webview/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)"
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)"
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)"
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)"
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)"
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)"
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)"
        },
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
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      fontFamily: {
        body: ["var(--vscode-font-family)"],
        mono: ["var(--vscode-editor-font-family)"]
      }
    }
  }
};
