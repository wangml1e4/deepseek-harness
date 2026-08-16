import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTaskctlArgs, runTaskctl, TASKCTL_SCHEMA_VERSION } from '../src/index.ts'

interface RpcRequestBody {
  readonly rpcId: string
  readonly method: string
  readonly payload: { readonly args: Record<string, unknown> }
}

const tempDirs: string[] = []

function capture() {
  let value = ''
  return {
    stream: { write(chunk: string) { value += chunk } },
    json: () => JSON.parse(value) as unknown,
  }
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function rpcSuccess(rpcId: string, value: unknown): Response {
  return response({
    type: 'server-response',
    rpcId,
    result: { ok: true, value },
  })
}

async function run(argv: string[], fetchImplementation: typeof fetch, env: NodeJS.ProcessEnv = {}) {
  const stdout = capture()
  const stderr = capture()
  const exitCode = await runTaskctl(argv, {
    fetch: fetchImplementation,
    stdout: stdout.stream,
    stderr: stderr.stream,
    env,
    createRpcId: () => 'taskctl-test',
  })
  return {
    exitCode,
    stdout: exitCode === 0 ? stdout.json() : undefined,
    stderr: exitCode === 0 ? undefined : stderr.json(),
  }
}

function requestBody(init: RequestInit | undefined): RpcRequestBody {
  if (typeof init?.body !== 'string') throw new TypeError('expected a string request body')
  return JSON.parse(init.body) as RpcRequestBody
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function capturingFetch(calls: RpcRequestBody[]): typeof fetch {
  return async (_input, init) => {
    const body = requestBody(init)
    calls.push(body)
    return rpcSuccess(body.rpcId, { ok: true, value: {} })
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('taskctl', () => {
  it('parses equals options and rejects duplicates', () => {
    expect(parseTaskctlArgs(['issue', 'list', '--workspace=workspace-1', '--json'])).toEqual({
      resource: 'issue',
      action: 'list',
      operands: [],
      options: { workspace: 'workspace-1', json: true },
    })
    expect(() => parseTaskctlArgs(['issue', 'get', 'TASK-1', '--json', '--json']))
      .toThrow('Option --json may only be specified once')
  })

  it('parses option terminators and rejects malformed option tokens', () => {
    expect(parseTaskctlArgs([
      undefined, 'issue', 'get', '--', '--literal-reference',
    ] as unknown as string[])).toEqual({
      resource: 'issue',
      action: 'get',
      operands: ['--literal-reference'],
      options: {},
    })
    for (const [argv, message] of [
      [['issue', 'get', 'TASK-1', '--=value'], 'Invalid empty option'],
      [['issue', 'get', 'TASK-1', '--json=true'], 'Option --json does not accept a value'],
      [['issue', 'get', 'TASK-1', '--unknown'], 'Option --unknown requires a value'],
      [['issue', 'get', 'TASK-1', '--unknown', '--json'], 'Option --unknown requires a value'],
    ] as const) {
      expect(() => parseTaskctlArgs(argv)).toThrow(message)
    }
  })

  it('creates an Issue through the Taskboard Remote envelope', async () => {
    let observedUrl = ''
    let observedBody: unknown
    const result = await run([
      'issue', 'create', '--workspace', 'workspace-1', '--title', 'Ship B',
      '--status', 'todo', '--labels', 'remote,cli,remote',
    ], async (input, init) => {
      observedUrl = requestUrl(input)
      observedBody = requestBody(init)
      return rpcSuccess('taskctl-test', {
        ok: true,
        value: { identifier: 'WORKSPACE1-1', title: 'Ship B', version: 1 },
      })
    }, { DSH_TASKBOARD_URL: 'http://127.0.0.1:4100/' })

    expect(result).toEqual({
      exitCode: 0,
      stdout: {
        schemaVersion: TASKCTL_SCHEMA_VERSION,
        result: { identifier: 'WORKSPACE1-1', title: 'Ship B', version: 1 },
      },
      stderr: undefined,
    })
    expect(observedUrl).toBe('http://127.0.0.1:4100/api/taskboard/createIssue')
    expect(observedBody).toEqual({
      type: 'client-request',
      rpcId: 'taskctl-test',
      method: 'taskboard/createIssue',
      payload: {
        args: {
          input: {
            workspaceId: 'workspace-1',
            title: 'Ship B',
            status: 'todo',
            labels: ['remote', 'cli'],
          },
        },
      },
    })
  })

  it('attributes writes to the current Codex Session and maps conflicts to exit 5', async () => {
    let observedBody: RpcRequestBody | undefined
    const result = await run([
      'issue', 'update', 'TASK-1', '--status', 'in_review', '--if-version', '2',
    ], async (_input, init) => {
      observedBody = requestBody(init)
      return rpcSuccess('taskctl-test', {
        ok: false,
        error: { code: 'version_conflict', message: 'stale Issue version' },
      })
    }, {
      CODEX_THREAD_ID: 'session-123',
    })

    const input = observedBody?.payload.args.input as Record<string, unknown>
    expect(input.actor).toEqual({
      type: 'user',
      id: 'session-123',
      name: 'Interactive Agent',
    })
    expect(input).not.toHaveProperty('returnReason')
    expect(result).toEqual({
      exitCode: 5,
      stdout: undefined,
      stderr: {
        schemaVersion: TASKCTL_SCHEMA_VERSION,
        error: { code: 'version_conflict', message: 'stale Issue version' },
      },
    })
  })

  it('maps --return-reason to the domain reason field', async () => {
    let observedBody: RpcRequestBody | undefined
    const result = await run([
      'issue', 'update', 'TASK-1', '--status', 'todo', '--return-reason', 'Address review',
      '--if-version', '4',
    ], async (_input, init) => {
      observedBody = requestBody(init)
      return rpcSuccess('taskctl-test', { ok: true, value: { version: 5 } })
    })

    expect(result.exitCode).toBe(0)
    const input = observedBody?.payload.args.input as Record<string, unknown>
    expect(input).toMatchObject({
      reference: 'TASK-1',
      reason: 'Address review',
    })
    expect(input).not.toHaveProperty('returnReason')
  })

  it('maps Workspace reads, prefix edits, Issue reads, and all filter fields', async () => {
    const calls: RpcRequestBody[] = []
    const fetchImplementation = capturingFetch(calls)
    for (const command of [
      ['workspace', 'get', 'workspace-1'],
      ['workspace', 'prefix', 'workspace-1', '--prefix', 'HARNESS', '--if-version', '2'],
      ['issue', 'get', 'HARNESS-1'],
      [
        'issue', 'list', '--workspace', 'workspace-1', '--status', 'todo', '--priority', 'urgent',
        '--label', 'remote', '--assignee', 'patrol_agent', '--archived', 'include', '--query', 'schema',
      ],
    ]) {
      expect((await run(command, fetchImplementation)).exitCode).toBe(0)
    }
    expect(calls.map(call => ({ method: call.method, args: call.payload.args }))).toEqual([
      { method: 'taskboard/workspace', args: { workspaceId: 'workspace-1' } },
      { method: 'taskboard/setPrefix', args: { input: {
        workspaceId: 'workspace-1', prefix: 'HARNESS', expectedVersion: 2,
      } } },
      { method: 'taskboard/getIssue', args: { reference: 'HARNESS-1' } },
      { method: 'taskboard/listIssues', args: { input: {
        workspaceId: 'workspace-1', status: 'todo', priority: 'urgent', label: 'remote',
        assignee: 'patrol_agent', archived: 'include', query: 'schema',
      } } },
    ])
  })

  it('maps every optional Issue create and update field', async () => {
    const calls: RpcRequestBody[] = []
    const fetchImplementation = capturingFetch(calls)
    expect((await run([
      'issue', 'create', '--workspace', 'workspace-1', '--title', 'Complete fields',
      '--description', 'Description', '--status', 'backlog', '--priority', 'low',
      '--labels', ' one, two, one ', '--assignee', 'user', '--start-date', '2026-08-16',
      '--due-date', '2026-08-20',
    ], fetchImplementation)).exitCode).toBe(0)
    expect((await run([
      'issue', 'update', 'HARNESS-1', '--if-version', '7', '--title', 'Updated',
      '--description', 'Updated description', '--status', 'todo', '--priority', 'high',
      '--labels', '', '--assignee', 'unassigned', '--start-date=', '--due-date', '2026-08-21',
      '--sort-order', '3', '--return-reason', 'Review addressed', '--actor-type', 'reviewer',
      '--actor-id', 'reviewer-1', '--actor-name', 'Reviewer One',
    ], fetchImplementation)).exitCode).toBe(0)
    expect(calls[0]?.payload.args).toEqual({ input: {
      workspaceId: 'workspace-1',
      title: 'Complete fields',
      description: 'Description',
      status: 'backlog',
      priority: 'low',
      labels: ['one', 'two'],
      assignee: 'user',
      startDate: '2026-08-16',
      dueDate: '2026-08-20',
    } })
    expect(calls[1]?.payload.args).toEqual({ input: {
      reference: 'HARNESS-1',
      expectedVersion: 7,
      title: 'Updated',
      description: 'Updated description',
      status: 'todo',
      priority: 'high',
      labels: [],
      assignee: 'unassigned',
      startDate: null,
      dueDate: '2026-08-21',
      sortOrder: 3,
      reason: 'Review addressed',
      actor: { type: 'reviewer', id: 'reviewer-1', name: 'Reviewer One' },
    } })
  })

  it('supports list, comments, Activity, relations, archive, restore, and Workspace moves', async () => {
    const endpoints: string[] = []
    const commands = [
      ['issue', 'list', '--workspace', 'workspace-1', '--status', 'todo'],
      ['comment', 'list', 'TASK-1'],
      ['comment', 'add', 'TASK-1', '--body', 'Ready'],
      ['activity', 'list', 'TASK-1'],
      ['relation', 'list', 'TASK-1'],
      ['relation', 'add', 'TASK-1', '--type', 'blocks', '--issue', 'TASK-2', '--if-version', '1'],
      ['relation', 'remove', 'TASK-1', 'relation-1', '--if-version', '2'],
      ['issue', 'move', 'TASK-1', '--workspace', 'workspace-2', '--if-version', '3'],
      ['issue', 'archive', 'TASK-1', '--if-version', '4'],
      ['issue', 'restore', 'TASK-1', '--if-version', '5'],
    ]
    for (const command of commands) {
      const result = await run(command, async (input) => {
        const endpoint = new URL(requestUrl(input)).pathname
        endpoints.push(endpoint)
        return rpcSuccess('taskctl-test', { ok: true, value: {} })
      })
      expect(result.exitCode).toBe(0)
    }
    expect(endpoints).toEqual([
      '/api/taskboard/listIssues',
      '/api/taskboard/listComments',
      '/api/taskboard/addComment',
      '/api/taskboard/listActivities',
      '/api/taskboard/listRelations',
      '/api/taskboard/addRelation',
      '/api/taskboard/removeRelation',
      '/api/taskboard/moveIssue',
      '/api/taskboard/archiveIssue',
      '/api/taskboard/restoreIssue',
    ])
  })

  it('uploads, lists, downloads, and explicitly confirms attachment deletion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-taskctl-attachments-'))
    tempDirs.push(directory)
    const source = join(directory, 'evidence.bin')
    const output = join(directory, 'downloaded.bin')
    await writeFile(source, Uint8Array.of(1, 2, 3))
    const calls: RpcRequestBody[] = []
    const resultValues = [
      { items: [] },
      { issue: { version: 2 }, attachment: { id: 'attachment-1', name: 'evidence.bin' } },
      { attachment: { id: 'attachment-1', name: 'evidence.bin', mediaType: 'application/octet-stream' }, data: 'AQID' },
      { version: 3 },
    ]
    const fetchImplementation: typeof fetch = async (_input, init) => {
      const body = requestBody(init)
      calls.push(body)
      return rpcSuccess(body.rpcId, { ok: true, value: resultValues[calls.length - 1] })
    }
    for (const command of [
      ['attachment', 'list', 'TASK-1'],
      ['attachment', 'add', 'TASK-1', '--file', source, '--if-version', '1'],
      ['attachment', 'download', 'TASK-1', 'attachment-1', '--output', output],
      ['attachment', 'delete', 'TASK-1', 'attachment-1', '--if-version', '2', '--confirm'],
    ]) {
      expect((await run(command, fetchImplementation)).exitCode).toBe(0)
    }
    expect(calls.map(call => ({ method: call.method, args: call.payload.args }))).toEqual([
      { method: 'taskboard/listAttachments', args: { reference: 'TASK-1' } },
      { method: 'taskboard/addAttachment', args: { input: {
        reference: 'TASK-1',
        expectedVersion: 1,
        name: 'evidence.bin',
        mediaType: 'application/octet-stream',
        data: 'AQID',
        actor: { type: 'user', id: 'local-user', name: 'Local User' },
      } } },
      { method: 'taskboard/readAttachment', args: { input: {
        reference: 'TASK-1', attachmentId: 'attachment-1',
      } } },
      { method: 'taskboard/deleteAttachment', args: { input: {
        reference: 'TASK-1', attachmentId: 'attachment-1', expectedVersion: 2, confirmed: true,
        actor: { type: 'user', id: 'local-user', name: 'Local User' },
      } } },
    ])
    await expect(readFile(output)).resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it('rejects malformed attachment download payloads without creating output files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-taskctl-invalid-attachments-'))
    tempDirs.push(directory)
    const values = [
      { attachment: null, data: 'AQID' },
      { attachment: { id: 'attachment-1', name: 'bad.bin', mediaType: 'application/octet-stream' }, data: 'AB==' },
    ]
    for (const [index, value] of values.entries()) {
      const output = join(directory, `download-${index}.bin`)
      const result = await run(
        ['attachment', 'download', 'TASK-1', 'attachment-1', '--output', output],
        () => Promise.resolve(rpcSuccess('taskctl-test', { ok: true, value })),
      )
      expect(result).toMatchObject({ exitCode: 4, stderr: { error: { code: 'invalid_response' } } })
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('reads, updates, starts, and inspects Patrol through the same Remote', async () => {
    const calls: RpcRequestBody[] = []
    const fetchImplementation = capturingFetch(calls)
    for (const command of [
      ['patrol', 'get', 'workspace-1'],
      [
        'patrol', 'update', 'workspace-1', '--enabled', 'true', '--interval', '30m',
        '--base-branch', 'main', '--agent-preset', 'coding', '--provider', 'deepseek',
        '--model', 'deepseek-chat', '--reasoning-effort', 'high',
        '--permission-preset', 'workspace-write', '--if-version', '3',
      ],
      [
        'patrol', 'update', 'workspace-1', '--enabled', 'false', '--base-branch=',
        '--agent-preset=', '--provider=', '--model=', '--reasoning-effort=', '--if-version', '4',
      ],
      ['patrol', 'run', 'workspace-1', '--issue', 'TASK-7'],
      ['patrol', 'run', 'workspace-1'],
      ['patrol', 'issue', 'TASK-7'],
      ['patrol', 'cleanup', 'TASK-7', '--workspace', 'workspace-1', '--confirm'],
    ]) {
      expect((await run(command, fetchImplementation)).exitCode).toBe(0)
    }
    expect(calls.map(call => ({ method: call.method, args: call.payload.args }))).toEqual([
      { method: 'taskboard/patrol', args: { workspaceId: 'workspace-1' } },
      { method: 'taskboard/updatePatrol', args: { input: {
        workspaceId: 'workspace-1',
        enabled: true,
        interval: '30m',
        baseBranch: 'main',
        agentPreset: 'coding',
        provider: 'deepseek',
        model: 'deepseek-chat',
        reasoningEffort: 'high',
        permissionPreset: 'workspace-write',
        expectedVersion: 3,
      } } },
      { method: 'taskboard/updatePatrol', args: { input: {
        workspaceId: 'workspace-1',
        enabled: false,
        baseBranch: null,
        agentPreset: null,
        provider: null,
        model: null,
        reasoningEffort: null,
        expectedVersion: 4,
      } } },
      { method: 'taskboard/runPatrol', args: { input: { workspaceId: 'workspace-1', issue: 'TASK-7' } } },
      { method: 'taskboard/runPatrol', args: { input: { workspaceId: 'workspace-1' } } },
      { method: 'taskboard/patrolIssue', args: { reference: 'TASK-7' } },
      { method: 'taskboard/removePatrolWorktree', args: { input: {
        workspaceId: 'workspace-1', reference: 'TASK-7', confirmed: true,
      } } },
    ])
  })

  it('returns stable JSON usage failures for invalid commands and values', async () => {
    const unreachableFetch: typeof fetch = () => Promise.reject(new Error('must not fetch'))
    for (const [argv, message] of [
      [[], 'Expected workspace'],
      [['issue', 'get', 'TASK-1', '--wat', 'value'], 'Option --wat is not valid'],
      [['issue', 'get'], 'Expected 1 operand'],
      [['issue', 'list', 'extra', '--workspace', 'workspace-1'], 'Expected 0 operands'],
      [['issue', 'list'], 'Option --workspace is required'],
      [['issue', 'list', '--workspace='], 'Option --workspace is required'],
      [['issue', 'list', '--workspace', 'workspace-1', '--status', 'ready'], 'Invalid --status'],
      [['issue', 'list', '--workspace', 'workspace-1', '--archived', 'yes'], 'Invalid --archived'],
      [['issue', 'update', 'TASK-1', '--if-version', '1.5'], 'Option --if-version requires an integer'],
      [['issue', 'update', 'TASK-1', '--if-version', '0'], 'Option --if-version requires a positive integer'],
      [['issue', 'update', 'TASK-1'], 'Option --if-version requires a positive integer'],
      [['attachment', 'delete', 'TASK-1', 'attachment-1', '--if-version', '1'], 'Option --confirm is required'],
      [['issue', 'update', 'TASK-1', '--if-version', '1', '--actor-type', 'robot'], 'Invalid --actor-type'],
      [['relation', 'add', 'TASK-1', '--type', 'relates', '--issue', 'TASK-2', '--if-version', '1'], 'Invalid --type'],
      [['patrol', 'update', 'workspace-1', '--enabled', 'yes', '--if-version', '1'], 'Invalid --enabled'],
      [['patrol', 'update', 'workspace-1', '--interval', '10m', '--if-version', '1'], 'Invalid --interval'],
      [['patrol', 'cleanup', 'TASK-1', '--workspace', 'workspace-1'], 'Option --confirm is required'],
    ] as const) {
      const result = await run([...argv], unreachableFetch)
      expect(result.exitCode).toBe(2)
      const stderr = result.stderr as { error: { code: string; message: string } }
      expect(stderr.error.code).toBe('invalid_input')
      expect(stderr.error.message).toContain(message)
    }
  })

  it('maps transport and malformed response failures to stable exit codes', async () => {
    const cases: readonly [typeof fetch, number, string][] = [
      [() => Promise.reject(new Error('offline')), 3, 'service_unavailable'],
      [() => Promise.resolve(response({}, 503)), 3, 'service_unavailable'],
      [() => Promise.resolve(new Response('not-json')), 4, 'invalid_response'],
      [() => Promise.resolve(response(null)), 4, 'invalid_response'],
      [() => Promise.resolve(response([])), 4, 'invalid_response'],
      [() => Promise.resolve(response({ type: 'wrong' })), 4, 'invalid_response'],
      [() => Promise.resolve(response({ type: 'server-response', rpcId: 'wrong', result: { ok: true } })), 4, 'invalid_response'],
      [() => Promise.resolve(response({ type: 'server-response', rpcId: 'taskctl-test', result: null })), 4, 'invalid_response'],
      [() => Promise.resolve(response({ type: 'server-response', rpcId: 'taskctl-test', result: { ok: 'yes' } })), 4, 'invalid_response'],
      [() => Promise.resolve(response({
        type: 'server-response', rpcId: 'taskctl-test', result: { ok: true, value: null },
      })), 4, 'invalid_response'],
      [() => Promise.resolve(response({
        type: 'server-response', rpcId: 'taskctl-test', result: { ok: true, value: [] },
      })), 4, 'invalid_response'],
      [() => Promise.resolve(response({
        type: 'server-response', rpcId: 'taskctl-test', result: { ok: true, value: { ok: 'yes' } },
      })), 4, 'invalid_response'],
    ]
    for (const [fetchImplementation, exitCode, code] of cases) {
      const result = await run(['issue', 'get', 'TASK-1'], fetchImplementation)
      expect(result).toMatchObject({ exitCode, stderr: { error: { code } } })
    }
  })

  it('preserves carrier and domain errors while defaulting malformed error payloads', async () => {
    const values = [
      {
        result: { ok: false, error: { code: 'gateway_failure', message: 'Gateway failed' } },
        expected: { code: 'gateway_failure', message: 'Gateway failed' },
      },
      {
        result: { ok: false, error: null },
        expected: { code: 'remote_error', message: 'Taskboard Remote call failed' },
      },
      {
        result: { ok: false, error: { code: 1, message: 2 } },
        expected: { code: 'remote_error', message: 'Taskboard Remote call failed' },
      },
      {
        result: { ok: true, value: { ok: false, error: { code: 'issue_not_found', message: 'Missing' } } },
        expected: { code: 'issue_not_found', message: 'Missing' },
      },
      {
        result: { ok: true, value: { ok: false, error: null } },
        expected: { code: 'taskboard_error', message: 'Taskboard operation failed' },
      },
      {
        result: { ok: true, value: { ok: false, error: { code: 1, message: 2 } } },
        expected: { code: 'taskboard_error', message: 'Taskboard operation failed' },
      },
    ] as const
    for (const value of values) {
      const result = await run(['issue', 'get', 'TASK-1'], () => Promise.resolve(response({
        type: 'server-response', rpcId: 'taskctl-test', result: value.result,
      })))
      expect(result).toMatchObject({ exitCode: 4, stderr: { error: value.expected } })
    }
  })

  it('validates the configured Host URL before attempting a request', async () => {
    const result = await run(
      ['issue', 'get', 'TASK-1'],
      () => Promise.reject(new Error('must not fetch')),
      { DSH_TASKBOARD_URL: 'not a URL' },
    )
    expect(result).toMatchObject({ exitCode: 2, stderr: { error: { code: 'invalid_url' } } })
  })

  it('uses process defaults when no dependencies are injected', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = requestBody(init)
      expect(body.rpcId).toMatch(/^[0-9a-f-]{36}$/u)
      return rpcSuccess(body.rpcId, { ok: true, value: { issue: null } })
    })
    const priorUrl = process.env.DSH_TASKBOARD_URL
    process.env.DSH_TASKBOARD_URL = 'http://127.0.0.1:3080'
    try {
      await expect(runTaskctl(['issue', 'get', 'TASK-1'])).resolves.toBe(0)
    } finally {
      if (priorUrl === undefined) delete process.env.DSH_TASKBOARD_URL
      else process.env.DSH_TASKBOARD_URL = priorUrl
    }
    expect(stdout).toHaveBeenCalledOnce()
  })

  it('normalizes non-Error output failures into the JSON error contract', async () => {
    const stderr = capture()
    const exitCode = await runTaskctl(['issue', 'get', 'TASK-1'], {
      fetch: () => Promise.resolve(rpcSuccess('taskctl-test', { ok: true, value: {} })),
      stdout: { write() { throw 'output failed' } },
      stderr: stderr.stream,
      createRpcId: () => 'taskctl-test',
    })
    expect(exitCode).toBe(4)
    expect(stderr.json()).toMatchObject({
      error: { code: 'taskctl_error', message: 'output failed' },
    })
  })
})
