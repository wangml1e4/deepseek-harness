import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { apply, inject, name } from '../src/invariant.ts'
import { TokenUsageSection } from '../src/client/TokenUsageSection.tsx'

describe('ui-settings-token-usage invariant companion', () => {
  it('reserves and releases package ownership', async () => {
    expect(name).toBe('client-ui-settings-token-usage-invariant')
    expect(inject).toEqual(['invariants'])
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
  })

  it('keeps the Host half empty and renders null before page injection', async () => {
    const host = await import('../src/index.ts')
    host.apply()
    expect(TokenUsageSection({} as never)).toBeNull()
  })
})
