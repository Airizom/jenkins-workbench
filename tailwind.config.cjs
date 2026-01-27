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
        input: {
          DEFAULT: "var(--input)",
          background: "var(--input-background)",
          foreground: "var(--input-foreground)",
          placeholder: "var(--input-placeholder)"
        },
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
          hover: "var(--primary-hover)"
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
          hover: "var(--secondary-hover)"
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
          foreground: "var(--card-foreground)",
          border: "var(--card-border)"
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)"
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
          border: "var(--destructive-border)"
        },
        link: {
          DEFAULT: "var(--link)",
          hover: "var(--link-hover)"
        },
        badge: {
          DEFAULT: "var(--badge)",
          foreground: "var(--badge-foreground)"
        },
        checkbox: {
          DEFAULT: "var(--checkbox)",
          foreground: "var(--checkbox-foreground)",
          border: "var(--checkbox-border)",
          checked: "var(--checkbox-checked)",
          checkedForeground: "var(--checkbox-checked-foreground)"
        },
        list: {
          active: "var(--list-active)",
          activeForeground: "var(--list-active-foreground)",
          hover: "var(--list-hover)",
          hoverForeground: "var(--list-hover-foreground)"
        },
        selection: {
          DEFAULT: "var(--selection)",
          foreground: "var(--selection-foreground)"
        },
        panelBorder: "var(--vscode-panel-border)",
        description: "var(--vscode-descriptionForeground)",
        focus: "var(--vscode-focusBorder)",
        editorWidget: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        header: "var(--header-bg)",
        toolbar: "var(--toolbar-bg)",
        success: {
          DEFAULT: "var(--success)",
          foreground: "var(--success-foreground)"
        },
        failure: {
          DEFAULT: "var(--failure)",
          foreground: "var(--failure-foreground)"
        },
        warning: {
          DEFAULT: "var(--warning)",
          foreground: "var(--warning-foreground)"
        },
        aborted: {
          DEFAULT: "var(--aborted)",
          foreground: "var(--aborted-foreground)"
        },
        inputWarningBorder: "var(--inputWarningBorder)",
        inputWarningBg: "var(--inputWarningBg)",
        inputWarningFg: "var(--inputWarningFg)",
        inputErrorBorder: "var(--inputErrorBorder)",
        inputErrorBg: "var(--inputErrorBg)",
        inputErrorFg: "var(--inputErrorFg)",
        inputInfoBorder: "var(--inputInfoBorder)",
        inputInfoBg: "var(--inputInfoBg)",
        inputInfoFg: "var(--inputInfoFg)"
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      fontFamily: {
        body: ["var(--vscode-font-family)"],
        mono: ["var(--vscode-editor-font-family)"]
      },
      fontSize: {
        vscode: "var(--vscode-font-size)",
        "vscode-editor": "var(--vscode-editor-font-size)"
      },
      boxShadow: {
        widget: "var(--vscode-widget-shadow, 0 2px 8px rgba(0, 0, 0, 0.15))"
      }
    }
  }
};
