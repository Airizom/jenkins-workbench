const NOTE_START = "\u001b[8mha:";
const NOTE_END = "\u001b[0m";

/** Removes Jenkins serialized console notes without changing ordinary ANSI output.
 * Keep this at the presentation boundary: Jenkins resume offsets count raw bytes.
 */
export class JenkinsConsoleNoteFilter {
  private pending = "";
  private inNote = false;

  append(text: string): string {
    let remaining = this.pending + text;
    this.pending = "";
    let output = "";
    while (remaining) {
      const marker = this.inNote ? NOTE_END : NOTE_START;
      const index = remaining.indexOf(marker);
      if (index >= 0) {
        if (!this.inNote) {
          output += remaining.slice(0, index);
        }
        remaining = remaining.slice(index + marker.length);
        this.inNote = !this.inNote;
        continue;
      }
      // Retain only a possible marker prefix, even for very large/split notes.
      let suffixLength = Math.min(marker.length - 1, remaining.length);
      while (suffixLength > 0 && !marker.startsWith(remaining.slice(-suffixLength))) {
        suffixLength -= 1;
      }
      this.pending = suffixLength ? remaining.slice(-suffixLength) : "";
      if (!this.inNote) {
        output += remaining.slice(0, remaining.length - suffixLength);
      }
      break;
    }
    return output;
  }

  finish(): string {
    const remainder = this.inNote ? "" : this.pending;
    this.pending = "";
    this.inNote = false;
    return remainder;
  }
}
