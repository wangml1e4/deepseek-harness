/** SQLite schema and row conversion for the Taskboard Provider. */

import { DatabaseSync } from 'node:sqlite'
import {
  ActivityId,
  CommentId,
  IssueId,
  IssueIdentifier,
  RelationId,
  TaskboardActorId,
} from '@deepseek-ai/dsh-taskboard'
import type {
  Activity,
  Comment,
  Issue,
  IssueAssignee,
  IssuePriority,
  IssueRelation,
  IssueStatus,
  WorkspaceTaskboard,
} from '@deepseek-ai/dsh-taskboard'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Initial Taskboard SQLite layout version. */
export const SCHEMA_VERSION = 1

/** SQLite application identity for a Harness Taskboard database (`DSHT`). */
export const TASKBOARD_SQLITE_APPLICATION_ID = 0x44534854

/** Supported durable journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** Stored Taskboard metadata row. */
export interface WorkspaceRow {
  workspace_id: string
  title: string
  prefix: string
  version: number
  created_at: string
  updated_at: string
}

/** Stored Issue row. */
export interface IssueRow {
  id: string
  identifier: string
  workspace_id: string
  title: string
  description: string
  status: IssueStatus
  priority: IssuePriority
  labels: string
  assignee: IssueAssignee
  start_date: string | null
  due_date: string | null
  sort_order: number
  version: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

/** Stored append-only Comment row. */
export interface CommentRow {
  id: string
  issue_id: string
  body: string
  actor_type: 'user' | 'patrol_agent' | 'reviewer' | 'system'
  actor_id: string
  actor_name: string
  actor_avatar_url: string | null
  created_at: string
}

/** Stored append-only Activity row. */
export interface ActivityRow {
  id: string
  issue_id: string
  actor_type: 'user' | 'patrol_agent' | 'reviewer' | 'system'
  actor_id: string
  actor_name: string
  actor_avatar_url: string | null
  changes: string
  created_at: string
}

/** Stored directed dependency row whose source blocks its target. */
export interface RelationRow {
  id: string
  source_issue_id: string
  target_issue_id: string
  created_at: string
}

/**
 * Open and validate one Taskboard database.
 * @param path - SQLite filename or `:memory:`.
 * @param journalMode - Durable journal mode.
 * @param busyTimeoutMs - SQLite busy timeout in milliseconds.
 * @returns the configured database handle.
 */
export function openTaskboardDatabase(
  path: string,
  journalMode: JournalMode,
  busyTimeoutMs: number,
): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`)
    db.exec('BEGIN IMMEDIATE')
    const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { count: userObjectCount } = db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
    ).get() as { count: number }
    if (onDisk === 0 && (applicationId !== 0 || userObjectCount > 0)) {
      throw new Error(`taskboard database at "${path}" has an unversioned schema or application identity`)
    }
    if (onDisk !== 0 && onDisk !== SCHEMA_VERSION) {
      throw new Error(
        `taskboard database at "${path}" has schema version ${onDisk}, incompatible with this build (${SCHEMA_VERSION})`,
      )
    }
    if (onDisk === SCHEMA_VERSION && applicationId !== TASKBOARD_SQLITE_APPLICATION_ID) {
      throw new Error(
        `taskboard database at "${path}" has application id ${applicationId}, expected ${TASKBOARD_SQLITE_APPLICATION_ID}`,
      )
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS taskboards (
        workspace_id      TEXT PRIMARY KEY,
        title             TEXT NOT NULL,
        prefix            TEXT NOT NULL UNIQUE,
        next_issue_number INTEGER NOT NULL DEFAULT 1 CHECK (next_issue_number > 0),
        version           INTEGER NOT NULL CHECK (version > 0),
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS issues (
        id           TEXT PRIMARY KEY,
        identifier   TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL REFERENCES taskboards(workspace_id),
        title        TEXT NOT NULL,
        description  TEXT NOT NULL,
        status       TEXT NOT NULL CHECK (status IN (
          'backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled'
        )),
        priority     TEXT NOT NULL CHECK (priority IN ('none', 'urgent', 'high', 'medium', 'low')),
        assignee     TEXT NOT NULL CHECK (assignee IN ('unassigned', 'user', 'patrol_agent')),
        start_date   TEXT,
        due_date     TEXT,
        sort_order   REAL NOT NULL,
        version      INTEGER NOT NULL CHECK (version > 0),
        archived_at  TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS issues_workspace_status_order
        ON issues(workspace_id, archived_at, status, sort_order, created_at);

      CREATE TABLE IF NOT EXISTS labels (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL REFERENCES taskboards(workspace_id),
        name         TEXT NOT NULL,
        UNIQUE (workspace_id, name)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS issue_labels (
        issue_id TEXT NOT NULL REFERENCES issues(id),
        label_id INTEGER NOT NULL REFERENCES labels(id),
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        PRIMARY KEY (issue_id, label_id),
        UNIQUE (issue_id, sequence)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS labels_workspace_name
        ON labels(workspace_id, name);

      CREATE VIEW IF NOT EXISTS issue_records AS
        SELECT issues.*,
               COALESCE((
                 SELECT json_group_array(name)
                 FROM (
                   SELECT labels.name AS name
                   FROM issue_labels
                   JOIN labels ON labels.id = issue_labels.label_id
                   WHERE issue_labels.issue_id = issues.id
                   ORDER BY issue_labels.sequence
                 )
               ), '[]') AS labels
        FROM issues;

      CREATE TABLE IF NOT EXISTS comments (
        sequence         INTEGER PRIMARY KEY AUTOINCREMENT,
        id               TEXT NOT NULL UNIQUE,
        issue_id         TEXT NOT NULL REFERENCES issues(id),
        body             TEXT NOT NULL,
        actor_type       TEXT NOT NULL CHECK (actor_type IN ('user', 'patrol_agent', 'reviewer', 'system')),
        actor_id         TEXT NOT NULL,
        actor_name       TEXT NOT NULL,
        actor_avatar_url TEXT,
        created_at       TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS comments_issue_sequence
        ON comments(issue_id, sequence);

      CREATE TABLE IF NOT EXISTS activities (
        sequence         INTEGER PRIMARY KEY AUTOINCREMENT,
        id               TEXT NOT NULL UNIQUE,
        issue_id         TEXT NOT NULL REFERENCES issues(id),
        actor_type       TEXT NOT NULL CHECK (actor_type IN ('user', 'patrol_agent', 'reviewer', 'system')),
        actor_id         TEXT NOT NULL,
        actor_name       TEXT NOT NULL,
        actor_avatar_url TEXT,
        changes          TEXT NOT NULL,
        created_at       TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS activities_issue_sequence
        ON activities(issue_id, sequence);

      CREATE TABLE IF NOT EXISTS relations (
        sequence        INTEGER PRIMARY KEY AUTOINCREMENT,
        id              TEXT NOT NULL UNIQUE,
        source_issue_id TEXT NOT NULL REFERENCES issues(id),
        target_issue_id TEXT NOT NULL REFERENCES issues(id),
        created_at      TEXT NOT NULL,
        UNIQUE (source_issue_id, target_issue_id),
        CHECK (source_issue_id != target_issue_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS relations_source
        ON relations(source_issue_id, sequence);

      CREATE INDEX IF NOT EXISTS relations_target
        ON relations(target_issue_id, sequence);
    `)
    if (onDisk === 0) {
      db.exec(`PRAGMA application_id = ${TASKBOARD_SQLITE_APPLICATION_ID}`)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
    db.exec('COMMIT')
    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    return db
  } catch (error: unknown) {
    /* v8 ignore else -- schema validation and initialization failures occur after BEGIN and before COMMIT. */
    if (db.isTransaction) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // The original schema or SQLite error remains the actionable cause.
      }
    }
    db.close()
    throw error
  }
}

