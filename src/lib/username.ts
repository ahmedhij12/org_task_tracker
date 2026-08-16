/** Instagram-style handle: lowercase, digits, dot, underscore only. */
export function sanitizeUsername(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9._]/g, '');
}
