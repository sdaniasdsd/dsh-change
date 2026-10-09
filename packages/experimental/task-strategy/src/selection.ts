/** Resolve trusted intake and parse untrusted model choices at their owning boundary. */
import type { TaskIntakeRequest, TaskSelection } from './selection-types.ts'

/**
 * Capture the explicit request choice or current deployment default.
 * @param request - original task intake.
 * @param fallback - validated plugin default.
 * @returns detached selection, safe to retain across configuration changes.
 */
export function resolveSelection(request: TaskIntakeRequest, fallback: TaskSelection): TaskSelection {
  return structuredClone(request.selection ?? fallback)
}

/**
 * Accept one strategy from the catalogue captured before the model call.
 * @param value - untrusted structured model output.
 * @param candidates - original registered strategy ids.
 * @returns selected id; rejects unknown ids and extra fields.
 */
export function parseSelection(value: unknown, candidates: readonly string[]): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('strategy' in value)
    || typeof value.strategy !== 'string' || !candidates.includes(value.strategy)) {
    throw new Error('Invalid strategy selection')
  }
  return value.strategy
}
