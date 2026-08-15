import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('manage-taskboard snapshot requires an overlay path')
const rootConfigPath = fileURLToPath(new URL('../../../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const ctx = await boot('manage-taskboard-snapshot', rootConfigPath, [
  ...loadOverlayPatches('manage-taskboard-snapshot', basePatchPath),
  ...loadOverlayPatches('manage-taskboard-snapshot', overlayPath),
])

try {
  const agentId = SessionId('manage-taskboard-snapshot')
  const session = ctx.sessions.create(agentId, { meta: { cwd: process.cwd() } })
  const agent: Agent = {
    ctx: new Context(),
    id: agentId,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('manage-taskboard snapshot must receive the catalog at the step boundary') },
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  const catalog = decision.kind === 'enter'
    ? decision.messages.find(message => message.role === 'user'
      && message.source.kind === 'skill-catalog')?.content
    : undefined
  const summary = (await ctx.skills.list()).find(skill => skill.name === 'manage-taskboard')
  const result = await ctx.tools.execute({
    callId: CallId('manage-taskboard-snapshot'),
    name: 'skill',
    arguments: { name: 'manage-taskboard' },
    signal: new AbortController().signal,
  })
  const summaryResourceBase = summary?.resourceBase
  const resourceBase = summaryResourceBase?.kind === 'directory' ? summaryResourceBase.path : undefined
  if (summary !== undefined && resourceBase === undefined) {
    throw new Error('manage-taskboard snapshot requires a directory resource base')
  }
  const normalizedSummary: unknown = summary === undefined
    ? null
    : JSON.parse(JSON.stringify(summary).replaceAll(resourceBase as string, '{{resourceBase}}')) as unknown
  process.stdout.write(`${JSON.stringify({
    catalog: catalog ?? null,
    summary: normalizedSummary,
    result,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
