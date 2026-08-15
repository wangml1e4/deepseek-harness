import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ManageTaskboardSkill from '../src/index.ts'

const skill = await readFile(new URL('../assets/SKILL.md', import.meta.url), 'utf8')
const cli = await readFile(new URL('../assets/references/cli.md', import.meta.url), 'utf8')

describe('manage-taskboard bundled skill', () => {
  it('registers one model- and user-invocable bundled definition', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(ManageTaskboardSkill)
    const resourcePath = fileURLToPath(new URL('../assets/', import.meta.url))
    expect(await ctx.skills.list()).toEqual([{
      name: 'manage-taskboard',
      description: 'Manage DeepSeek Harness Taskboard work with taskctl. Use for Taskboard Issue identifiers, status changes, comments, relations, or durable work tracking.',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'manage-taskboard',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resourcePath },
    }])
    expect((await ctx.skills.get('manage-taskboard'))?.content).toContain('Only a `todo` Issue is claimable')
    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('pins safe claim, execution, review, and completion rules', () => {
    expect(skill).toMatch(/first run `taskctl issue get` and `taskctl comment list`/i)
    expect(skill).toMatch(/only a `todo` Issue is claimable/i)
    expect(skill).toMatch(/move it to `in_progress` with its current `version` before reading code/i)
    expect(skill).toMatch(/retry the claim at most once/i)
    expect(skill).toMatch(/complete a code review, apply required fixes, run verification, and create a commit/i)
    expect(skill).toMatch(/move the Issue to `in_review` and end the current execution round/i)
    expect(skill).toMatch(/never move an Issue to `done` automatically/i)
    expect(skill).toMatch(/Never delete an Issue/i)
  })

  it('documents every taskctl operation exposed by the V1 domain slice', () => {
    for (const command of [
      'issue list', 'issue get', 'issue create', 'issue update', 'issue move',
      'issue archive', 'issue restore', 'comment list', 'comment add',
      'activity list', 'relation list', 'relation add', 'relation remove',
    ]) {
      expect(cli).toContain(`taskctl ${command}`)
    }
    expect(cli).toMatch(/--if-version/)
    expect(cli).toMatch(/CODEX_THREAD_ID/)
  })
})
