/** Headless snapshot composition resolves each public package in the launcher's source or built mode. */
import type { Context } from '@deepseek-ai/cordis'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import Preset from '@deepseek-ai/dsh-agent-preset'
import Adapter from '@deepseek-ai/dsh-experimental-task-strategy/cordis'
import type { AdapterConfig } from '@deepseek-ai/dsh-experimental-task-strategy/types'

export const inject = ['agents', 'tools', 'subagents', 'jobs', 'sessionProjections']
export async function apply(ctx: Context, config: AdapterConfig): Promise<void> {
  await ctx.plugin(Presets, { default: 'standard' })
  await ctx.plugin(Preset, { id: 'standard', plugins: [] })
  await ctx.plugin(Adapter, config)
}
