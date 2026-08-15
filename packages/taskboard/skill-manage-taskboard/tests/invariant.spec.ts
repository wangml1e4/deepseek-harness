import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ManageTaskboardInvariant from '../src/invariant.ts'

describe('manage-taskboard invariant companion', () => {
  it('releases its package registration with its Cordis fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(ManageTaskboardInvariant)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-skill-manage-taskboard', () => {}))
      .toThrow(/already registered/u)
    await fiber.dispose()
    await expect(ctx.plugin(ManageTaskboardInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
