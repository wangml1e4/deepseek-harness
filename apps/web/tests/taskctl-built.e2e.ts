import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

const execFileAsync = promisify(execFile)
const TASKCTL_BIN = join(REPO_ROOT, 'apps/cli/lib/taskctl-bin.js')

interface TaskctlEnvelope {
  readonly schemaVersion: number
  readonly result?: unknown
  readonly error?: { readonly code?: string; readonly message?: string }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('taskctl result must be a JSON object')
  }
  return value as Record<string, unknown>
}

describe('built taskctl against the shipped Web Host', () => {
  let scaffold: WebScaffold

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
  })

  afterAll(async () => {
    await scaffold?.close()
  })

  async function taskctl(...args: string[]): Promise<unknown> {
    const { stdout, stderr } = await execFileAsync(process.execPath, [TASKCTL_BIN, ...args], {
      env: { ...process.env, DSH_TASKBOARD_URL: scaffold.baseUrl },
    })
    expect(stderr).toBe('')
    const envelope = JSON.parse(stdout) as TaskctlEnvelope
    expect(envelope).toMatchObject({ schemaVersion: 1 })
    if (envelope.error !== undefined) throw new Error(`${envelope.error.code}: ${envelope.error.message}`)
    return envelope.result
  }

  it('creates, reads, lists, comments, relates, and moves Issues without a TypeScript loader', async () => {
    const source = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'CLI Source')
    const targetPath = join(scaffold.workspaceCwd, 'target')
    await mkdir(targetPath)
    const target = await scaffold.ctx.workspaceRegistry.create(targetPath, 'CLI Target')

    expect(await taskctl('workspace', 'get', source.id)).toMatchObject({
      workspaceId: source.id,
      title: 'CLI Source',
      version: 1,
    })
    const first = record(await taskctl(
      'issue', 'create', '--workspace', source.id, '--title', 'First CLI Issue', '--status', 'todo',
    ))
    const second = record(await taskctl(
      'issue', 'create', '--workspace', source.id, '--title', 'Second CLI Issue', '--status', 'todo',
    ))
    expect(await taskctl('issue', 'get', String(first.identifier))).toMatchObject({
      issue: { id: first.id, title: 'First CLI Issue' },
    })
    expect(await taskctl('issue', 'list', '--workspace', source.id, '--status', 'todo')).toMatchObject({
      items: [{ id: second.id }, { id: first.id }],
    })
    expect(await taskctl('comment', 'add', String(first.identifier), '--body', 'CLI comment')).toMatchObject({
      issueId: first.id,
      body: 'CLI comment',
    })
    const related = record(await taskctl(
      'relation', 'add', String(first.identifier), '--type', 'blocks', '--issue', String(second.identifier),
      '--if-version', String(first.version),
    ))
    expect(await taskctl('relation', 'list', String(first.identifier))).toMatchObject({
      items: [{ type: 'blocks', relatedIssueId: second.id }],
    })
    const relation = record(related.relation)
    const relatedIssue = record(related.issue)
    expect(await taskctl(
      'relation', 'remove', String(first.identifier), String(relation.id),
      '--if-version', String(relatedIssue.version),
    )).toMatchObject({ version: 3 })
    expect(await taskctl(
      'issue', 'move', String(second.identifier), '--workspace', target.id,
      '--if-version', String(second.version),
    )).toMatchObject({ workspaceId: target.id, identifier: second.identifier })
    expect(relatedIssue).toMatchObject({ version: 2 })
  })
})
