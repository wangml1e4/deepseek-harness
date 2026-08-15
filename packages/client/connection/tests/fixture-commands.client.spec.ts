/**
 * Fixture commands/skills domains: session-addressed catalogs, execute
 * parse/dispatch and its logged lifecycle pair, skill.list session resolution,
 * and the FixtureApiClient dispatch rows. Commands answer on the Remote face
 * and skills on the legacy API face, so both are driven here.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'
import type { RpcRequest } from '../src/client/api.ts'
import { FixtureApiClient, createFixtureApi, createFixtureFaces } from '../src/client/fixture.ts'

/** Drive one commands Remote endpoint against the fixture state graph. */
async function callRemote<T>(
  rpc: ReturnType<typeof createFixtureFaces>['rpc'],
  endpoint: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await rpc.call('/api', endpoint, { args })
  if (!result.ok) throw new Error(`${endpoint} failed: ${result.error.code}`)
  return result.value as T
}

const sid = (id: string): SessionId => id as SessionId
let reqCount = 0
const req = <P>(payload: P): RpcRequest<P> => ({ rpcId: RpcId(`t-${reqCount++}`), payload })

describe('createFixtureApi commands/skills', () => {
  it('serves the addressed session catalog', async () => {
    const { rpc } = createFixtureFaces()
    const commands = await callRemote<{ name: string; input?: { hint: string } }[]>(
      rpc, 'commands/list', { agentId: sid('fx-alpha') })
    expect(commands.map(c => c.name)).toEqual(['compact', 'echo', 'goal', 'permission', 'plan'])
    // input hint rides only the commands declaring it.
    const echo = commands.find(c => c.name === 'echo')
    expect(echo?.input?.hint).toBeTruthy()
    expect(commands.find(c => c.name === 'compact')?.input).toBeUndefined()
  })

  it('rejects a catalog request for an unknown session', async () => {
    const { rpc } = createFixtureFaces()
    const result = await rpc.call('/api', 'commands/list', { args: { agentId: sid('fx-nope') } })
    expect(result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('executes a known command line: pure admission plus a mux-broadcast lifecycle pair', async () => {
    const { api, rpc } = createFixtureFaces()
    const frames: unknown[] = []
    const abort = new AbortController()
    const stream = api.events.mux(req({}), abort.signal)
    const pump = (async () => {
      for await (const frame of stream) {
        frames.push(frame.payload)
        if (frames.filter(f => (f as { type: string }).type === 'session/event').length >= 2) abort.abort()
      }
    })()
    const execution = await callRemote<{ commandId: string } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/echo hello world' })
    expect(execution?.commandId).toBeTruthy()
    await pump
    const events = frames
      .filter((f): f is { type: string; event: { type: string; data: Record<string, unknown> } } => (f as { type: string }).type === 'session/event')
      .map(f => f.event)
    expect(events).toMatchObject([
      { type: 'command/run', data: { name: 'echo', args: ' hello world', source: { kind: 'user' } } },
      { type: 'command/done', data: { kind: 'success', text: 'hello world' } },
    ])
    expect(events[0]?.data.commandId).toBe(events[1]?.data.commandId)
  })

  it('addresses execute to the session; an unknown session errs', async () => {
    const { rpc } = createFixtureFaces()
    const hit = await callRemote<{ commandId: string } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/goal ship' })
    expect(hit?.commandId).toBeTruthy()

    const missing = await rpc.call('/api', 'commands/execute', {
      args: { agentId: sid('fx-nope'), line: '/goal ship' },
    })
    expect(missing).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('answers no execution for unknown names and non-command lines', async () => {
    const { rpc } = createFixtureFaces()
    for (const line of ['/nope', 'plain text', '/']) {
      // Absence is the whole answer: nothing matched, so no lifecycle id exists.
      expect(await callRemote(rpc, 'commands/execute', { agentId: sid('fx-alpha'), line }))
        .toBeUndefined()
    }
  })

  it('serves the skill catalog for the addressed session and rejects unknown sessions', async () => {
    const api = createFixtureApi()
    const response = await api.skills.list(req({ sessionId: sid('fx-alpha') }))
    if (!response.result.ok) throw new Error('skill list failed')
    expect(response.result.value.skills[0]?.name).toBe('fixture-demo')

    const missingSession = await api.skills.list(req({ sessionId: sid('fx-nope') }))
    expect(missingSession.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })
})

describe('FixtureApiClient command/skill dispatch', () => {
  it('routes the Remote commands face and the legacy skill row through one state graph', async () => {
    const client = new FixtureApiClient()
    const commands = await callRemote<{ name: string }[]>(client.rpc, 'commands/list', { agentId: sid('fx-alpha') })
    expect(commands.length).toBeGreaterThan(0)
    const executed = await callRemote<{ commandId: string } | undefined>(
      client.rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/compact' })
    expect(executed?.commandId).toBeTruthy()
    const skills = await client.skills.list({ sessionId: sid('fx-alpha') })
    if (!skills.result.ok) throw new Error('skill.list failed')
    expect(skills.result.value.skills.length).toBeGreaterThan(0)
  })
})

describe('FixtureApiClient onboarding settings', () => {
  it('persists the welcome acknowledgement used by local browser journeys', async () => {
    const api = createFixtureApi()
    const before = await api.settings.describe(req({}))
    expect(before.result).toMatchObject({
      ok: true,
      value: {
        namespaces: [{ ns: 'llm-deepseek' }, { ns: 'ui-onboarding', value: {}, revision: 0 }],
      },
    })

    const changed = await api.settings.mutate(req({
      ns: 'ui-onboarding',
      ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-08-13.1' }],
    }))
    expect(changed.result).toMatchObject({
      ok: true,
      value: { ns: 'ui-onboarding', value: { welcomeNoticeVersion: '2026-08-13.1' }, revision: 1 },
    })
  })
})

describe('FixtureApiClient Taskboard Remote', () => {
  it('serves and mutates the Workspace-owned Taskboard through generated endpoint names', async () => {
    const { rpc } = createFixtureFaces()
    const board = await callRemote<{ ok: true; value: { prefix: string } }>(
      rpc, 'taskboard/workspace', { workspaceId: 'fx-ws-fixture' })
    expect(board).toMatchObject({ ok: true, value: { prefix: 'FIX' } })

    const listed = await callRemote<{ ok: true; value: { items: { identifier: string }[] } }>(
      rpc, 'taskboard/listIssues', { input: { workspaceId: 'fx-ws-fixture' } })
    expect(listed.value.items.map(issue => issue.identifier)).toEqual(['FIX-1', 'FIX-2', 'FIX-3'])

    const created = await callRemote<{ ok: true; value: { id: string; version: number } }>(
      rpc, 'taskboard/createIssue', { input: { workspaceId: 'fx-ws-fixture', title: 'Exercise fixture' } })
    const updated = await callRemote<{ ok: true; value: { title: string; version: number } }>(
      rpc, 'taskboard/updateIssue', {
        input: {
          reference: created.value.id,
          expectedVersion: created.value.version,
          title: 'Exercise fixture mutation',
          actor: { type: 'user', id: 'fixture-user', name: 'Fixture User' },
        },
      })
    expect(updated.value).toMatchObject({ title: 'Exercise fixture mutation', version: 2 })
  })
})
