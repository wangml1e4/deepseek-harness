/** SQLite Provider for the Workspace-owned Taskboard service. */

import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  ActivityId,
  CommentId,
  IssueId,
  IssueIdentifier,
  PatrolAttemptId,
  PatrolRunId,
  RelationId,
  TaskboardError,
  TaskboardService,
  DEFAULT_PATROL_INTERVAL,
  nextPatrolCadence,
  nextPatrolDueAfterSave,
} from '@deepseek-ai/dsh-taskboard'
import type {
  Activity,
  ActivityChange,
  AddCommentInput,
  AddIssueRelationInput,
  BindPatrolDevelopmentContextInput,
  BeginPatrolRunInput,
  ClaimPatrolIssueInput,
  Comment,
  CompletePatrolAttemptInput,
  CompletePatrolRunInput,
  CreateIssueInput,
  EnsureWorkspaceInput,
  FailPatrolRecoveryInput,
  Issue,
  IssueReference,
  IssueRelation,
  IssueRelationMutation,
  ListIssuesInput,
  MoveIssueInput,
  PatrolAttempt,
  PatrolDevelopmentContext,
  PatrolPolicy,
  PatrolReview,
  RecordPatrolReviewInput,
  PatrolRun,
  RemoveIssueRelationInput,
  SetWorkspacePrefixInput,
  UpdateIssueInput,
  UpdatePatrolPolicyInput,
  VersionedIssueInput,
  WorkspaceTaskboard,
  TaskboardActor,
} from '@deepseek-ai/dsh-taskboard'
import {
  openTaskboardDatabase,
  rowToActivity,
  rowToComment,
  rowToIssue,
  rowToPatrolPolicy,
  rowToPatrolAttempt,
  rowToPatrolDevelopmentContext,
  rowToPatrolRun,
  rowToPatrolReview,
  rowToRelation,
  rowToWorkspace,
  type ActivityRow,
  type CommentRow,
  type IssueRow,
  type JournalMode,
  type PatrolPolicyRow,
  type PatrolAttemptRow,
  type PatrolDevelopmentContextRow,
  type PatrolRunRow,
  type PatrolReviewRow,
  type RelationRow,
  type WorkspaceRow,
} from './schema.ts'
import type { DatabaseSync } from 'node:sqlite'

export { SCHEMA_VERSION, TASKBOARD_SQLITE_APPLICATION_ID } from './schema.ts'

/** Default time SQLite waits for another writer before returning busy. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000
/** Default durable SQLite journal mode. */
export const DEFAULT_JOURNAL_MODE: JournalMode = 'wal'
/** Dashi-compatible maximum Issue prefix length. */
export const MAX_ISSUE_PREFIX_LENGTH = 12

/** SQLite Taskboard Provider configuration. */
export interface Config {
  /** SQLite file path, or `:memory:` for an in-process store. */
  path: string
  /** Durable SQLite journal mode. */
  journalMode?: JournalMode
  /** Maximum wait for a concurrent SQLite writer. */
  busyTimeoutMs?: number
}

interface ResolvedConfig {
  path: string
  journalMode: JournalMode
  busyTimeoutMs: number
}

/** Resolve optional deployment settings before the Provider opens its database. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    path: config.path,
    journalMode: config.journalMode ?? DEFAULT_JOURNAL_MODE,
    busyTimeoutMs: config.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
  }
}

/** Assert a row written by the current transaction can be read back. */
function requireStored<T>(value: T | undefined, subject: string): T {
  /* v8 ignore next -- callers invoke this only after a successful same-transaction write. */
  if (value === undefined) throw new Error(`SQLite Taskboard failed to read stored ${subject}`)
  return value
}

/** Exclusively create a missing owner-only database file. */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Derive the initial Dashi-compatible prefix from a Workspace title. */
function derivePrefix(title: string): string {
  const prefix = title.toUpperCase().replace(/[^A-Z0-9]+/g, '')
  return (prefix || 'TASK').slice(0, MAX_ISSUE_PREFIX_LENGTH)
}

/** Roll back a failed mutation while its write transaction still owns the connection. */
function rollback(db: DatabaseSync): void {
  /* v8 ignore else -- mutation failures occur before COMMIT; a post-COMMIT SQLite fault requires database corruption. */
  if (db.isTransaction) db.exec('ROLLBACK')
}

/** Replace one Issue's ordered labels while reusing its Workspace label records. */
function replaceLabels(
  db: DatabaseSync,
  workspaceId: string,
  issueId: IssueId,
  labels: readonly string[],
): void {
  db.prepare('DELETE FROM issue_labels WHERE issue_id = ?').run(issueId)
  const ensureLabel = db.prepare(`
    INSERT INTO labels (workspace_id, name)
    VALUES (?, ?)
    ON CONFLICT (workspace_id, name) DO NOTHING
  `)
  const findLabel = db.prepare('SELECT id FROM labels WHERE workspace_id = ? AND name = ?')
  const attachLabel = db.prepare(`
    INSERT INTO issue_labels (issue_id, label_id, sequence)
    VALUES (?, ?, ?)
  `)
  for (const [sequence, name] of labels.entries()) {
    ensureLabel.run(workspaceId, name)
    const label = findLabel.get(workspaceId, name) as { id: number }
    attachLabel.run(issueId, label.id, sequence)
  }
}

