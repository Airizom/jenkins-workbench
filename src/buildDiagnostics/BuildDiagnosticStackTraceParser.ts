import {
  type DiagnosticDraft,
  fileUrlToPath,
  type StackState,
  stackDraft
} from "./BuildDiagnosticParserSupport";

/** Lines that may legitimately appear between frames of an already started trace. */
const JVM_TRACE_CONTINUATION = /^(?:at\s+\S|\.\.\.\s*\d+\s+more\b|(?:Caused by|Suppressed):)/;
const JAVASCRIPT_TRACE_CONTINUATION = /^at\s+\S/;
const DOTNET_TRACE_CONTINUATION = /^(?:at\s+\S|--->\s|---\s+End of\b)/;
const PYTHON_TRACE_FRAME = /^File\s+"/;
/** A Python frame is followed by at most a source line and a caret marker line. */
const MAX_PYTHON_TRACE_TAIL_LINES = 2;

/**
 * Tracks the active JVM, JavaScript, Python, and .NET stack traces so frames
 * seen on consecutive lines share one stack group.
 */
export class BuildDiagnosticStackTraceParser {
  private stackCounter = 0;
  private jvmStack: StackState | undefined;
  private javascriptStack: StackState | undefined;
  private pythonStack: StackState | undefined;
  private pythonTailLines = 0;
  private dotnetStack: StackState | undefined;

  parseJvmStack(text: string): DiagnosticDraft | undefined {
    if (
      /^(?:Exception in thread\s+"[^"]+"\s+)?(?:Caused by:\s*)?[\w.$]+(?:Exception|Error)(?::\s*.*)?$/.test(
        text.trim()
      )
    ) {
      this.jvmStack = this.newStack(text.trim());
      return undefined;
    }
    const frame = text.match(/^\s*at\s+[^()]+\(([^():]+\.java):(\d+)\)\s*$/);
    if (!frame) {
      return undefined;
    }
    this.jvmStack ??= this.newStack("Java stack frame");
    const stack = this.jvmStack;
    return stackDraft("jvm-stack", "java", frame[1], frame[2], undefined, stack, 210);
  }

  parseJavaScriptStack(text: string): DiagnosticDraft | undefined {
    if (
      /^(?:[A-Za-z]*Error|TypeError|RangeError|ReferenceError|SyntaxError):(?:\s*.*)?$/.test(
        text.trim()
      )
    ) {
      this.javascriptStack = this.newStack(text.trim());
      return undefined;
    }
    const frame = text.match(
      /^\s*at\s+(?:(?:async\s+)?[^()]+\s+\()?((?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/|\.{0,2}[\\/])?[^()\s]+?\.(?:[cm]?js|jsx|ts|tsx)):(\d+):(\d+)\)?\s*$/i
    );
    if (!frame) {
      return undefined;
    }
    this.javascriptStack ??= this.newStack("JavaScript stack frame");
    const stack = this.javascriptStack;
    return stackDraft(
      "javascript-stack",
      "javascript",
      fileUrlToPath(frame[1]),
      frame[2],
      frame[3],
      stack,
      220
    );
  }

  parsePythonStack(text: string): DiagnosticDraft | undefined {
    if (/^Traceback \(most recent call last\):\s*$/.test(text.trim())) {
      this.pythonStack = this.newStack("Python traceback");
      this.pythonTailLines = 0;
      return undefined;
    }
    const frame = text.match(/^\s*File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?\s*$/);
    if (!frame) {
      return undefined;
    }
    this.pythonStack ??= this.newStack("Python traceback");
    const stack = this.pythonStack;
    const message = frame[3] ? `${stack.message}: ${frame[3].trim()}` : stack.message;
    return {
      ...stackDraft("python-traceback", "python", frame[1], frame[2], undefined, stack, 230),
      message
    };
  }

  parseDotnetStack(text: string): DiagnosticDraft | undefined {
    if (
      /^(?:Unhandled exception\.\s+)?(?:--->\s+)?System\.[\w.]+Exception(?::\s*.*)?$/.test(
        text.trim()
      )
    ) {
      this.dotnetStack = this.newStack(text.trim());
      return undefined;
    }
    const frame = text.match(/^\s*at\s+.+?\s+in\s+(.+?):line\s+(\d+)\s*$/i);
    if (!frame) {
      return undefined;
    }
    this.dotnetStack ??= this.newStack(".NET stack frame");
    const stack = this.dotnetStack;
    return stackDraft("dotnet-stack", "dotnet", frame[1], frame[2], undefined, stack, 240);
  }

  /**
   * Ends any active trace once a line arrives that cannot belong to it, so a
   * later stray frame starts its own group instead of joining an old one.
   * Traces that have not emitted a frame yet are kept because exception
   * messages may span several lines before the first frame.
   */
  endTerminatedStacks(text: string): void {
    const trimmed = text.trim();
    if (this.jvmStack && this.jvmStack.nextFrame > 0 && !JVM_TRACE_CONTINUATION.test(trimmed)) {
      this.jvmStack = undefined;
    }
    if (
      this.javascriptStack &&
      this.javascriptStack.nextFrame > 0 &&
      !JAVASCRIPT_TRACE_CONTINUATION.test(trimmed)
    ) {
      this.javascriptStack = undefined;
    }
    if (
      this.dotnetStack &&
      this.dotnetStack.nextFrame > 0 &&
      !DOTNET_TRACE_CONTINUATION.test(trimmed)
    ) {
      this.dotnetStack = undefined;
    }
    this.endTerminatedPythonStack(trimmed);
  }

  private endTerminatedPythonStack(trimmed: string): void {
    if (!this.pythonStack) {
      return;
    }
    if (PYTHON_TRACE_FRAME.test(trimmed)) {
      this.pythonTailLines = 0;
      return;
    }
    this.pythonTailLines += 1;
    if (this.pythonStack.nextFrame > 0 && this.pythonTailLines > MAX_PYTHON_TRACE_TAIL_LINES) {
      this.pythonStack = undefined;
    }
  }

  private newStack(message: string): StackState {
    this.stackCounter += 1;
    return { id: `stack-${this.stackCounter}`, message, nextFrame: 0 };
  }
}
