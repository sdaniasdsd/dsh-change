/** Exception rendering for lifecycle paths that must finish cleanup even for non-Error throws. */

/**
 * Render an arbitrary thrown value without allowing its conversion to throw again.
 * @param error - author, preparation or executor failure.
 * @returns printable text, or a fixed diagnostic when conversion fails.
 */
export function errorText(error: unknown): string {
  try { return String(error) }
  catch (conversionError) {
    // Thrown values can lack a primitive conversion; reporting must not interrupt cleanup.
    void conversionError
    return 'Unprintable error'
  }
}
