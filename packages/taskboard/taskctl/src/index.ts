/**
 * JSON CLI for the Taskboard Host Remote.
 *
 * Portions of the argument-dispatch structure are adapted from Dashi Taskboard's
 * `cli/taskctl.mjs`, licensed under Apache-2.0. This version targets Harness's
 * Typert RPC envelope, Workspace identity, actor model, and domain operations.
 */

import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

/** Stable JSON output contract version. */
export const TASKCTL_SCHEMA_VERSION = 1
/** Default loopback origin of the Harness Web Host. */
export const DEFAULT_TASKBOARD_URL = 'http://127.0.0.1:3080'

const ISSUE_STATUSES = new Set([
  'backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled',
])
const ISSUE_PRIORITIES = new Set(['none', 'urgent', 'high', 'medium', 'low'])
const ISSUE_ASSIGNEES = new Set(['unassigned', 'user', 'patrol_agent'])
const RELATION_TYPES = new Set(['blocks', 'blocked_by'])
const ACTOR_TYPES = new Set(['user', 'patrol_agent', 'reviewer', 'system'])
const PATROL_INTERVALS = new Set(['5m', '30m', '1h', '2h', '6h', '12h', '24h'])
const BOOLEAN_OPTIONS = new Set(['json', 'confirm'])
const ACTOR_OPTIONS = ['actor-type', 'actor-id', 'actor-name'] as const
const COMMAND_OPTIONS = new Map<string, ReadonlySet<string>>([
  ['workspace get', new Set(['json'])],
  ['workspace prefix', new Set(['prefix', 'if-version', 'json'])],
  ['issue list', new Set(['workspace', 'status', 'priority', 'label', 'assignee', 'archived', 'query', 'json'])],
  ['issue get', new Set(['json'])],
  ['issue create', new Set(['workspace', 'title', 'description', 'status', 'priority', 'labels', 'assignee', 'start-date', 'due-date', 'json'])],
  ['issue update', new Set(['title', 'description', 'status', 'priority', 'labels', 'assignee', 'start-date', 'due-date', 'sort-order', 'return-reason', 'if-version', 'json', ...ACTOR_OPTIONS])],
  ['issue move', new Set(['workspace', 'if-version', 'json', ...ACTOR_OPTIONS])],
  ['issue archive', new Set(['if-version', 'json', ...ACTOR_OPTIONS])],
  ['issue restore', new Set(['if-version', 'json', ...ACTOR_OPTIONS])],
  ['comment list', new Set(['json'])],
  ['comment add', new Set(['body', 'json', ...ACTOR_OPTIONS])],
  ['activity list', new Set(['json'])],
  ['attachment list', new Set(['json'])],
  ['attachment add', new Set(['file', 'name', 'media-type', 'if-version', 'json', ...ACTOR_OPTIONS])],
  ['attachment download', new Set(['output', 'json'])],
  ['attachment delete', new Set(['if-version', 'confirm', 'json', ...ACTOR_OPTIONS])],
  ['relation list', new Set(['json'])],
  ['relation add', new Set(['type', 'issue', 'if-version', 'json', ...ACTOR_OPTIONS])],
  ['relation remove', new Set(['if-version', 'json', ...ACTOR_OPTIONS])],
  ['patrol get', new Set(['json'])],
  ['patrol update', new Set([
    'enabled', 'interval', 'base-branch', 'agent-preset', 'provider', 'model',
    'reasoning-effort', 'permission-preset', 'if-version', 'json',
  ])],
  ['patrol run', new Set(['issue', 'json'])],
  ['patrol issue', new Set(['json'])],
  ['patrol cleanup', new Set(['workspace', 'confirm', 'json'])],
])

type OptionValue = string | true

/** Parsed two-segment taskctl command. */
export interface ParsedTaskctlArgs {
  readonly resource: string | undefined
  readonly action: string | undefined
  readonly operands: readonly string[]
  readonly options: Readonly<Record<string, OptionValue>>
}

/** Minimal output sink accepted by tests and Node streams. */
export interface TaskctlOutput {
  write(chunk: string): unknown
}

/** Injectable process dependencies for deterministic CLI tests. */
export interface TaskctlRunOptions {
  readonly fetch?: typeof fetch
  readonly stdout?: TaskctlOutput
  readonly stderr?: TaskctlOutput
  readonly env?: NodeJS.ProcessEnv
  readonly createRpcId?: () => string
}

/** CLI failure with stable machine and process codes. */
export class TaskctlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: number,
  ) {
    super(message)
    this.name = 'TaskctlError'
  }
}

