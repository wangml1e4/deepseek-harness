/** Package-owned invariant companion for the Token usage settings page. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-token-usage'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-token-usage-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the page owns no events or cross-plugin mutable
 * relation; all data arrives through the root standard session-list hook.
 */
const install: InvariantInstaller = () => {}

/** Register the package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
