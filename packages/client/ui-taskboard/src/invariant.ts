/** Package-owned invariant companion for the Taskboard UI. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-taskboard'

/** Cordis companion plugin name. */
export const name = 'client-ui-taskboard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Remote responses and the controller's stale-response
 * fences are asserted by focused tests; the UI emits no Cordis events.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