/**
 * Parse Dashi-compatible `--name value` and `--name=value` arguments.
 * @param argv - Command-line arguments after the executable name.
 * @returns the parsed two-segment command, operands, and options.
 */
export function parseTaskctlArgs(argv: readonly string[]): ParsedTaskctlArgs {
  const positionals: string[] = []
  const options: Record<string, OptionValue> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) continue
    if (token === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const equalsAt = token.indexOf('=')
    const name = token.slice(2, equalsAt === -1 ? undefined : equalsAt)
    if (name.length === 0) throw usageError('Invalid empty option')
    if (Object.hasOwn(options, name)) throw usageError(`Option --${name} may only be specified once`)
    if (BOOLEAN_OPTIONS.has(name)) {
      if (equalsAt !== -1) throw usageError(`Option --${name} does not accept a value`)
      options[name] = true
      continue
    }
    if (equalsAt !== -1) {
      options[name] = token.slice(equalsAt + 1)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw usageError(`Option --${name} requires a value`)
    options[name] = value
    index += 1
  }
  return {
    resource: positionals[0],
    action: positionals[1],
    operands: positionals.slice(2),
    options,
  }
}

/**
 * Execute one command and emit exactly one JSON object.
 * @param argv - Command-line arguments after the executable name.
 * @param overrides - Optional process dependencies for tests and embeddings.
 * @returns the process exit code for the completed command.
 */
export async function runTaskctl(
  argv: readonly string[],
  overrides: TaskctlRunOptions = {},
): Promise<number> {
  const stdout = overrides.stdout ?? process.stdout
  const stderr = overrides.stderr ?? process.stderr
  try {
    const parsed = parseTaskctlArgs(argv)
    const value = await execute(parsed, overrides)
    writeJson(stdout, { schemaVersion: TASKCTL_SCHEMA_VERSION, result: value })
    return 0
  } catch (error) {
    const normalized = normalizeError(error)
    writeJson(stderr, {
      schemaVersion: TASKCTL_SCHEMA_VERSION,
      error: { code: normalized.code, message: normalized.message },
    })
    return normalized.exitCode
  }
}

