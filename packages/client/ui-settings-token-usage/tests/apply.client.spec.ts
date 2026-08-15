import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-token-usage/client'
import { TokenUsageSection } from '../src/client/TokenUsageSection.tsx'

usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const hydrationCalls: unknown[][] = []
  ctx.provide('sessions', {
    hydrateProjection: (...args: unknown[]) => {
      hydrationCalls.push(args)
      return Promise.resolve({ failed: [] })
    },
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, hydrationCalls }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-token-usage apply', () => {
  it('declares services and registers bilingual navigation plus injected deterministic faces', async () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions'])
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(TokenUsageSection)
    expect(entry.options).toMatchObject({ id: 'token-usage', order: 12 })
    expect(resolveSlotLabel(entry.options.label)).toBe('Token 用量')
    const injected = entry.inject as unknown as () => import('../src/client/TokenUsageSection.tsx').TokenUsageSectionInjected
    expect(injected().t('empty')).toBe('暂无服务商报告的 Token 用量')
    expect(injected().locale()).toBe('zh-CN')
    expect(typeof injected().now()).toBe('number')
    expect(injected().timeZone()).not.toBe('')
    await injected().hydrateActivity(['cold' as never])
    expect(b.hydrationCalls).toEqual([['tokenActivity', ['cold'], undefined]])
    b.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Token usage')
    expect(injected().locale()).toBe('en-US')
  })

  it('recovers after declaration HMR and removes the contribution and dictionaries on dispose', async () => {
    const b = await bench()
    const collapse = declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    collapse()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')[0]!.component).toBe(TokenUsageSection)
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(() => b.locale.register('settings.token-usage', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings.token-usage', 'en', {})).not.toThrow()
  })
})
