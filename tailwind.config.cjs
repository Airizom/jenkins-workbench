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
          foreground: "var(--muted-foreground)",
          soft: "var(--muted-soft)",
          strong: "var(--muted-strong)"
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
          soft: "var(--accent-soft)"
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
          foreground: "var(--success-foreground)",
          soft: "var(--success-soft)",
          border: "var(--success-border)"
        },
        failure: {
          DEFAULT: "var(--failure)",
          foreground: "var(--failure-foreground)",
          soft: "var(--failure-soft)",
          surface: "var(--failure-surface)",
          border: "var(--failure-border)",
          "border-subtle": "var(--failure-border-subtle)"
        },
        warning: {
          DEFAULT: "var(--warning)",
          foreground: "var(--warning-foreground)",
          soft: "var(--warning-soft)",
          surface: "var(--warning-surface)",
          badge: "var(--warning-badge)",
          border: "var(--warning-border)"
        },
        aborted: {
          DEFAULT: "var(--aborted)",
          foreground: "var(--aborted-foreground)",
          soft: "var(--aborted-soft)",
          border: "var(--aborted-border)"
        },
        mutedBorder: "var(--muted-foreground-border)",
        progress: "var(--progress)",
        terminal: {
          DEFAULT: "var(--terminal-bg)",
          foreground: "var(--terminal-foreground)"
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
      },
      // Needed so Tailwind can generate state variants like:
      // `data-[state=open]:animate-accordion-down` and `data-[state=open]:animate-in`.
      animation: {
        in: "enter 200ms ease-out both",
        out: "exit 200ms ease-out both",
        "accordion-down": "accordion-down 200ms ease-out",
        "accordion-up": "accordion-up 200ms ease-out",
        "collapsible-down": "collapsible-down 200ms ease-out",
        "collapsible-up": "collapsible-up 200ms ease-out"
      },
      keyframes: {
        // shadcn-style enter/exit animations via CSS vars so fade+zoom+slide can compose.
        enter: {
          from: {
            opacity: "var(--tw-enter-opacity, 1)",
            transform:
              "translate3d(var(--tw-enter-translate-x, 0), var(--tw-enter-translate-y, 0), 0) scale3d(var(--tw-enter-scale, 1), var(--tw-enter-scale, 1), 1)"
          },
          to: {
            opacity: "1",
            transform: "translate3d(0, 0, 0) scale3d(1, 1, 1)"
          }
        },
        exit: {
          from: {
            opacity: "1",
            transform: "translate3d(0, 0, 0) scale3d(1, 1, 1)"
          },
          to: {
            opacity: "var(--tw-exit-opacity, 1)",
            transform:
              "translate3d(var(--tw-exit-translate-x, 0), var(--tw-exit-translate-y, 0), 0) scale3d(var(--tw-exit-scale, 1), var(--tw-exit-scale, 1), 1)"
          }
        }
      }
    }
  },
  plugins: [
    // Minimal subset of `tailwindcss-animate` (kept local to avoid adding deps).
    // Provides utilities like `fade-in-0` that we use with Radix `data-[state=...]` variants.
    ({ addUtilities }) => {
      addUtilities({
        ".fade-in-0": { "--tw-enter-opacity": "0" },
        ".fade-out-0": { "--tw-exit-opacity": "0" },

        ".zoom-in-95": { "--tw-enter-scale": ".95" },
        ".zoom-out-95": { "--tw-exit-scale": ".95" },

        ".slide-in-from-top-1": { "--tw-enter-translate-y": "calc(var(--spacing) * -1)" },
        ".slide-in-from-bottom-1": { "--tw-enter-translate-y": "calc(var(--spacing) * 1)" },
        ".slide-in-from-left-1": { "--tw-enter-translate-x": "calc(var(--spacing) * -1)" },
        ".slide-in-from-right-1": { "--tw-enter-translate-x": "calc(var(--spacing) * 1)" },

        ".slide-out-to-top-1": { "--tw-exit-translate-y": "calc(var(--spacing) * -1)" },
        ".slide-out-to-bottom-1": { "--tw-exit-translate-y": "calc(var(--spacing) * 1)" },
        ".slide-out-to-left-1": { "--tw-exit-translate-x": "calc(var(--spacing) * -1)" },
        ".slide-out-to-right-1": { "--tw-exit-translate-x": "calc(var(--spacing) * 1)" }
      });
    }
  ]
};