async function execute(parsed: ParsedTaskctlArgs, overrides: TaskctlRunOptions): Promise<unknown> {
  const command = `${parsed.resource ?? ''} ${parsed.action ?? ''}`.trim()
  const allowed = COMMAND_OPTIONS.get(command)
  if (allowed === undefined) {
    throw usageError('Expected workspace, issue, comment, activity, attachment, relation, or patrol command')
  }
  validateOptions(parsed.options, allowed)
  const client = new TaskboardRpcClient(overrides)
  const environment = overrides.env ?? process.env
  switch (command) {
    case 'workspace get':
      expectOperands(parsed, 1)
      return client.call('workspace', { workspaceId: parsed.operands[0] })
    case 'workspace prefix':
      expectOperands(parsed, 1)
      return client.call('setPrefix', { input: {
        workspaceId: parsed.operands[0],
        prefix: requiredOption(parsed, 'prefix'),
        expectedVersion: requiredVersion(parsed),
      } })
    case 'issue list':
      expectOperands(parsed, 0)
      return client.call('listIssues', { input: compact({
        workspaceId: requiredOption(parsed, 'workspace'),
        status: enumOption(parsed, 'status', ISSUE_STATUSES),
        priority: enumOption(parsed, 'priority', ISSUE_PRIORITIES),
        label: stringOption(parsed, 'label'),
        assignee: enumOption(parsed, 'assignee', ISSUE_ASSIGNEES),
        archived: archivedOption(parsed),
        query: stringOption(parsed, 'query'),
      }) })
    case 'issue get':
      expectOperands(parsed, 1)
      return client.call('getIssue', { reference: parsed.operands[0] })
    case 'issue create':
      expectOperands(parsed, 0)
      return client.call('createIssue', { input: compact({
        workspaceId: requiredOption(parsed, 'workspace'),
        title: requiredOption(parsed, 'title'),
        description: stringOption(parsed, 'description'),
        status: enumOption(parsed, 'status', ISSUE_STATUSES),
        priority: enumOption(parsed, 'priority', ISSUE_PRIORITIES),
        labels: labelsOption(parsed),
        assignee: enumOption(parsed, 'assignee', ISSUE_ASSIGNEES),
        startDate: stringOption(parsed, 'start-date'),
        dueDate: stringOption(parsed, 'due-date'),
      }) })
    case 'issue update':
      expectOperands(parsed, 1)
      return client.call('updateIssue', { input: compact({
        reference: parsed.operands[0],
        expectedVersion: requiredVersion(parsed),
        title: stringOption(parsed, 'title'),
        description: stringOption(parsed, 'description'),
        status: enumOption(parsed, 'status', ISSUE_STATUSES),
        priority: enumOption(parsed, 'priority', ISSUE_PRIORITIES),
        labels: labelsOption(parsed),
        assignee: enumOption(parsed, 'assignee', ISSUE_ASSIGNEES),
        startDate: nullableStringOption(parsed, 'start-date'),
        dueDate: nullableStringOption(parsed, 'due-date'),
        sortOrder: numberOption(parsed, 'sort-order'),
        reason: stringOption(parsed, 'return-reason'),
        actor: resolveActor(parsed, environment),
      }) })
    case 'issue move':
      expectOperands(parsed, 1)
      return client.call('moveIssue', { input: {
        reference: parsed.operands[0],
        targetWorkspaceId: requiredOption(parsed, 'workspace'),
        expectedVersion: requiredVersion(parsed),
        actor: resolveActor(parsed, environment),
      } })
    case 'issue archive':
    case 'issue restore':
      expectOperands(parsed, 1)
      return client.call(command === 'issue archive' ? 'archiveIssue' : 'restoreIssue', { input: {
        reference: parsed.operands[0],
        expectedVersion: requiredVersion(parsed),
        actor: resolveActor(parsed, environment),
      } })
    case 'comment list':
      expectOperands(parsed, 1)
      return client.call('listComments', { reference: parsed.operands[0] })
    case 'comment add':
      expectOperands(parsed, 1)
      return client.call('addComment', { input: {
        reference: parsed.operands[0],
        body: requiredOption(parsed, 'body'),
        actor: resolveActor(parsed, environment),
      } })
    case 'activity list':
      expectOperands(parsed, 1)
      return client.call('listActivities', { reference: parsed.operands[0] })
    case 'attachment list':
      expectOperands(parsed, 1)
      return client.call('listAttachments', { reference: parsed.operands[0] })
    case 'attachment add': {
      expectOperands(parsed, 1)
      const file = resolve(requiredOption(parsed, 'file'))
      const data = await readFile(file)
      return client.call('addAttachment', { input: {
        reference: parsed.operands[0],
        expectedVersion: requiredVersion(parsed),
        name: stringOption(parsed, 'name') ?? basename(file),
        mediaType: stringOption(parsed, 'media-type') ?? 'application/octet-stream',
        data: data.toString('base64'),
        actor: resolveActor(parsed, environment),
      } })
    }
    case 'attachment download': {
      expectOperands(parsed, 2)
      const value = attachmentContent(await client.call('readAttachment', { input: {
        reference: parsed.operands[0],
        attachmentId: parsed.operands[1],
      } }))
      const output = resolve(requiredOption(parsed, 'output'))
      await writeFile(output, Buffer.from(value.data, 'base64'), { flag: 'wx', mode: 0o600 })
      return { attachment: value.attachment, output }
    }
    case 'attachment delete':
      expectOperands(parsed, 2)
      if (parsed.options.confirm !== true) throw usageError('Option --confirm is required')
      return client.call('deleteAttachment', { input: {
        reference: parsed.operands[0],
        attachmentId: parsed.operands[1],
        expectedVersion: requiredVersion(parsed),
        confirmed: true,
        actor: resolveActor(parsed, environment),
      } })
    case 'relation list':
      expectOperands(parsed, 1)
      return client.call('listRelations', { reference: parsed.operands[0] })
    case 'relation add':
      expectOperands(parsed, 1)
      return client.call('addRelation', { input: {
        reference: parsed.operands[0],
        type: requiredEnumOption(parsed, 'type', RELATION_TYPES),
        relatedReference: requiredOption(parsed, 'issue'),
        expectedVersion: requiredVersion(parsed),
        actor: resolveActor(parsed, environment),
      } })
    case 'relation remove':
      expectOperands(parsed, 2)
      return client.call('removeRelation', { input: {
        reference: parsed.operands[0],
        relationId: parsed.operands[1],
        expectedVersion: requiredVersion(parsed),
        actor: resolveActor(parsed, environment),
      } })
    case 'patrol get':
      expectOperands(parsed, 1)
      return client.call('patrol', { workspaceId: parsed.operands[0] })
    case 'patrol update':
      expectOperands(parsed, 1)
      return client.call('updatePatrol', { input: compact({
        workspaceId: parsed.operands[0],
        enabled: booleanOption(parsed, 'enabled'),
        interval: enumOption(parsed, 'interval', PATROL_INTERVALS),
        baseBranch: nullableStringOption(parsed, 'base-branch'),
        agentPreset: nullableStringOption(parsed, 'agent-preset'),
        provider: nullableStringOption(parsed, 'provider'),
        model: nullableStringOption(parsed, 'model'),
        reasoningEffort: nullableStringOption(parsed, 'reasoning-effort'),
        permissionPreset: stringOption(parsed, 'permission-preset'),
        expectedVersion: requiredVersion(parsed),
      }) })
    case 'patrol run':
      expectOperands(parsed, 1)
      return client.call('runPatrol', { input: compact({
        workspaceId: parsed.operands[0],
        issue: stringOption(parsed, 'issue'),
      }) })
    case 'patrol issue':
      expectOperands(parsed, 1)
      return client.call('patrolIssue', { reference: parsed.operands[0] })
    case 'patrol cleanup':
      expectOperands(parsed, 1)
      if (parsed.options.confirm !== true) throw usageError('Option --confirm is required')
      return client.call('removePatrolWorktree', { input: {
        workspaceId: requiredOption(parsed, 'workspace'),
        reference: parsed.operands[0],
        confirmed: true,
      } })
    /* v8 ignore next 2 -- COMMAND_OPTIONS rejects every command absent from the exhaustive switch. */
    default:
      throw new Error(`Unhandled taskctl command ${JSON.stringify(command)}`)
  }
}

