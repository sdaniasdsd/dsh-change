/** Configuration and model-JSON validation for the DSH carrier. */
import z from '@deepseek-ai/schemastery'
import type { AdapterConfig, ExecutionPlan } from './types.ts'

/** Validate an execution plan received as JSON or configuration. */
export const planSchema = z.object({
  name: z.string().required(),
  stages: z.array(z.object({
    name: z.string().required(),
    tasks: z.array(z.object({
      label: z.string().required(),
      preset: z.string().required(),
      instruction: z.string().required(),
      tools: z.union([z.const(undefined), z.object({
        allow: z.union([z.const(undefined), z.array(z.string())]),
        deny: z.union([z.const(undefined), z.array(z.string())]),
      })]),
      model: z.string(),
      provider: z.string(),
    })).required(),
  })).required(),
}) as z<ExecutionPlan>

/** Deployment defaults and author policy declarations. */
export const adapterSchema: z<AdapterConfig> = z.object({
  provider: z.string().default('spawn'),
  toolPrefix: z.string().default('task_strategy'),
  allowedPresets: z.array(z.string()).required(),
  strategies: z.array(z.object({
    id: z.string().required(), description: z.string().required(), plan: planSchema.required(),
    variants: z.array(z.object({ preference: z.string().required(), equals: z.string().required(), plan: planSchema.required() })),
  })).default([]),
  maxConcurrent: z.natural().min(1).default(2),
  maxTasks: z.natural().min(1).default(16),
  maxPlanBytes: z.natural().min(1).default(65536),
  maxResultBytes: z.natural().min(1).default(65536),
  maxOutputBytes: z.natural().min(512).default(32768),
})

/** Validate string-valued author preferences at the tool JSON input. */
export const preferencesSchema = z.dict(z.string()).required()

/**
 * Parse untrusted model JSON with the execution-plan schema.
 * @param value - arbitrary tool JSON.
 * @returns validated plan; rejects malformed fields.
 */
export function parsePlan(value: unknown): ExecutionPlan {
  return planSchema(value as ExecutionPlan)
}

/**
 * Parse untrusted author preference JSON.
 * @param value - arbitrary tool JSON.
 * @returns string-valued preference dictionary.
 */
export function parsePreferences(value: unknown): Record<string, string> {
  return preferencesSchema(value as Record<string, string>)
}

/**
 * Keep a complete textual result within a UTF-8 byte ceiling.
 * @param text - producer text.
 * @param maxBytes - byte ceiling, including the truncation notice.
 * @returns text or a UTF-8-safe prefix with an explicit notice.
 */
export function boundText(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= maxBytes) return text
  const notice = '\n[truncated; inspect child sessions for full output]'
  let end = Math.max(0, maxBytes - Buffer.byteLength(notice))
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8') + notice
}
