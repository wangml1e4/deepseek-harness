/** Package-owned invariant companion for the Taskboard Remote Consumer. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-taskboard-remote'

/** Cordis companion plugin name. */
export const name = 'taskboard-remote-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No companion check: the adapter owns no mutable state outside its Providers. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
