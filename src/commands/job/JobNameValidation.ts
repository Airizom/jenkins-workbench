export type JobNameValidationError =
  | "empty"
  | "whitespace"
  | "invalid_chars"
  | "control_chars"
  | "reserved_name";

export const JENKINS_INVALID_JOB_NAME_CHARACTERS = "?*/\\%!@#$^&|<>[]:;";

function containsControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f) {
      return true;
    }
  }
  return false;
}

function containsJenkinsInvalidNameCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (JENKINS_INVALID_JOB_NAME_CHARACTERS.includes(value[i])) {
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

  if (containsJenkinsInvalidNameCharacter(name)) {
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
      return `Name contains invalid characters (${JENKINS_INVALID_JOB_NAME_CHARACTERS} are not allowed).`;
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
