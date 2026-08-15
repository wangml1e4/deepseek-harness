/** Bundled manage-taskboard skill Provider. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'manage-taskboard'
const SKILL_BODY_URL = new URL('../assets/SKILL.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const DESCRIPTION = 'Manage DeepSeek Harness Taskboard work with taskctl. Use for Taskboard Issue identifiers, status changes, comments, relations, or durable work tracking.'
const CANDIDATE: SkillCandidate = {
  name: 'manage-taskboard',
  description: DESCRIPTION,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(): Promise<SkillDefinition> {
    return {
      ...CANDIDATE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'skill-manage-taskboard'
/** Service required by the bundled Provider. */
export const inject = ['skills']

/** Register the bundled manage-taskboard Provider. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
