/**
 * Extracts a human-readable message from an unknown thrown value — added
 * 2026-07-29 after a real bug: every transfer route's catch block did
 * `err instanceof Error ? err.message : "Transfer failed"`, but Supabase's
 * client throws plain PostgrestError-shaped objects (`{ message, code,
 * details, hint }`), NOT real `Error` instances. That check silently
 * swallowed the real underlying message every time (e.g. a storage upload
 * or insert failure) and always fell back to the generic "Transfer
 * failed" — exactly what Vlad saw with zero further detail when a real
 * transfer failed live. This also treats any object with a string
 * `message` property as a match, not just true `Error` instances.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}
