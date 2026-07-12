const JENKINS_INVALID_JOB_NAME_CHARACTERS = "?*/\\%!@#$^&|<>[]:;";

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

export function getJobNameValidationError(name: string): string | undefined {
  if (!name || name.trim().length === 0) {
    return "Name cannot be empty.";
  }

  const trimmed = name.trim();
  if (trimmed !== name) {
    return "Name cannot have leading or trailing whitespace.";
  }

  if (containsJenkinsInvalidNameCharacter(name)) {
    return `Name contains invalid characters (${JENKINS_INVALID_JOB_NAME_CHARACTERS} are not allowed).`;
  }

  if (containsControlCharacters(name)) {
    return "Name cannot contain control characters.";
  }

  if (name === "." || name === "..") {
    return 'Name cannot be "." or "..".';
  }

  return undefined;
}
