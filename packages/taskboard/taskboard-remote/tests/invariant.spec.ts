import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as TaskboardRemoteInvariant from '../src/invariant.ts'

describe('taskboard-remote invariant companion', () => {
  it('releases its package registration with its Cordis fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TaskboardRemoteInvariant)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-taskboard-remote', () => {}))
      .toThrow(/already registered/u)
    await fiber.dispose()
    await expect(ctx.plugin(TaskboardRemoteInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
