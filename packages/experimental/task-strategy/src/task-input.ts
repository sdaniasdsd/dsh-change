/** Task text semantics shared by author decisions and execution admission. */

/**
 * Reject absent task content while preserving the caller's original text.
 * @param task - typed task body supplied for decision or execution.
 */
export function validateTask(task: string): void {
  if (!task.trim()) throw new Error('Task must not be empty')
}
