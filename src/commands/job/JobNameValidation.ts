export type JobNameValidationError =
  | "empty"
  | "whitespace"
  | "invalid_chars"
  | "control_chars"
  | "reserved_name";

function containsControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f) {
      return true;
    }
  }
  return false;
}

export function validateJobName(name: string): JobNameValidationError | undefined {
  if (!name || name.trim().length === 0) {
    return "empty";
  }

  const trimmed = name.trim();
  if (trimmed !== name) {
    return "whitespace";
  }

  const invalidChars = /[\\/<>:"|?*]/;
  if (invalidChars.test(name)) {
    return "invalid_chars";
  }

  if (containsControlCharacters(name)) {
    return "control_chars";
  }

  if (name === "." || name === "..") {
    return "reserved_name";
  }

  return undefined;
}

export function formatJobNameValidationError(error: JobNameValidationError): string {
  switch (error) {
    case "empty":
      return "Name cannot be empty.";
    case "whitespace":
      return "Name cannot have leading or trailing whitespace.";
    case "invalid_chars":
      return 'Name contains invalid characters (\\/<>:"|?* are not allowed).';
    case "control_chars":
      return "Name cannot contain control characters.";
    case "reserved_name":
      return 'Name cannot be "." or "..".';
  }
}

export function getJobNameValidationError(name: string): string | undefined {
  const error = validateJobName(name);
  return error ? formatJobNameValidationError(error) : undefined;
}