/**
 * Convert stored Taskboard metadata to its public value.
 * @param row - SQLite metadata row.
 * @returns public Taskboard metadata.
 */
export function rowToWorkspace(row: WorkspaceRow): WorkspaceTaskboard {
  return {
    workspaceId: row.workspace_id as WorkspaceId,
    title: row.title,
    prefix: row.prefix,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Convert a stored Issue row to its public value.
 * @param row - SQLite Issue row.
 * @returns public Issue value.
 */
export function rowToIssue(row: IssueRow): Issue {
  return {
    id: IssueId(row.id),
    identifier: IssueIdentifier(row.identifier),
    workspaceId: row.workspace_id as WorkspaceId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    labels: JSON.parse(row.labels) as string[],
    assignee: row.assignee,
    startDate: row.start_date,
    dueDate: row.due_date,
    sortOrder: row.sort_order,
    version: row.version,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Convert a stored Comment row to its public value.
 * @param row - SQLite Comment row.
 * @returns public append-only Comment.
 */
export function rowToComment(row: CommentRow): Comment {
  return {
    id: CommentId(row.id),
    issueId: IssueId(row.issue_id),
    body: row.body,
    actor: {
      type: row.actor_type,
      id: TaskboardActorId(row.actor_id),
      name: row.actor_name,
      ...(row.actor_avatar_url === null ? {} : { avatarUrl: row.actor_avatar_url }),
    },
    createdAt: row.created_at,
  }
}

/**
 * Convert a stored Activity row to its public value.
 * @param row - SQLite Activity row.
 * @returns public append-only Activity.
 */
export function rowToActivity(row: ActivityRow): Activity {
  return {
    id: ActivityId(row.id),
    issueId: IssueId(row.issue_id),
    actor: {
      type: row.actor_type,
      id: TaskboardActorId(row.actor_id),
      name: row.actor_name,
      ...(row.actor_avatar_url === null ? {} : { avatarUrl: row.actor_avatar_url }),
    },
    changes: JSON.parse(row.changes) as Activity['changes'],
    createdAt: row.created_at,
  }
}

/**
 * Convert a directed relation row to one Issue-relative view.
 * @param row - SQLite directed relation row.
 * @param issueId - Issue from whose perspective the relation is returned.
 * @returns public relation view.
 */
export function rowToRelation(row: RelationRow, issueId: IssueId): IssueRelation {
  const blocks = row.source_issue_id === issueId
  return {
    id: RelationId(row.id),
    type: blocks ? 'blocks' : 'blocked_by',
    issueId,
    relatedIssueId: IssueId(blocks ? row.target_issue_id : row.source_issue_id),
    createdAt: row.created_at,
  }
}
