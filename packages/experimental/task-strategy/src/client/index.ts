/** Browser entry of the optional task strategy plugin. */
import type { Context } from '@deepseek-ai/cordis'
import taskStrategiesRemote from '@deepseek-ai/dsh-experimental-task-strategy/remote'
import { mountTaskStrategyUi } from './mount.ts'

export { inject } from './mount.ts'
export type { TaskStrategyCardProps } from './TaskStrategyCard.tsx'
export type { TaskStrategyCardFace, TaskStrategyCardState } from './task-strategy-card-controller.ts'

/**
 * Register the read-only catalogue and task strategy configuration page.
 * @param ctx - browser runtime.
 * @returns disposer of the original slots and experimental Remote contribution.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountTaskStrategyUi(ctx, taskStrategiesRemote)
}
