/** Browser plugin registering the standalone Token usage settings section. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TokenUsageSectionInjected } from './TokenUsageSection.tsx'
import { TokenUsageSection } from './TokenUsageSection.tsx'
import { en, zh, type TokenUsageKey } from './locales.ts'

export type { TokenUsageKey } from './locales.ts'
export type { TokenUsageSectionInjected, TokenUsageSectionProps } from './TokenUsageSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Token activity settings-page copy. */
    'settings.token-usage': TokenUsageKey
  }
}

const NS = 'settings.token-usage'

/** Required browser services. */
export const inject = ['slots', 'locale', 'sessions']

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Register bilingual copy and the additive settings page. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-token-usage: copy dictionaries')
  const t = ctx.locale.bind(NS) as TokenUsageSectionInjected['t']
  const hydrateActivity = (
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ): ReturnType<TokenUsageSectionInjected['hydrateActivity']> =>
    ctx.sessions.hydrateProjection('tokenActivity', sessionIds, signal)
  const injected = (): TokenUsageSectionInjected => ({
    t,
    locale: () => ctx.locale.getSnapshot().active === 'zh' ? 'zh-CN' : 'en-US',
    timeZone: browserTimeZone,
    now: Date.now,
    hydrateActivity,
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'token-usage',
    order: 12,
    label: () => t('nav'),
    inject: injected,
  }, TokenUsageSection))
}
