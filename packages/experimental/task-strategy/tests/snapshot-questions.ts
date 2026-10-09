/** Mount the original timed question services for a keyless unattended snapshot. */
import type { Context } from '@deepseek-ai/cordis'
import * as AskUser from '@deepseek-ai/dsh-tool-ask-user'

export const inject = ['tools', 'userQuestions']
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(AskUser, { mode: 'timed', timeout: 1 })
}
