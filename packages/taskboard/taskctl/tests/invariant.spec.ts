import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as TaskctlInvariant from '../src/invariant.ts'

describe('taskctl invariant companion', () => {
  it('releases its package registration with its Cordis fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TaskctlInvariant)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-taskctl', () => {}))
      .toThrow(/already registered/u)
    await fiber.dispose()
    await expect(ctx.plugin(TaskctlInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