/** Validate the attachment content needed for a local download write. */
function attachmentContent(value: unknown): {
  attachment: { id: string; name: string; mediaType: string }
  data: string
} {
  if (!isRecord(value) || !isRecord(value.attachment)
    || typeof value.attachment.id !== 'string'
    || typeof value.attachment.name !== 'string'
    || typeof value.attachment.mediaType !== 'string'
    || typeof value.data !== 'string') {
    throw new TaskctlError('invalid_response', 'Taskboard Host returned invalid attachment content', 4)
  }
  const bytes = Buffer.from(value.data, 'base64')
  if (bytes.toString('base64') !== value.data) {
    throw new TaskctlError('invalid_response', 'Taskboard Host returned invalid attachment bytes', 4)
  }
  return {
    attachment: {
      id: value.attachment.id,
      name: value.attachment.name,
      mediaType: value.attachment.mediaType,
    },
    data: value.data,
  }
}

class TaskboardRpcClient {
  private readonly request: typeof fetch
  private readonly origin: URL
  private readonly createRpcId: () => string

  constructor(options: TaskctlRunOptions) {
    this.request = options.fetch ?? fetch
    this.createRpcId = options.createRpcId ?? randomUUID
    const configured = options.env?.DSH_TASKBOARD_URL ?? process.env.DSH_TASKBOARD_URL ?? DEFAULT_TASKBOARD_URL
    try {
      this.origin = new URL(configured.endsWith('/') ? configured : `${configured}/`)
    } catch (error) {
      throw new TaskctlError('invalid_url', `Invalid DSH_TASKBOARD_URL: ${errorMessage(error)}`, 2)
    }
  }

  async call(method: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const rpcId = this.createRpcId()
    const endpoint = `taskboard/${method}`
    let response: Response
    try {
      response = await this.request(new URL(`api/${endpoint}`, this.origin), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-taskboard-client': 'taskctl',
        },
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: endpoint,
          payload: { args },
        }),
      })
    } catch (error) {
      throw new TaskctlError('service_unavailable', `Taskboard Host is unavailable: ${errorMessage(error)}`, 3)
    }
    if (!response.ok) {
      throw new TaskctlError('service_unavailable', `Taskboard Host returned HTTP ${response.status}`, 3)
    }
    const envelope = await parseResponse(response)
    if (!isRecord(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !isRecord(envelope.result) || typeof envelope.result.ok !== 'boolean') {
      throw new TaskctlError('invalid_response', 'Taskboard Host returned an invalid RPC envelope', 4)
    }
    if (!envelope.result.ok) {
      const carrier = isRecord(envelope.result.error) ? envelope.result.error : undefined
      throw new TaskctlError(
        typeof carrier?.code === 'string' ? carrier.code : 'remote_error',
        typeof carrier?.message === 'string' ? carrier.message : 'Taskboard Remote call failed',
        4,
      )
    }
    const business = envelope.result.value
    if (!isRecord(business) || typeof business.ok !== 'boolean') {
      throw new TaskctlError('invalid_response', 'Taskboard Remote returned an invalid business result', 4)
    }
    if (!business.ok) {
      const failure = isRecord(business.error) ? business.error : undefined
      const code = typeof failure?.code === 'string' ? failure.code : 'taskboard_error'
      const message = typeof failure?.message === 'string' ? failure.message : 'Taskboard operation failed'
      throw new TaskctlError(code, message, code === 'version_conflict' ? 5 : 4)
    }
    return business.value
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch (error) {
    throw new TaskctlError('invalid_response', `Taskboard Host returned invalid JSON: ${errorMessage(error)}`, 4)
  }
}

