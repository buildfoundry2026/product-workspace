/**
 * Returns `path` only if it is a same-origin relative path, otherwise "/".
 * Prevents open redirects through the `next` query parameter.
 */
export function safeRedirectPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return "/";
  }
  return path;
}
