import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  launchWebScaffold,
  type WebScaffold,
} from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/taskboard-protocol', import.meta.url))
const PROTOCOL_EXPECTED = join(SNAPSHOT_DIR, 'protocol.expected.json')

interface ProtocolExchange {
  readonly endpoint: string
  readonly request: unknown
  readonly status: number
  readonly response: unknown
}

function createdIdentifier(response: unknown): string {
  const envelope = response as {
    result?: { ok?: unknown; value?: { ok?: unknown; value?: { identifier?: unknown } } }
  }
  const identifier = envelope.result?.value?.value?.identifier
  if (envelope.result?.ok !== true || envelope.result.value?.ok !== true || typeof identifier !== 'string') {
    throw new Error('taskboard.createIssue did not return a successful Issue identifier')
  }
  return identifier
}

/** Replace run-owned ids and timestamps while preserving all Taskboard protocol fields. */
function normalizeProtocol(exchanges: readonly ProtocolExchange[], workspaceId: string): string {
  return JSON.stringify(exchanges, (_key, value: unknown) => {
    if (value === workspaceId) return '{{workspaceId}}'
    if (typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
      return '{{uuid}}'
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
      return '{{timestamp}}'
    }
    return value
  }, 2)
}

describe('Taskboard Host Remote protocol', () => {
  let scaffold: WebScaffold

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
  })

  afterAll(async () => {
    await scaffold?.close()
  })

  it('snapshots strict validation, creation, listing, and optimistic conflict through the shipped Web Host', async () => {
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Protocol Workspace')
    const exchanges: ProtocolExchange[] = []
    const invoke = async (rpcId: string, method: string, args: Record<string, unknown>): Promise<unknown> => {
      const endpoint = `taskboard/${method}`
      const payload = { args }
      const response = await fetch(`${scaffold.baseUrl}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
      })
      const body: unknown = await response.json()
      exchanges.push({
        endpoint: `/api/${endpoint}`,
        request: payload,
        status: response.status,
        response: body,
      })
      return body
    }

    await invoke('taskboard-workspace', 'workspace', { workspaceId: workspace.id })
    await invoke('taskboard-invalid-create', 'createIssue', { input: {
      workspaceId: workspace.id,
      title: 'Invalid status',
      status: 'ready',
    } })
    const created = await invoke('taskboard-create', 'createIssue', { input: {
      workspaceId: workspace.id,
      title: 'Exercise the protocol',
      status: 'todo',
      priority: 'high',
      labels: ['remote', 'snapshot'],
    } })
    await invoke('taskboard-list', 'listIssues', { input: { workspaceId: workspace.id, status: 'todo' } })
    await invoke('taskboard-conflict', 'updateIssue', { input: {
      reference: createdIdentifier(created),
      expectedVersion: 0,
      status: 'in_progress',
      actor: { type: 'user', id: 'protocol-user', name: 'Protocol User' },
    } })

    expect(exchanges.every(exchange => exchange.status === 200)).toBe(true)
    await compareOrRefreshGolden(
      PROTOCOL_EXPECTED,
      normalizeProtocol(exchanges, workspace.id),
      scaffold.mode,
    )
    await assertFixtureInventory(SNAPSHOT_DIR, ['protocol.expected.json'])
  })
})