function resolveActor(parsed: ParsedTaskctlArgs, env: NodeJS.ProcessEnv) {
  const type = stringOption(parsed, 'actor-type') ?? env.DSH_TASKBOARD_ACTOR_TYPE ?? 'user'
  if (!ACTOR_TYPES.has(type)) throw usageError(`Invalid --actor-type '${type}'`)
  const sessionId = env.CODEX_THREAD_ID
  return {
    type,
    id: stringOption(parsed, 'actor-id') ?? env.DSH_TASKBOARD_ACTOR_ID ?? sessionId ?? 'local-user',
    name: stringOption(parsed, 'actor-name') ?? env.DSH_TASKBOARD_ACTOR_NAME
      ?? (sessionId === undefined ? 'Local User' : 'Interactive Agent'),
  }
}

function validateOptions(options: Readonly<Record<string, OptionValue>>, allowed: ReadonlySet<string>): void {
  for (const name of Object.keys(options)) {
    if (!allowed.has(name)) throw usageError(`Option --${name} is not valid for this command`)
  }
}

function expectOperands(parsed: ParsedTaskctlArgs, expected: number): void {
  if (parsed.operands.length !== expected) {
    throw usageError(`Expected ${expected} operand${expected === 1 ? '' : 's'}, received ${parsed.operands.length}`)
  }
}

function requiredOption(parsed: ParsedTaskctlArgs, name: string): string {
  const value = stringOption(parsed, name)
  if (value === undefined || value.length === 0) throw usageError(`Option --${name} is required`)
  return value
}

function stringOption(parsed: ParsedTaskctlArgs, name: string): string | undefined {
  const value = parsed.options[name]
  return typeof value === 'string' ? value : undefined
}

function nullableStringOption(parsed: ParsedTaskctlArgs, name: string): string | null | undefined {
  const value = stringOption(parsed, name)
  return value === '' ? null : value
}

function requiredVersion(parsed: ParsedTaskctlArgs): number {
  const value = numberOption(parsed, 'if-version')
  if (value === undefined || value < 1) throw usageError('Option --if-version requires a positive integer')
  return value
}

function numberOption(parsed: ParsedTaskctlArgs, name: string): number | undefined {
  const raw = stringOption(parsed, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw usageError(`Option --${name} requires an integer`)
  return value
}

function booleanOption(parsed: ParsedTaskctlArgs, name: string): boolean | undefined {
  const value = stringOption(parsed, name)
  if (value === undefined) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  throw usageError(`Invalid --${name} '${value}'; expected true or false`)
}

function enumOption(parsed: ParsedTaskctlArgs, name: string, values: ReadonlySet<string>): string | undefined {
  const value = stringOption(parsed, name)
  if (value !== undefined && !values.has(value)) {
    throw usageError(`Invalid --${name} '${value}'; expected ${[...values].join(', ')}`)
  }
  return value
}

function requiredEnumOption(parsed: ParsedTaskctlArgs, name: string, values: ReadonlySet<string>): string {
  const value = requiredOption(parsed, name)
  if (!values.has(value)) throw usageError(`Invalid --${name} '${value}'; expected ${[...values].join(', ')}`)
  return value
}

function archivedOption(parsed: ParsedTaskctlArgs): string | undefined {
  const value = stringOption(parsed, 'archived')
  if (value !== undefined && !new Set(['exclude', 'include', 'only']).has(value)) {
    throw usageError(`Invalid --archived '${value}'; expected exclude, include, or only`)
  }
  return value
}

function labelsOption(parsed: ParsedTaskctlArgs): readonly string[] | undefined {
  const raw = stringOption(parsed, 'labels')
  if (raw === undefined) return undefined
  return [...new Set(raw.split(',').map(label => label.trim()).filter(Boolean))]
}

function compact(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function usageError(message: string): TaskctlError {
  return new TaskctlError('invalid_input', message, 2)
}

function normalizeError(error: unknown): TaskctlError {
  return error instanceof TaskctlError
    ? error
    : new TaskctlError('taskctl_error', errorMessage(error), 4)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function writeJson(output: TaskctlOutput, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`)
}