/** Local SQLite implementation of {@link TaskboardService}. */
export class SqliteTaskboard extends TaskboardService {
  static Config: z<Config> = z.object({
    path: z.string().required(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default(DEFAULT_JOURNAL_MODE),
    busyTimeoutMs: z.number().step(1).min(0).default(DEFAULT_BUSY_TIMEOUT_MS),
  })

  private db: DatabaseSync | undefined
  private readonly resolvedConfig: ResolvedConfig

  constructor(ctx: Context, readonly config: Config) {
    super(ctx)
    this.resolvedConfig = resolveConfig(config)
  }

  /** Create directories, open the database, and bind handle cleanup to the plugin fiber. */
  protected async [Service.init](): Promise<void> {
    const actual = this.resolvedConfig.path === ':memory:'
      ? this.resolvedConfig.path
      : resolve(this.resolvedConfig.path)
    if (actual !== ':memory:') {
      await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
      await createDatabaseFile(actual)
    }
    this.db = openTaskboardDatabase(
      actual,
      this.resolvedConfig.journalMode,
      this.resolvedConfig.busyTimeoutMs,
    )
    this.ctx.effect(() => () => {
      this.db?.close()
      this.db = undefined
    }, 'taskboardSqlite.close()')
  }

  async ensureWorkspace(input: EnsureWorkspaceInput): Promise<WorkspaceTaskboard> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const existingRow = db.prepare(`
        SELECT workspace_id, title, prefix, version, created_at, updated_at
        FROM taskboards
        WHERE workspace_id = ?
      `).get(input.workspaceId) as WorkspaceRow | undefined
      if (existingRow !== undefined) {
        db.exec('COMMIT')
        return rowToWorkspace(existingRow)
      }
      const timestamp = new Date().toISOString()
      const prefix = this.allocatePrefix(input.title)
      db.prepare(`
        INSERT INTO taskboards (
          workspace_id, title, prefix, next_issue_number, version, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 1, ?, ?)
      `).run(input.workspaceId, input.title, prefix, timestamp, timestamp)
      db.prepare(`
        INSERT INTO patrol_policies (
          workspace_id, enabled, interval, base_branch, agent_preset, provider,
          model, reasoning_effort, permission_preset, next_due_at, version, created_at, updated_at
        ) VALUES (?, 0, ?, NULL, NULL, NULL, NULL, NULL, 'workspace-write', NULL, 1, ?, ?)
      `).run(input.workspaceId, DEFAULT_PATROL_INTERVAL, timestamp, timestamp)
      db.exec('COMMIT')
      const stored = requireStored(await this.getWorkspace(input.workspaceId), 'Workspace Taskboard')
      this.notifyChanged(input.workspaceId)
      return stored
    } catch (error: unknown) {
      /* v8 ignore start -- allocator output satisfies the schema; this retains rollback for storage faults. */
      rollback(db)
      throw error
      /* v8 ignore stop */
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async getWorkspace(workspaceId: EnsureWorkspaceInput['workspaceId']): Promise<WorkspaceTaskboard | undefined> {
    const row = this.database().prepare(`
      SELECT workspace_id, title, prefix, version, created_at, updated_at
      FROM taskboards
      WHERE workspace_id = ?
    `).get(workspaceId) as WorkspaceRow | undefined
    return row === undefined ? undefined : rowToWorkspace(row)
  }

  async setWorkspacePrefix(input: SetWorkspacePrefixInput): Promise<WorkspaceTaskboard> {
    if (!new RegExp(`^[A-Z0-9]{1,${MAX_ISSUE_PREFIX_LENGTH}}$`).test(input.prefix)) {
      throw new TaskboardError(
        'invalid_prefix',
        `Taskboard prefix must contain 1-${MAX_ISSUE_PREFIX_LENGTH} uppercase ASCII letters or digits`,
      )
    }
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = db.prepare(`
        SELECT version, next_issue_number
        FROM taskboards
        WHERE workspace_id = ?
      `).get(input.workspaceId) as { version: number; next_issue_number: number } | undefined
      if (current === undefined) {
        throw new TaskboardError(
          'workspace_not_found',
          `cannot change prefix: Workspace '${input.workspaceId}' has no Taskboard`,
        )
      }
      if (current.version !== input.expectedVersion) {
        throw new TaskboardError(
          'version_conflict',
          `cannot change prefix: expected Taskboard version ${input.expectedVersion}, found ${current.version}`,
        )
      }
      if (current.next_issue_number !== 1) {
        throw new TaskboardError(
          'prefix_frozen',
          `cannot change prefix for Workspace '${input.workspaceId}' after its first Issue`,
        )
      }
      const duplicate = db.prepare(`
        SELECT 1 FROM taskboards WHERE prefix = ? AND workspace_id != ?
      `).get(input.prefix, input.workspaceId)
      if (duplicate !== undefined) {
        throw new TaskboardError('prefix_exists', `Taskboard prefix '${input.prefix}' is already in use`)
      }
      const timestamp = new Date().toISOString()
      db.prepare(`
        UPDATE taskboards
        SET prefix = ?, version = version + 1, updated_at = ?
        WHERE workspace_id = ? AND version = ?
      `).run(input.prefix, timestamp, input.workspaceId, input.expectedVersion)
      db.exec('COMMIT')
      const stored = requireStored(await this.getWorkspace(input.workspaceId), 'Workspace Taskboard')
      this.notifyChanged(input.workspaceId)
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const workspace = db.prepare(`
        SELECT workspace_id, prefix, next_issue_number
        FROM taskboards
        WHERE workspace_id = ?
      `).get(input.workspaceId) as {
        workspace_id: string
        prefix: string
        next_issue_number: number
      } | undefined
      if (workspace === undefined) {
        throw new TaskboardError(
          'workspace_not_found',
          `cannot create Issue: Workspace '${input.workspaceId}' has no Taskboard`,
        )
      }
      const timestamp = new Date().toISOString()
      const identifier = IssueIdentifier(`${workspace.prefix}-${workspace.next_issue_number}`)
      const id = IssueId(randomUUID())
      const status = input.status ?? 'backlog'
      const description = input.description ?? ''
      const priority = input.priority ?? 'none'
      const labels = [...new Set(input.labels ?? [])]
      const assignee = input.assignee ?? 'unassigned'
      const row = db.prepare(`
        SELECT MIN(sort_order) AS minimum
        FROM issues
        WHERE workspace_id = ? AND status = ? AND archived_at IS NULL
      `).get(input.workspaceId, status) as { minimum: number | null }
      const sortOrder = row.minimum === null ? 1000 : row.minimum - 1000
      db.prepare(`
        UPDATE taskboards
        SET next_issue_number = next_issue_number + 1, version = version + 1, updated_at = ?
        WHERE workspace_id = ?
      `).run(timestamp, input.workspaceId)
      db.prepare(`
        INSERT INTO issues (
          id, identifier, workspace_id, title, description, status, priority,
          assignee, start_date, due_date, sort_order, version, archived_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
      `).run(
        id,
        identifier,
        input.workspaceId,
        input.title,
        description,
        status,
        priority,
        assignee,
        input.startDate ?? null,
        input.dueDate ?? null,
        sortOrder,
        timestamp,
        timestamp,
      )
      replaceLabels(db, input.workspaceId, id, labels)
      db.exec('COMMIT')
      const stored = requireStored(await this.getIssue(id), 'Issue')
      this.notifyChanged(input.workspaceId)
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async listIssues(input: ListIssuesInput): Promise<readonly Issue[]> {
    const clauses = ['workspace_id = ?']
    const values: string[] = [input.workspaceId]
    if (input.archived === 'only') clauses.push('archived_at IS NOT NULL')
    else if (input.archived !== 'include') clauses.push('archived_at IS NULL')
    if (input.status !== undefined) {
      clauses.push('status = ?')
      values.push(input.status)
    }
    if (input.priority !== undefined) {
      clauses.push('priority = ?')
      values.push(input.priority)
    }
    if (input.label !== undefined) {
      clauses.push(`EXISTS (
        SELECT 1
        FROM issue_labels
        JOIN labels ON labels.id = issue_labels.label_id
        WHERE issue_labels.issue_id = issues.id AND labels.name = ?
      )`)
      values.push(input.label)
    }
    if (input.assignee !== undefined) {
      clauses.push('assignee = ?')
      values.push(input.assignee)
    }
    if (input.startDate !== undefined) {
      clauses.push('start_date = ?')
      values.push(input.startDate)
    }
    if (input.dueDate !== undefined) {
      clauses.push('due_date = ?')
      values.push(input.dueDate)
    }
    if (input.query !== undefined) {
      clauses.push(`(
        instr(lower(identifier), lower(?)) > 0 OR
        instr(lower(title), lower(?)) > 0 OR
        instr(lower(description), lower(?)) > 0
      )`)
      values.push(input.query, input.query, input.query)
    }
    const rows = this.database().prepare(`
      SELECT id, identifier, workspace_id, title, description, status, priority,
             labels, assignee, start_date, due_date, sort_order, version,
             archived_at, created_at, updated_at
      FROM issue_records AS issues
      WHERE ${clauses.join(' AND ')}
      ORDER BY status, sort_order, created_at, id
    `).all(...values)
    return (rows as unknown as IssueRow[]).map(rowToIssue)
  }

  async updateIssue(input: UpdateIssueInput): Promise<Issue> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = db.prepare(`
        SELECT id, workspace_id, title, description, status, priority, labels,
               assignee, start_date, due_date, sort_order, version, archived_at
        FROM issue_records
        WHERE id = ? OR identifier = ?
      `).get(input.reference, input.reference) as {
        id: string
        workspace_id: string
        title: string
        description: string
        status: Issue['status']
        priority: Issue['priority']
        labels: string
        assignee: Issue['assignee']
        start_date: string | null
        due_date: string | null
        sort_order: number
        version: number
        archived_at: string | null
      } | undefined
      if (current === undefined) {
        throw new TaskboardError('issue_not_found', `cannot update missing Issue '${input.reference}'`)
      }
      if (current.version !== input.expectedVersion) {
        throw new TaskboardError(
          'version_conflict',
          `cannot update Issue '${input.reference}': expected version ${input.expectedVersion}, found ${current.version}`,
        )
      }
      if (current.archived_at !== null) {
        throw new TaskboardError('issue_archived', `cannot update archived Issue '${input.reference}'`)
      }
      const status = input.status ?? current.status
      const returnsToTodo = status === 'todo'
        && (current.status === 'in_review' || current.status === 'blocked' || current.status === 'done')
      if (returnsToTodo && (input.reason === undefined || input.reason.trim().length === 0)) {
        throw new TaskboardError(
          'reason_required',
          `returning Issue '${input.reference}' from ${current.status} to todo requires a reason`,
        )
      }
      const returnReason = returnsToTodo ? input.reason : undefined
      const title = input.title ?? current.title
      const description = input.description ?? current.description
      const priority = input.priority ?? current.priority
      const currentLabels = JSON.parse(current.labels) as string[]
      const labels = input.labels === undefined ? currentLabels : [...new Set(input.labels)]
      const assignee = input.assignee ?? current.assignee
      const startDate = input.startDate === undefined ? current.start_date : input.startDate
      const dueDate = input.dueDate === undefined ? current.due_date : input.dueDate
      let sortOrder = input.sortOrder ?? current.sort_order
      if (input.sortOrder === undefined && current.status !== status) {
        const row = db.prepare(`
          SELECT MIN(sort_order) AS minimum
          FROM issues
          WHERE workspace_id = ? AND status = ? AND archived_at IS NULL
        `).get(current.workspace_id, status) as { minimum: number | null }
        sortOrder = row.minimum === null ? 1000 : row.minimum - 1000
      }
      const changes: ActivityChange[] = []
      if (current.title !== title) changes.push({ field: 'title', before: current.title, after: title })
      if (current.description !== description) {
        changes.push({ field: 'description', before: current.description, after: description })
      }
      if (current.status !== status) {
        changes.push({ field: 'status', before: current.status, after: status })
      }
      if (current.priority !== priority) {
        changes.push({ field: 'priority', before: current.priority, after: priority })
      }
      if (current.labels !== JSON.stringify(labels)) {
        changes.push({ field: 'labels', before: currentLabels, after: labels })
      }
      if (current.assignee !== assignee) {
        changes.push({ field: 'assignee', before: current.assignee, after: assignee })
      }
      if (current.start_date !== startDate) {
        changes.push({ field: 'startDate', before: current.start_date, after: startDate })
      }
      if (current.due_date !== dueDate) {
        changes.push({ field: 'dueDate', before: current.due_date, after: dueDate })
      }
      if (current.sort_order !== sortOrder) {
        changes.push({ field: 'sortOrder', before: current.sort_order, after: sortOrder })
      }
      if (changes.length === 0) {
        db.exec('COMMIT')
        return requireStored(await this.getIssue(IssueId(current.id)), 'Issue')
      }
      const timestamp = new Date().toISOString()
      db.prepare(`
        UPDATE issues
        SET title = ?, description = ?, status = ?, priority = ?, assignee = ?,
            start_date = ?, due_date = ?, sort_order = ?,
            version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(
        title,
        description,
        status,
        priority,
        assignee,
        startDate,
        dueDate,
        sortOrder,
        timestamp,
        current.id,
        input.expectedVersion,
      )
      if (current.labels !== JSON.stringify(labels)) {
        replaceLabels(db, current.workspace_id, IssueId(current.id), labels)
      }
      this.recordActivity(IssueId(current.id), input.actor, changes, timestamp)
      if (returnReason !== undefined) {
        db.prepare(`
          INSERT INTO comments (
            id, issue_id, body, actor_type, actor_id, actor_name, actor_avatar_url, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          CommentId(randomUUID()),
          current.id,
          returnReason,
          input.actor.type,
          input.actor.id,
          input.actor.name,
          input.actor.avatarUrl ?? null,
          timestamp,
        )
      }
      db.exec('COMMIT')
      const stored = requireStored(await this.getIssue(IssueId(current.id)), 'Issue')
      this.notifyChanged(current.workspace_id as EnsureWorkspaceInput['workspaceId'])
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  archiveIssue(input: VersionedIssueInput): Promise<Issue> {
    return this.setIssueArchived(input, false)
  }

  restoreIssue(input: VersionedIssueInput): Promise<Issue> {
    return this.setIssueArchived(input, true)
  }

  async moveIssue(input: MoveIssueInput): Promise<Issue> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = db.prepare(`
        SELECT id, workspace_id, status, sort_order, version, archived_at, labels
        FROM issue_records
        WHERE id = ? OR identifier = ?
      `).get(input.reference, input.reference) as {
        id: string
        workspace_id: string
        status: Issue['status']
        sort_order: number
        version: number
        archived_at: string | null
        labels: string
      } | undefined
      if (current === undefined) {
        throw new TaskboardError('issue_not_found', `cannot move missing Issue '${input.reference}'`)
      }
      if (current.version !== input.expectedVersion) {
        throw new TaskboardError(
          'version_conflict',
          `cannot move Issue '${input.reference}': expected version ${input.expectedVersion}, found ${current.version}`,
        )
      }
      const target = db.prepare('SELECT 1 FROM taskboards WHERE workspace_id = ?')
        .get(input.targetWorkspaceId)
      if (target === undefined) {
        throw new TaskboardError(
          'workspace_not_found',
          `cannot move Issue '${input.reference}': Workspace '${input.targetWorkspaceId}' has no Taskboard`,
        )
      }
      if (current.workspace_id === input.targetWorkspaceId) {
        db.exec('COMMIT')
        return requireStored(await this.getIssue(IssueId(current.id)), 'Issue')
      }
      const relation = db.prepare(`
        SELECT 1
        FROM relations
        WHERE source_issue_id = ? OR target_issue_id = ?
        LIMIT 1
      `).get(current.id, current.id)
      if (relation !== undefined) {
        throw new TaskboardError(
          'relation_cross_workspace',
          `cannot move Issue '${input.reference}' while it has Workspace-scoped dependencies`,
        )
      }
      let sortOrder = current.sort_order
      if (current.archived_at === null && current.workspace_id !== input.targetWorkspaceId) {
        const row = db.prepare(`
          SELECT MIN(sort_order) AS minimum
          FROM issues
          WHERE workspace_id = ? AND status = ? AND archived_at IS NULL
        `).get(input.targetWorkspaceId, current.status) as { minimum: number | null }
        sortOrder = row.minimum === null ? 1000 : row.minimum - 1000
      }
      const timestamp = new Date().toISOString()
      db.prepare(`
        UPDATE issues
        SET workspace_id = ?, sort_order = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(input.targetWorkspaceId, sortOrder, timestamp, current.id, input.expectedVersion)
      replaceLabels(
        db,
        input.targetWorkspaceId,
        IssueId(current.id),
        JSON.parse(current.labels) as string[],
      )
      db.prepare(`
        UPDATE taskboards
        SET version = version + 1, updated_at = ?
        WHERE workspace_id IN (?, ?)
      `).run(timestamp, current.workspace_id, input.targetWorkspaceId)
      this.recordActivity(IssueId(current.id), input.actor, [{
        field: 'workspaceId',
        before: current.workspace_id,
        after: input.targetWorkspaceId,
      }], timestamp)
      db.exec('COMMIT')
      const stored = requireStored(await this.getIssue(IssueId(current.id)), 'Issue')
      this.notifyChanged(current.workspace_id as EnsureWorkspaceInput['workspaceId'])
      this.notifyChanged(input.targetWorkspaceId)
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async addComment(input: AddCommentInput): Promise<Comment> {
    const db = this.database()
    const issueId = this.requireIssueId(input.reference)
    const workspaceId = this.requireIssueWorkspace(issueId)
    const id = CommentId(randomUUID())
    const timestamp = new Date().toISOString()
    db.prepare(`
      INSERT INTO comments (
        id, issue_id, body, actor_type, actor_id, actor_name, actor_avatar_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      issueId,
      input.body,
      input.actor.type,
      input.actor.id,
      input.actor.name,
      input.actor.avatarUrl ?? null,
      timestamp,
    )
    const row = db.prepare(`
      SELECT id, issue_id, body, actor_type, actor_id, actor_name, actor_avatar_url, created_at
      FROM comments
      WHERE id = ?
    `).get(id) as unknown as CommentRow
    const stored = rowToComment(row)
    this.notifyChanged(workspaceId)
    return stored
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async listComments(reference: IssueReference): Promise<readonly Comment[]> {
    const issueId = this.requireIssueId(reference)
    const rows = this.database().prepare(`
      SELECT id, issue_id, body, actor_type, actor_id, actor_name, actor_avatar_url, created_at
      FROM comments
      WHERE issue_id = ?
      ORDER BY sequence
    `).all(issueId) as unknown as CommentRow[]
    return rows.map(rowToComment)
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async listActivities(reference: IssueReference): Promise<readonly Activity[]> {
    const issueId = this.requireIssueId(reference)
    const rows = this.database().prepare(`
      SELECT id, issue_id, actor_type, actor_id, actor_name, actor_avatar_url, changes, created_at
      FROM activities
      WHERE issue_id = ?
      ORDER BY sequence
    `).all(issueId) as unknown as ActivityRow[]
    return rows.map(rowToActivity)
  }

  async addRelation(input: AddIssueRelationInput): Promise<IssueRelationMutation> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const anchor = db.prepare(`
        SELECT id, workspace_id, version
        FROM issues
        WHERE id = ? OR identifier = ?
      `).get(input.reference, input.reference) as {
        id: string
        workspace_id: string
        version: number
      } | undefined
      const related = db.prepare(`
        SELECT id, workspace_id
        FROM issues
        WHERE id = ? OR identifier = ?
      `).get(input.relatedReference, input.relatedReference) as {
        id: string
        workspace_id: string
      } | undefined
      if (anchor === undefined || related === undefined) {
        const missing = anchor === undefined ? input.reference : input.relatedReference
        throw new TaskboardError('issue_not_found', `Issue '${missing}' does not exist`)
      }
      if (anchor.version !== input.expectedVersion) {
        throw new TaskboardError(
          'version_conflict',
          `cannot add relation to Issue '${input.reference}': expected version ${input.expectedVersion}, found ${anchor.version}`,
        )
      }
      if (anchor.id === related.id) {
        throw new TaskboardError('relation_self', `Issue '${input.reference}' cannot block itself`)
      }
      if (anchor.workspace_id !== related.workspace_id) {
        throw new TaskboardError(
          'relation_cross_workspace',
          'Issue dependencies must remain within one Workspace',
        )
      }
      const sourceIssueId = input.type === 'blocks' ? anchor.id : related.id
      const targetIssueId = input.type === 'blocks' ? related.id : anchor.id
      const existing = db.prepare(`
        SELECT 1 FROM relations WHERE source_issue_id = ? AND target_issue_id = ?
      `).get(sourceIssueId, targetIssueId)
      if (existing !== undefined) {
        throw new TaskboardError('relation_exists', 'This Issue dependency already exists')
      }
      const cycle = db.prepare(`
        WITH RECURSIVE descendants(issue_id) AS (
          SELECT target_issue_id FROM relations WHERE source_issue_id = ?
          UNION
          SELECT relations.target_issue_id
          FROM relations
          JOIN descendants ON relations.source_issue_id = descendants.issue_id
        )
        SELECT 1 FROM descendants WHERE issue_id = ?
      `).get(targetIssueId, sourceIssueId)
      if (cycle !== undefined) {
        throw new TaskboardError('relation_cycle', 'This Issue dependency would create a cycle')
      }
      const id = RelationId(randomUUID())
      const timestamp = new Date().toISOString()
      db.prepare(`
        INSERT INTO relations (id, source_issue_id, target_issue_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, sourceIssueId, targetIssueId, timestamp)
      db.prepare(`
        UPDATE issues
        SET version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(timestamp, anchor.id, input.expectedVersion)
      this.recordActivity(IssueId(anchor.id), input.actor, [{
        field: 'relation',
        before: null,
        after: { type: input.type, relatedIssueId: related.id },
      }], timestamp)
      db.exec('COMMIT')
      const mutation = {
        issue: requireStored(await this.getIssue(IssueId(anchor.id)), 'Issue'),
        relation: {
          id,
          type: input.type,
          issueId: IssueId(anchor.id),
          relatedIssueId: IssueId(related.id),
          createdAt: timestamp,
        },
      }
      this.notifyChanged(anchor.workspace_id as EnsureWorkspaceInput['workspaceId'])
      return mutation
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async listRelations(reference: IssueReference): Promise<readonly IssueRelation[]> {
    const issueId = this.requireIssueId(reference)
    const rows = this.database().prepare(`
      SELECT id, source_issue_id, target_issue_id, created_at
      FROM relations
      WHERE source_issue_id = ? OR target_issue_id = ?
      ORDER BY sequence
    `).all(issueId, issueId) as unknown as RelationRow[]
    return rows.map(row => rowToRelation(row, issueId))
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async listWorkspaceRelations(
    workspaceId: EnsureWorkspaceInput['workspaceId'],
  ): Promise<readonly IssueRelation[]> {
    const rows = this.database().prepare(`
      SELECT relations.id, relations.source_issue_id, relations.target_issue_id, relations.created_at
      FROM relations
      JOIN issues AS source ON source.id = relations.source_issue_id
      WHERE source.workspace_id = ?
      ORDER BY relations.sequence
    `).all(workspaceId) as unknown as RelationRow[]
    return rows.map(row => rowToRelation(row, IssueId(row.source_issue_id)))
  }

  async removeRelation(input: RemoveIssueRelationInput): Promise<Issue> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const anchor = db.prepare(`
        SELECT id, workspace_id, version FROM issues WHERE id = ? OR identifier = ?
      `).get(input.reference, input.reference) as { id: string; workspace_id: string; version: number } | undefined
      if (anchor === undefined) {
        throw new TaskboardError('issue_not_found', `Issue '${input.reference}' does not exist`)
      }
      if (anchor.version !== input.expectedVersion) {
        throw new TaskboardError(
          'version_conflict',
          `cannot remove relation from Issue '${input.reference}': expected version ${input.expectedVersion}, found ${anchor.version}`,
        )
      }
      const row = db.prepare(`
        SELECT id, source_issue_id, target_issue_id, created_at
        FROM relations
        WHERE id = ? AND (source_issue_id = ? OR target_issue_id = ?)
      `).get(input.relationId, anchor.id, anchor.id) as RelationRow | undefined
      if (row === undefined) {
        throw new TaskboardError('relation_not_found', `Relation '${input.relationId}' does not exist for this Issue`)
      }
      const relation = rowToRelation(row, IssueId(anchor.id))
      const timestamp = new Date().toISOString()
      db.prepare('DELETE FROM relations WHERE id = ?').run(input.relationId)
      db.prepare(`
        UPDATE issues
        SET version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(timestamp, anchor.id, input.expectedVersion)
      this.recordActivity(IssueId(anchor.id), input.actor, [{
        field: 'relation',
        before: { type: relation.type, relatedIssueId: relation.relatedIssueId },
        after: null,
      }], timestamp)
      db.exec('COMMIT')
      const stored = requireStored(await this.getIssue(IssueId(anchor.id)), 'Issue')
      this.notifyChanged(anchor.workspace_id as EnsureWorkspaceInput['workspaceId'])
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async getIssue(reference: IssueReference): Promise<Issue | undefined> {
    const row = this.database().prepare(`
      SELECT id, identifier, workspace_id, title, description, status, priority,
             labels, assignee, start_date, due_date, sort_order, version,
             archived_at, created_at, updated_at
      FROM issue_records
      WHERE id = ? OR identifier = ?
    `).get(reference, reference) as IssueRow | undefined
    return row === undefined ? undefined : rowToIssue(row)
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async getPatrolPolicy(
    workspaceId: EnsureWorkspaceInput['workspaceId'],
  ): Promise<PatrolPolicy | undefined> {
    const row = this.database().prepare(`
      SELECT workspace_id, enabled, interval, base_branch, agent_preset, provider,
             model, reasoning_effort, permission_preset, next_due_at, version, created_at, updated_at
      FROM patrol_policies
      WHERE workspace_id = ?
    `).get(workspaceId) as PatrolPolicyRow | undefined
    return row === undefined ? undefined : rowToPatrolPolicy(row)
  }

  async updatePatrolPolicy(input: UpdatePatrolPolicyInput): Promise<PatrolPolicy> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare(`
        SELECT workspace_id, enabled, interval, base_branch, agent_preset, provider,
               model, reasoning_effort, permission_preset, next_due_at, version, created_at, updated_at
        FROM patrol_policies
        WHERE workspace_id = ?
      `).get(input.workspaceId) as PatrolPolicyRow | undefined
      if (row === undefined) {
        throw new TaskboardError(
          'workspace_not_found',
          `cannot update Patrol Policy: Workspace '${input.workspaceId}' has no Taskboard`,
        )
      }
      if (row.version !== input.expectedVersion) {
        throw new TaskboardError(
          'version_conflict',
          `cannot update Patrol Policy: expected version ${input.expectedVersion}, found ${row.version}`,
        )
      }
      const enabled = input.enabled ?? row.enabled === 1
      const interval = input.interval ?? row.interval
      const baseBranch = input.baseBranch === undefined ? row.base_branch : input.baseBranch
      const agentPreset = input.agentPreset === undefined ? row.agent_preset : input.agentPreset
      const provider = input.provider === undefined ? row.provider : input.provider
      const model = input.model === undefined ? row.model : input.model
      const reasoningEffort = input.reasoningEffort === undefined ? row.reasoning_effort : input.reasoningEffort
      const permissionPreset = input.permissionPreset ?? row.permission_preset
      if (enabled && (baseBranch === null || baseBranch.trim() === '')) {
        throw new TaskboardError('patrol_policy_invalid', 'cannot enable Patrol without a local Base Branch')
      }
      if (permissionPreset.trim() === '') {
        throw new TaskboardError('patrol_policy_invalid', 'Patrol Permission Preset must be non-empty')
      }
      if ((provider === null) !== (model === null)) {
        throw new TaskboardError('patrol_policy_invalid', 'Patrol provider and model must be configured together')
      }
      if (
        enabled === (row.enabled === 1)
        && interval === row.interval
        && baseBranch === row.base_branch
        && agentPreset === row.agent_preset
        && provider === row.provider
        && model === row.model
        && reasoningEffort === row.reasoning_effort
        && permissionPreset === row.permission_preset
      ) {
        db.exec('COMMIT')
        return rowToPatrolPolicy(row)
      }
      const savedAt = new Date()
      const timestamp = savedAt.toISOString()
      const nextDueAt = enabled ? nextPatrolDueAfterSave(savedAt, interval) : null
      db.prepare(`
        UPDATE patrol_policies
        SET enabled = ?, interval = ?, base_branch = ?, agent_preset = ?, provider = ?,
            model = ?, reasoning_effort = ?, permission_preset = ?, next_due_at = ?,
            version = version + 1, updated_at = ?
        WHERE workspace_id = ? AND version = ?
      `).run(
        enabled ? 1 : 0,
        interval,
        baseBranch,
        agentPreset,
        provider,
        model,
        reasoningEffort,
        permissionPreset,
        nextDueAt,
        timestamp,
        input.workspaceId,
        input.expectedVersion,
      )
      db.exec('COMMIT')
      const stored = requireStored(await this.getPatrolPolicy(input.workspaceId), 'Patrol Policy')
      this.notifyChanged(input.workspaceId)
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async listDuePatrolPolicies(): Promise<readonly PatrolPolicy[]> {
    const timestamp = new Date().toISOString()
    const rows = this.database().prepare(`
      SELECT workspace_id, enabled, interval, base_branch, agent_preset, provider,
             model, reasoning_effort, permission_preset, next_due_at, version, created_at, updated_at
      FROM patrol_policies
      WHERE enabled = 1 AND next_due_at <= ?
      ORDER BY next_due_at, workspace_id
    `).all(timestamp) as unknown as PatrolPolicyRow[]
    return rows.map(rowToPatrolPolicy)
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async beginPatrolRun(input: BeginPatrolRunInput): Promise<PatrolRun> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const policyRow = db.prepare(`
        SELECT workspace_id, enabled, interval, base_branch, agent_preset, provider,
               model, reasoning_effort, permission_preset, next_due_at, version, created_at, updated_at
        FROM patrol_policies
        WHERE workspace_id = ?
      `).get(input.workspaceId) as PatrolPolicyRow | undefined
      if (policyRow === undefined) {
        throw new TaskboardError(
          'workspace_not_found',
          `cannot begin Patrol Run: Workspace '${input.workspaceId}' has no Taskboard`,
        )
      }
      const now = new Date()
      const timestamp = now.toISOString()
      let scheduledFor: string | null = null
      if (input.trigger === 'scheduled') {
        if (policyRow.enabled !== 1 || policyRow.next_due_at === null || policyRow.next_due_at > timestamp) {
          throw new TaskboardError('patrol_not_due', `Workspace '${input.workspaceId}' Patrol is not due`)
        }
        scheduledFor = policyRow.next_due_at
        db.prepare(`
          UPDATE patrol_policies
          SET next_due_at = ?, version = version + 1, updated_at = ?
          WHERE workspace_id = ? AND version = ?
        `).run(
          nextPatrolCadence(scheduledFor, policyRow.interval, now),
          timestamp,
          input.workspaceId,
          policyRow.version,
        )
      }
      const active = db.prepare("SELECT 1 FROM patrol_runs WHERE state = 'active' LIMIT 1").get()
      if (active !== undefined && input.trigger === 'manual') {
        throw new TaskboardError('patrol_busy', 'another Patrol Run is already active')
      }
      const id = PatrolRunId(randomUUID())
      const skipped = active !== undefined
      db.prepare(`
        INSERT INTO patrol_runs (
          id, workspace_id, trigger, scheduled_for, state, result,
          error, recovery_count, last_recovered_at, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)
      `).run(
        id,
        input.workspaceId,
        input.trigger,
        scheduledFor,
        skipped ? 'completed' : 'active',
        skipped ? 'skipped_global_busy' : null,
        timestamp,
        skipped ? timestamp : null,
      )
      db.exec('COMMIT')
      const stored = requireStored(this.findPatrolRun(id), 'Patrol Run')
      this.notifyChanged(input.workspaceId)
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async completePatrolRun(input: CompletePatrolRunInput): Promise<PatrolRun> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare(`
        SELECT id, workspace_id, trigger, scheduled_for, state, result,
               error, recovery_count, last_recovered_at, started_at, ended_at
        FROM patrol_runs
        WHERE id = ?
      `).get(input.runId) as PatrolRunRow | undefined
      if (row === undefined || row.state !== 'active') {
        throw new TaskboardError('patrol_run_not_active', `Patrol Run '${input.runId}' is not active`)
      }
      const timestamp = new Date().toISOString()
      db.prepare(`
        UPDATE patrol_runs
        SET state = 'completed', result = ?, error = ?, ended_at = ?
        WHERE id = ? AND state = 'active'
      `).run(input.result, input.error ?? null, timestamp, input.runId)
      return this.commitPatrolRunMutation(db, input.runId, row.workspace_id)
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async listPatrolRuns(
    workspaceId: EnsureWorkspaceInput['workspaceId'],
  ): Promise<readonly PatrolRun[]> {
    const rows = this.database().prepare(`
      SELECT id, workspace_id, trigger, scheduled_for, state, result,
             error, recovery_count, last_recovered_at, started_at, ended_at
      FROM patrol_runs
      WHERE workspace_id = ?
      ORDER BY sequence DESC
    `).all(workspaceId) as unknown as PatrolRunRow[]
    return rows.map(rowToPatrolRun)
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async getActivePatrolRun(): Promise<PatrolRun | undefined> {
    const row = this.database().prepare(`
      SELECT id, workspace_id, trigger, scheduled_for, state, result,
             error, recovery_count, last_recovered_at, started_at, ended_at
      FROM patrol_runs
      WHERE state = 'active'
    `).get() as PatrolRunRow | undefined
    return row === undefined ? undefined : rowToPatrolRun(row)
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async recordPatrolRecovery(runId: PatrolRunId): Promise<PatrolRun> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare(`
        SELECT workspace_id, state FROM patrol_runs WHERE id = ?
      `).get(runId) as { workspace_id: string; state: PatrolRun['state'] } | undefined
      if (row === undefined || row.state !== 'active') {
        throw new TaskboardError('patrol_run_not_active', `Patrol Run '${runId}' is not active`)
      }
      const timestamp = new Date().toISOString()
      db.prepare(`
        UPDATE patrol_runs
        SET recovery_count = recovery_count + 1, last_recovered_at = ?
        WHERE id = ? AND state = 'active'
      `).run(timestamp, runId)
      return this.commitPatrolRunMutation(db, runId, row.workspace_id)
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async failPatrolRecovery(input: FailPatrolRecoveryInput): Promise<PatrolRun> {
    const detail = input.error.trim()
    if (detail === '') throw new TaskboardError('patrol_issue_ineligible', 'Patrol recovery failure requires a reason')
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare(`
        SELECT runs.workspace_id, runs.state AS run_state,
               attempts.issue_id, attempts.state AS attempt_state,
               issues.status, issues.version
        FROM patrol_runs AS runs
        JOIN patrol_attempts AS attempts ON attempts.run_id = runs.id
        JOIN issues ON issues.id = attempts.issue_id
        WHERE runs.id = ? AND attempts.id = ?
      `).get(input.runId, input.attemptId) as {
        workspace_id: string
        run_state: PatrolRun['state']
        issue_id: string
        attempt_state: PatrolAttempt['state']
        status: Issue['status']
        version: number
      } | undefined
      if (row === undefined || row.run_state !== 'active' || row.attempt_state !== 'active') {
        throw new TaskboardError(
          'patrol_attempt_not_active',
          `Patrol recovery '${input.runId}/${input.attemptId}' is not active`,
        )
      }
      const timestamp = new Date().toISOString()
      if (row.status !== 'blocked') {
        db.prepare(`
          UPDATE issues
          SET status = 'blocked', version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?
        `).run(timestamp, row.issue_id, row.version)
        this.recordActivity(IssueId(row.issue_id), input.actor, [{
          field: 'status', before: row.status, after: 'blocked',
        }], timestamp)
      }
      db.prepare(`
        INSERT INTO comments (
          id, issue_id, body, actor_type, actor_id, actor_name, actor_avatar_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        CommentId(randomUUID()),
        row.issue_id,
        detail,
        input.actor.type,
        input.actor.id,
        input.actor.name,
        input.actor.avatarUrl ?? null,
        timestamp,
      )
      db.prepare(`
        UPDATE patrol_attempts
        SET state = 'completed', result = 'failed', error = ?, ended_at = ?
        WHERE id = ? AND state = 'active'
      `).run(detail, timestamp, input.attemptId)
      db.prepare(`
        UPDATE patrol_runs
        SET state = 'completed', result = 'failed', error = ?, ended_at = ?
        WHERE id = ? AND state = 'active'
      `).run(detail, timestamp, input.runId)
      return this.commitPatrolRunMutation(db, input.runId, row.workspace_id)
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async claimPatrolIssue(input: ClaimPatrolIssueInput): Promise<PatrolAttempt> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const run = db.prepare(`
        SELECT workspace_id, state
        FROM patrol_runs
        WHERE id = ?
      `).get(input.runId) as { workspace_id: string; state: PatrolRun['state'] } | undefined
      if (run === undefined || run.state !== 'active') {
        throw new TaskboardError('patrol_run_not_active', `Patrol Run '${input.runId}' is not active`)
      }
      const latestAttempt = db.prepare(`
        SELECT state, result
        FROM patrol_attempts
        WHERE run_id = ?
        ORDER BY sequence DESC
        LIMIT 1
      `).get(input.runId) as Pick<PatrolAttempt, 'state' | 'result'> | undefined
      if (latestAttempt?.state === 'active') {
        throw new TaskboardError('patrol_issue_ineligible', `Patrol Run '${input.runId}' already has an active Attempt`)
      }
      if (latestAttempt !== undefined && latestAttempt.result !== 'permission_blocked') {
        throw new TaskboardError(
          'patrol_issue_ineligible',
          `Patrol Run '${input.runId}' may continue only after a permission-blocked Attempt`,
        )
      }
      const issue = db.prepare(`
        SELECT id, workspace_id, status, assignee, version, archived_at
        FROM issues
        WHERE id = ? OR identifier = ?
      `).get(input.reference, input.reference) as {
        id: string
        workspace_id: string
        status: Issue['status']
        assignee: Issue['assignee']
        version: number
        archived_at: string | null
      } | undefined
      if (issue === undefined) {
        throw new TaskboardError('issue_not_found', `cannot claim missing Issue '${input.reference}'`)
      }
      if (issue.version !== input.expectedVersion) {
        throw new TaskboardError(
          'version_conflict',
          `cannot claim Issue '${input.reference}': expected version ${input.expectedVersion}, found ${issue.version}`,
        )
      }
      if (
        issue.workspace_id !== run.workspace_id
        || issue.archived_at !== null
        || issue.status !== 'todo'
        || issue.assignee === 'user'
      ) {
        throw new TaskboardError('patrol_issue_ineligible', `Issue '${input.reference}' is not eligible for Patrol`)
      }
      const blockers = db.prepare(`
        SELECT source.id, source.status, context.result_commit
        FROM relations
        JOIN issues AS source ON source.id = relations.source_issue_id
        LEFT JOIN patrol_development_contexts AS context ON context.issue_id = source.id
        WHERE relations.target_issue_id = ?
        ORDER BY relations.sequence
      `).all(issue.id) as unknown as { id: string; status: Issue['status']; result_commit: string | null }[]
      const snapshots = input.dependencyCommits
      const dependenciesMatch = blockers.every(blocker =>
        blocker.status === 'done'
        && blocker.result_commit !== null
        && snapshots[blocker.id] === blocker.result_commit)
        && Object.keys(snapshots).length === blockers.length
      if (!dependenciesMatch) {
        throw new TaskboardError(
          'patrol_issue_ineligible',
          `Issue '${input.reference}' has an unsatisfied or changed dependency`,
        )
      }
      const context = db.prepare(`
        SELECT session_id FROM patrol_development_contexts WHERE issue_id = ?
      `).get(issue.id) as { session_id: string } | undefined
      const timestamp = new Date().toISOString()
      const attemptId = PatrolAttemptId(randomUUID())
      db.prepare(`
        UPDATE issues
        SET status = 'in_progress', assignee = 'patrol_agent', version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(timestamp, issue.id, input.expectedVersion)
      const changes: ActivityChange[] = [
        { field: 'status', before: 'todo', after: 'in_progress' },
      ]
      if (issue.assignee !== 'patrol_agent') {
        changes.push({ field: 'assignee', before: issue.assignee, after: 'patrol_agent' })
      }
      this.recordActivity(IssueId(issue.id), input.actor, changes, timestamp)
      db.prepare(`
        INSERT INTO patrol_attempts (
          id, run_id, issue_id, session_id, state, result, error, started_at, ended_at
        ) VALUES (?, ?, ?, ?, 'active', NULL, NULL, ?, NULL)
      `).run(attemptId, input.runId, issue.id, context?.session_id ?? null, timestamp)
      db.exec('COMMIT')
      const stored = requireStored(this.findPatrolAttempt(attemptId), 'Patrol Attempt')
      this.notifyChanged(run.workspace_id as EnsureWorkspaceInput['workspaceId'])
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  async bindPatrolDevelopmentContext(
    input: BindPatrolDevelopmentContextInput,
  ): Promise<PatrolDevelopmentContext> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const attempt = db.prepare(`
        SELECT attempts.issue_id, attempts.state, issues.workspace_id
        FROM patrol_attempts AS attempts
        JOIN issues ON issues.id = attempts.issue_id
        WHERE attempts.id = ?
      `).get(input.attemptId) as {
        issue_id: string
        state: PatrolAttempt['state']
        workspace_id: string
      } | undefined
      if (attempt === undefined || attempt.state !== 'active') {
        throw new TaskboardError(
          'patrol_attempt_not_active',
          `Patrol Attempt '${input.attemptId}' is not active`,
        )
      }
      const existing = db.prepare(`
        SELECT 1 FROM patrol_development_contexts WHERE issue_id = ?
      `).get(attempt.issue_id)
      if (existing !== undefined) {
        throw new TaskboardError(
          'patrol_context_exists',
          `Issue '${attempt.issue_id}' already has a Development Context`,
        )
      }
      const values = [
        input.context.baseBranch,
        input.context.branch,
        input.context.worktreePath,
        input.context.agentPreset,
        input.context.provider,
        input.context.model,
        input.context.permissionPreset,
      ]
      if (values.some(value => value.trim() === '')) {
        throw new TaskboardError('patrol_issue_ineligible', 'Development Context values must be non-empty')
      }
      const timestamp = new Date().toISOString()
      db.prepare(`
        INSERT INTO patrol_development_contexts (
          issue_id, session_id, session_started_at, base_branch, branch, worktree_path, agent_preset,
          provider, model, reasoning_effort, permission_preset, result_commit,
          created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        attempt.issue_id,
        input.context.sessionId,
        input.context.baseBranch,
        input.context.branch,
        input.context.worktreePath,
        input.context.agentPreset,
        input.context.provider,
        input.context.model,
        input.context.reasoningEffort,
        input.context.permissionPreset,
        timestamp,
        timestamp,
      )
      db.prepare(`
        UPDATE patrol_attempts SET session_id = ? WHERE id = ? AND state = 'active'
      `).run(input.context.sessionId, input.attemptId)
      db.exec('COMMIT')
      const stored = requireStored(
        await this.getPatrolDevelopmentContext(IssueId(attempt.issue_id)),
        'Patrol Development Context',
      )
      this.notifyChanged(attempt.workspace_id as EnsureWorkspaceInput['workspaceId'])
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async getPatrolDevelopmentContext(
    reference: IssueReference,
  ): Promise<PatrolDevelopmentContext | undefined> {
    const row = this.database().prepare(`
      SELECT context.issue_id, context.session_id, context.base_branch, context.branch,
             context.worktree_path, context.agent_preset, context.provider, context.model,
             context.reasoning_effort, context.permission_preset, context.result_commit,
             context.session_started_at, context.created_at, context.updated_at
      FROM patrol_development_contexts AS context
      JOIN issues ON issues.id = context.issue_id
      WHERE issues.id = ? OR issues.identifier = ?
    `).get(reference, reference) as PatrolDevelopmentContextRow | undefined
    return row === undefined ? undefined : rowToPatrolDevelopmentContext(row)
  }

  async markPatrolSessionStarted(attemptId: PatrolAttempt['id']): Promise<PatrolDevelopmentContext> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const attempt = db.prepare(`
        SELECT attempts.issue_id, attempts.session_id, attempts.state, issues.workspace_id
        FROM patrol_attempts AS attempts
        JOIN issues ON issues.id = attempts.issue_id
        WHERE attempts.id = ?
      `).get(attemptId) as {
        issue_id: string
        session_id: string | null
        state: PatrolAttempt['state']
        workspace_id: string
      } | undefined
      if (attempt === undefined || attempt.state !== 'active') {
        throw new TaskboardError('patrol_attempt_not_active', `Patrol Attempt '${attemptId}' is not active`)
      }
      if (attempt.session_id === null) {
        throw new TaskboardError('patrol_context_missing', `Issue '${attempt.issue_id}' has no Development Context`)
      }
      const timestamp = new Date().toISOString()
      const result = db.prepare(`
        UPDATE patrol_development_contexts
        SET session_started_at = COALESCE(session_started_at, ?), updated_at = ?
        WHERE issue_id = ? AND session_id = ?
      `).run(timestamp, timestamp, attempt.issue_id, attempt.session_id)
      /* v8 ignore next 3 -- binding writes the Context and active Attempt Session in one transaction. */
      if (result.changes !== 1) {
        throw new TaskboardError('patrol_context_missing', `Issue '${attempt.issue_id}' has no matching Development Context`)
      }
      db.exec('COMMIT')
      const stored = requireStored(
        await this.getPatrolDevelopmentContext(IssueId(attempt.issue_id)),
        'Patrol Development Context',
      )
      this.notifyChanged(attempt.workspace_id as EnsureWorkspaceInput['workspaceId'])
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async completePatrolAttempt(input: CompletePatrolAttemptInput): Promise<PatrolAttempt> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const attempt = db.prepare(`
        SELECT attempts.id, attempts.issue_id, attempts.state, issues.workspace_id,
               issues.status, issues.version, contexts.session_id
        FROM patrol_attempts AS attempts
        JOIN issues ON issues.id = attempts.issue_id
        LEFT JOIN patrol_development_contexts AS contexts ON contexts.issue_id = attempts.issue_id
        WHERE attempts.id = ?
      `).get(input.attemptId) as {
        id: string
        issue_id: string
        state: PatrolAttempt['state']
        workspace_id: string
        status: Issue['status']
        version: number
        session_id: string | null
      } | undefined
      if (attempt === undefined || attempt.state !== 'active') {
        throw new TaskboardError(
          'patrol_attempt_not_active',
          `Patrol Attempt '${input.attemptId}' is not active`,
        )
      }
      if (attempt.status !== 'in_progress') {
        throw new TaskboardError(
          'patrol_issue_ineligible',
          `Issue '${attempt.issue_id}' is no longer in progress`,
        )
      }
      const handoff = input.result === 'review_handoff'
      const detail = input.error?.trim()
      const resultCommit = input.resultCommit?.trim()
      if (handoff) {
        if (attempt.session_id === null) {
          throw new TaskboardError('patrol_context_missing', `Issue '${attempt.issue_id}' has no Development Context`)
        }
        if (resultCommit === undefined || resultCommit === '') {
          throw new TaskboardError('patrol_issue_ineligible', 'review handoff requires a result commit')
        }
      } else if (detail === undefined || detail === '') {
        throw new TaskboardError('patrol_issue_ineligible', 'blocked Patrol Attempt requires a reason')
      }
      const timestamp = new Date().toISOString()
      const nextStatus = handoff ? 'in_review' : 'blocked'
      db.prepare(`
        UPDATE issues
        SET status = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(nextStatus, timestamp, attempt.issue_id, attempt.version)
      this.recordActivity(IssueId(attempt.issue_id), input.actor, [{
        field: 'status', before: 'in_progress', after: nextStatus,
      }], timestamp)
      if (!handoff) {
        db.prepare(`
          INSERT INTO comments (
            id, issue_id, body, actor_type, actor_id, actor_name, actor_avatar_url, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          CommentId(randomUUID()),
          attempt.issue_id,
          detail as string,
          input.actor.type,
          input.actor.id,
          input.actor.name,
          input.actor.avatarUrl ?? null,
          timestamp,
        )
      } else {
        db.prepare(`
          UPDATE patrol_development_contexts
          SET result_commit = ?, updated_at = ?
          WHERE issue_id = ?
        `).run(resultCommit as string, timestamp, attempt.issue_id)
      }
      db.prepare(`
        UPDATE patrol_attempts
        SET state = 'completed', result = ?, error = ?, ended_at = ?
        WHERE id = ? AND state = 'active'
      `).run(input.result, handoff ? null : detail as string, timestamp, input.attemptId)
      db.exec('COMMIT')
      const stored = requireStored(this.findPatrolAttempt(input.attemptId), 'Patrol Attempt')
      this.notifyChanged(attempt.workspace_id as EnsureWorkspaceInput['workspaceId'])
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async recordPatrolReview(input: RecordPatrolReviewInput): Promise<PatrolReview> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const attempt = db.prepare(`
        SELECT attempts.issue_id, attempts.state, issues.workspace_id, issues.status,
               contexts.session_id AS implementation_session_id
        FROM patrol_attempts AS attempts
        JOIN issues ON issues.id = attempts.issue_id
        LEFT JOIN patrol_development_contexts AS contexts ON contexts.issue_id = attempts.issue_id
        WHERE attempts.id = ?
      `).get(input.attemptId) as {
        issue_id: string
        state: PatrolAttempt['state']
        workspace_id: string
        status: Issue['status']
        implementation_session_id: string | null
      } | undefined
      if (attempt === undefined || attempt.state !== 'active') {
        throw new TaskboardError(
          'patrol_attempt_not_active',
          `Patrol Attempt '${input.attemptId}' is not active`,
        )
      }
      if (attempt.status !== 'in_progress' || attempt.implementation_session_id === null) {
        throw new TaskboardError(
          'patrol_context_missing',
          `Issue '${attempt.issue_id}' has no active implementation context`,
        )
      }
      if (db.prepare('SELECT 1 FROM patrol_reviews WHERE attempt_id = ?').get(input.attemptId) !== undefined) {
        throw new TaskboardError(
          'patrol_review_exists',
          `Patrol Attempt '${input.attemptId}' already has Reviewer evidence`,
        )
      }
      const reviewerSessionId = String(input.sessionId).trim()
      const reviewedCommit = input.reviewedCommit.trim()
      const findings = input.findings.trim()
      const verification = input.verification.map(value => value.trim())
      const risks = input.risks.map(value => value.trim())
      if (
        reviewerSessionId === ''
        || reviewerSessionId === attempt.implementation_session_id
        || reviewedCommit === ''
        || findings === ''
        || verification.some(value => value === '')
        || risks.some(value => value === '')
      ) {
        throw new TaskboardError('patrol_issue_ineligible', 'Reviewer evidence values must be non-empty and independent')
      }
      const timestamp = new Date().toISOString()
      db.prepare(`
        INSERT INTO patrol_reviews (
          attempt_id, issue_id, session_id, reviewed_commit, verdict,
          findings, verification, risks, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.attemptId,
        attempt.issue_id,
        reviewerSessionId,
        reviewedCommit,
        input.verdict,
        findings,
        JSON.stringify(verification),
        JSON.stringify(risks),
        timestamp,
      )
      db.exec('COMMIT')
      const row = db.prepare(`
        SELECT attempt_id, issue_id, session_id, reviewed_commit, verdict,
               findings, verification, risks, created_at
        FROM patrol_reviews
        WHERE attempt_id = ?
      `).get(input.attemptId) as PatrolReviewRow | undefined
      /* v8 ignore next -- the preceding insert creates this row in the same transaction. */
      const stored = requireStored(row === undefined ? undefined : rowToPatrolReview(row), 'Patrol Review')
      this.notifyChanged(attempt.workspace_id as EnsureWorkspaceInput['workspaceId'])
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async listPatrolReviews(reference: IssueReference): Promise<readonly PatrolReview[]> {
    const rows = this.database().prepare(`
      SELECT reviews.attempt_id, reviews.issue_id, reviews.session_id,
             reviews.reviewed_commit, reviews.verdict, reviews.findings,
             reviews.verification, reviews.risks, reviews.created_at
      FROM patrol_reviews AS reviews
      JOIN issues ON issues.id = reviews.issue_id
      WHERE issues.id = ? OR issues.identifier = ?
      ORDER BY reviews.sequence
    `).all(reference, reference) as unknown as PatrolReviewRow[]
    return rows.map(rowToPatrolReview)
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve rejection semantics at the asynchronous Service contract.
  async listPatrolAttempts(runId: PatrolRunId): Promise<readonly PatrolAttempt[]> {
    const rows = this.database().prepare(`
      SELECT id, run_id, issue_id, session_id, state, result, error, started_at, ended_at
      FROM patrol_attempts
      WHERE run_id = ?
      ORDER BY sequence
    `).all(runId) as unknown as PatrolAttemptRow[]
    return rows.map(rowToPatrolAttempt)
  }

  /** Return the initialized database or fail if the Service lifecycle was bypassed. */
  private database(): DatabaseSync {
    if (this.db === undefined) throw new Error('SQLite Taskboard is not initialized')
    return this.db
  }

  /** Read one Patrol Run from the initialized database. */
  private findPatrolRun(runId: PatrolRunId): PatrolRun | undefined {
    const row = this.database().prepare(`
      SELECT id, workspace_id, trigger, scheduled_for, state, result,
             error, recovery_count, last_recovered_at, started_at, ended_at
      FROM patrol_runs
      WHERE id = ?
    `).get(runId) as PatrolRunRow | undefined
    /* v8 ignore next -- callers pass an id read or inserted in the same SQLite transaction. */
    return row === undefined ? undefined : rowToPatrolRun(row)
  }

  /** Commit one Patrol Run mutation and publish its settled durable record. */
  private commitPatrolRunMutation(db: DatabaseSync, runId: PatrolRunId, workspaceId: string): PatrolRun {
    db.exec('COMMIT')
    const stored = requireStored(this.findPatrolRun(runId), 'Patrol Run')
    this.notifyChanged(workspaceId as EnsureWorkspaceInput['workspaceId'])
    return stored
  }

  /** Read one Patrol Attempt from the initialized database. */
  private findPatrolAttempt(attemptId: PatrolAttemptId): PatrolAttempt | undefined {
    const row = this.database().prepare(`
      SELECT id, run_id, issue_id, session_id, state, result, error, started_at, ended_at
      FROM patrol_attempts
      WHERE id = ?
    `).get(attemptId) as PatrolAttemptRow | undefined
    /* v8 ignore next -- callers pass an id inserted or updated in the same SQLite transaction. */
    return row === undefined ? undefined : rowToPatrolAttempt(row)
  }

  /** Resolve an Issue reference for child-record foreign keys. */
  private requireIssueId(reference: IssueReference): IssueId {
    const row = this.database().prepare(`
      SELECT id FROM issues WHERE id = ? OR identifier = ?
    `).get(reference, reference) as { id: string } | undefined
    if (row === undefined) {
      throw new TaskboardError('issue_not_found', `Issue '${reference}' does not exist`)
    }
    return IssueId(row.id)
  }

  /** Resolve the owning Workspace for an already validated Issue id. */
  private requireIssueWorkspace(issueId: IssueId): EnsureWorkspaceInput['workspaceId'] {
    const row = this.database().prepare('SELECT workspace_id FROM issues WHERE id = ?')
      .get(issueId) as { workspace_id: string } | undefined
    return requireStored(row, 'Issue Workspace').workspace_id as EnsureWorkspaceInput['workspaceId']
  }

  /** Append one Activity entry inside the caller's mutation transaction. */
  private recordActivity(
    issueId: IssueId,
    actor: TaskboardActor,
    changes: readonly ActivityChange[],
    timestamp: string,
  ): void {
    this.database().prepare(`
      INSERT INTO activities (
        id, issue_id, actor_type, actor_id, actor_name, actor_avatar_url, changes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ActivityId(randomUUID()),
      issueId,
      actor.type,
      actor.id,
      actor.name,
      actor.avatarUrl ?? null,
      JSON.stringify(changes),
      timestamp,
    )
  }

  /** Persist an archive transition with optimistic concurrency. */
  private async setIssueArchived(input: VersionedIssueInput, restore: boolean): Promise<Issue> {
    const db = this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = db.prepare(`
        SELECT id, workspace_id, version, archived_at
        FROM issues
        WHERE id = ? OR identifier = ?
      `).get(input.reference, input.reference) as {
        id: string
        workspace_id: string
        version: number
        archived_at: string | null
      } | undefined
      if (current === undefined) {
        throw new TaskboardError('issue_not_found', `cannot change archive state of missing Issue '${input.reference}'`)
      }
      if (current.version !== input.expectedVersion) {
        throw new TaskboardError(
          'version_conflict',
          `cannot change archive state of Issue '${input.reference}': expected version ${input.expectedVersion}, found ${current.version}`,
        )
      }
      if (restore && current.archived_at === null) {
        throw new TaskboardError('issue_not_archived', `cannot restore active Issue '${input.reference}'`)
      }
      if (!restore && current.archived_at !== null) {
        throw new TaskboardError('issue_archived', `cannot archive already archived Issue '${input.reference}'`)
      }
      const timestamp = new Date().toISOString()
      db.prepare(`
        UPDATE issues
        SET archived_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(restore ? null : timestamp, timestamp, current.id, input.expectedVersion)
      this.recordActivity(IssueId(current.id), input.actor, [{
        field: 'archivedAt',
        before: current.archived_at,
        after: restore ? null : timestamp,
      }], timestamp)
      db.exec('COMMIT')
      const stored = requireStored(await this.getIssue(IssueId(current.id)), 'Issue')
      this.notifyChanged(current.workspace_id as EnsureWorkspaceInput['workspaceId'])
      return stored
    } catch (error: unknown) {
      rollback(db)
      throw error
    }
  }

  /** Allocate the first unused deterministic prefix while holding the write transaction. */
  private allocatePrefix(title: string): string {
    const base = derivePrefix(title)
    const exists = this.database().prepare('SELECT 1 FROM taskboards WHERE prefix = ?')
    if (exists.get(base) === undefined) return base
    for (let number = 2; ; number += 1) {
      const suffix = String(number)
      const candidate = `${base.slice(0, MAX_ISSUE_PREFIX_LENGTH - suffix.length)}${suffix}`
      if (exists.get(candidate) === undefined) return candidate
    }
  }

  /** Notify every observer after a successful commit without letting UI refresh veto persistence. */
  private notifyChanged(workspaceId: EnsureWorkspaceInput['workspaceId']): void {
    for (const callback of this.ctx.events.dispatch('emit', ['taskboard/changed', workspaceId])) {
      try {
        const returned: unknown = callback(workspaceId)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`taskboard/changed listener rejected: ${String(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`taskboard/changed listener threw: ${String(error)}`)
      }
    }
  }
}

export default SqliteTaskboard
