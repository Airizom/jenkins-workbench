import { expect, it } from "vitest";
import { JenkinsConsoleNoteFilter } from "../src/jenkins/JenkinsConsoleNotes";
import { ConsoleLineWriter } from "../src/tasks/JenkinsTaskConsoleFollower";
const note = "\u001b[8mha:////serialized-note==\u001b[0m";
it("removes notes at every possible streaming boundary and retains ANSI colors", () => {
  const input = `before${note}\u001b[31mafter\u001b[0m`;
  for (let i = 0; i <= input.length; i++) {
    const filter = new JenkinsConsoleNoteFilter();
    expect(filter.append(input.slice(0, i)) + filter.append(input.slice(i)) + filter.finish()).toBe(
      "before\u001b[31mafter\u001b[0m"
    );
  }
});
it("drops truncated notes but preserves ordinary partial escape sequences", () => {
  const filter = new JenkinsConsoleNoteFilter();
  expect(filter.append("text\u001b[8mha:payload") + filter.finish()).toBe("text");
  expect(filter.append("text\u001b[") + filter.finish()).toBe("text\u001b[");
});
it("streams clean task output across split notes and CRLF boundaries", () => {
  const output: string[] = [];
  const writer = new ConsoleLineWriter((text) => output.push(text));
  for (const char of `hello${note}\r\nworld\r`) writer.append(char);
  writer.flush();
  expect(output.join("")).toBe("hello\nworld\n");
});
