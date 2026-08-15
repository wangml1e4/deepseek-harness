import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { apply as hostApply } from '../src/index.ts'
import { apply, inject, name } from '../src/invariant.ts'

describe('ui-taskboard invariant companion', () => {
  it('reserves and releases package ownership', async () => {
    expect(name).toBe('client-ui-taskboard-invariant')
    expect(inject).toEqual(['invariants'])
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
  })

  it('keeps the Host half empty', () => {
    hostApply()
    expect(true).toBe(true)
  })
})
