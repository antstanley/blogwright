/** Shared validation for literal, segment-bounded path filters. */
export function normalizePathFilter(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('Path must be a string.');
  const path = value.trim();
  if (path === '') return undefined;
  // Reject ASCII control characters without embedding them in a regular expression.
  const hasControlCharacter = Array.from(path).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\s?#\\]/.test(path) ||
    hasControlCharacter
  ) {
    throw new Error('Enter a path starting with /, without a query string, fragment, or spaces.');
  }
  return path.replace(/\/+$/, '') || '/';
}

/** User-facing validation shares the exact rules used by query preparation. */
export function pathProblem(value: string): string | undefined {
  try {
    normalizePathFilter(value);
    return undefined;
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
}
