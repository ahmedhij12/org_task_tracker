/** Org IDs are plain 5-digit numbers now — strip anything else as the user types. */
export function sanitizeOrgCode(input: string): string {
  return input.replace(/[^0-9]/g, '').slice(0, 5);
}
