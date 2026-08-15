/** REAL Loader proof for token activity registration and unload. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as TokenMeterPlugin from '@deepseek-ai/dsh-token-meter'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadTokenMeter(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-token-activity-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-token-meter'",
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-token-meter', TokenMeterPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('token activity real Loader composition', () => {
  it('registers from YAML and removes its projections with the Loader fiber', async () => {
    const loaded = await loadTokenMeter()
    const meterEntry = [...loaded.loader.entries()]
      .find(entry => entry.options.name === '@deepseek-ai/dsh-token-meter')
    expect(meterEntry?.fiber).toBeDefined()

    const session = loaded.sessions.create(SessionId('token-activity-composed'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } },
    })
    expect(loaded.sessionProjections.snapshot(session).values.tokenActivity)
      .toMatchObject({ days: [expect.objectContaining({ uncachedInputTokens: 12, outputTokens: 3 })] })

    await meterEntry!.fiber!.dispose()
    expect(loaded.sessionProjections.snapshot(session).values.tokenActivity).toBeUndefined()
    expect(loaded.sessionProjections.snapshot(session).values.tokenUsage).toBeUndefined()
  })
})
