/** Package-owned invariant companion for the Taskboard Patrol execution Consumer. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-taskboard-patrol'

/** Cordis companion plugin name. */
export const name = 'taskboard-patrol-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the Taskboard Provider asserts durable binding and Attempt relationships transactionally. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis application context.
 * @returns disposer for the registered invariant owner.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
