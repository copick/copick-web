/**
 * Validation utilities for copick entity names.
 * Mirrors copick-shared-ui/util/validation.py
 */

// Invalid characters pattern from copick.util.escape
// Invalid: <>:"/\|?* (Windows), control chars, spaces, and underscores
const INVALID_CHARS_PATTERN = /[<>:"/\\|?*\x00-\x1F\x7F\s_]/g;

export interface ValidationResult {
  isValid: boolean;
  sanitized: string;
  errorMessage: string;
}

/**
 * Validate a string for use as copick object name, user_id or session_id.
 *
 * @param inputStr - The input string to validate
 * @returns Validation result with isValid flag, sanitized version, and error message
 */
export function validateCopickName(inputStr: string): ValidationResult {
  if (!inputStr) {
    return { isValid: false, sanitized: "", errorMessage: "Name cannot be empty" };
  }

  // Check if string contains invalid characters
  const hasInvalid = INVALID_CHARS_PATTERN.test(inputStr);

  // Reset regex lastIndex (global regex)
  INVALID_CHARS_PATTERN.lastIndex = 0;

  // Create sanitized version
  let sanitized = inputStr.replace(INVALID_CHARS_PATTERN, "-");
  // Reset again after replace
  INVALID_CHARS_PATTERN.lastIndex = 0;
  // Trim leading/trailing dashes
  sanitized = sanitized.replace(/^-+|-+$/g, "");

  if (sanitized === "") {
    return { isValid: false, sanitized: "", errorMessage: "Name cannot consist only of invalid characters" };
  }

  if (hasInvalid) {
    // Find invalid characters for error message
    INVALID_CHARS_PATTERN.lastIndex = 0;
    const invalidFound = new Set(inputStr.match(INVALID_CHARS_PATTERN) || []);
    const invalidList = Array.from(invalidFound)
      .map((char) => (char === " " ? "'space'" : char === "_" ? "'underscore'" : `'${char}'`))
      .sort()
      .join(", ");
    return { isValid: false, sanitized, errorMessage: `Invalid characters: ${invalidList}` };
  }

  return { isValid: true, sanitized: inputStr, errorMessage: "" };
}

/**
 * Generate an auto-incremented session ID in the format 'manual-X'.
 *
 * @param existingSessionIds - List of existing session IDs to check against
 * @returns New unique session ID
 */
export function generateSessionId(existingSessionIds: string[]): string {
  const existing = new Set(existingSessionIds.map((s) => s.toLowerCase()));
  let counter = 1;
  while (true) {
    const candidate = `manual-${counter}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
    counter++;
  }
}
