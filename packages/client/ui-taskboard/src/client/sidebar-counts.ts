/** React-free todo-count projection for Workspace Taskboard sidebar actions. */

import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  TaskboardRemoteResult,
  TaskboardTodoCountValue,
} from '@deepseek-ai/dsh-taskboard-remote/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Loaded Workspace todo counts keyed by stable Workspace identity. */
export type TaskboardTodoCounts = Readonly<Record<string, number | undefined>>

interface TodoCountRemote {
  todoCount: (
    workspaceId: WorkspaceId,
  ) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardTodoCountValue>>>
}

/** Share and invalidate per-Workspace todo counts without loading complete Issue records. */
export class TaskboardTodoCountController implements HostObservable<TaskboardTodoCounts> {
  private snapshot: TaskboardTodoCounts = Object.freeze({})
  private readonly listeners = new Set<() => void>()
  private readonly revisions = new Map<WorkspaceId, number>()
  private readonly inflight = new Map<WorkspaceId, Promise<void>>()
  private disposed = false

  constructor(private readonly remote: TodoCountRemote) {}

  /** Read the immutable count map. */
  getSnapshot = (): TaskboardTodoCounts => this.snapshot

  /** Subscribe to count changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Load a count once when its Workspace row first mounts.
   * @param workspaceId - Workspace whose sidebar count is requested.
   */
  load(workspaceId: WorkspaceId): Promise<void> {
    if (Object.hasOwn(this.snapshot, workspaceId)) return Promise.resolve()
    return this.inflight.get(workspaceId) ?? this.request(workspaceId)
  }

  /**
   * Refresh one Workspace after a Taskboard mutation.
   * @param workspaceId - Workspace whose sidebar count changed.
   */
  refresh(workspaceId: WorkspaceId): Promise<void> {
    return this.request(workspaceId)
  }

  /** Ignore every late request after plugin disposal. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    this.inflight.clear()
  }

  private request(workspaceId: WorkspaceId): Promise<void> {
    const revision = (this.revisions.get(workspaceId) ?? 0) + 1
    this.revisions.set(workspaceId, revision)
    const request = this.remote.todoCount(workspaceId).then((result) => {
      if (this.disposed || this.revisions.get(workspaceId) !== revision) return
      if (!result.ok || !result.value.ok) return
      const count = result.value.value.count
      if (this.snapshot[workspaceId] === count) return
      this.snapshot = Object.freeze({ ...this.snapshot, [workspaceId]: count })
      for (const listener of this.listeners) {
        try {
          listener()
        } catch (error: unknown) {
          console.error('[ui-taskboard] todo-count listener threw:', error)
        }
      }
    }).catch((error: unknown) => {
      console.error('[ui-taskboard] todo-count load failed:', error)
    }).finally(() => {
      if (this.inflight.get(workspaceId) === request) this.inflight.delete(workspaceId)
    })
    this.inflight.set(workspaceId, request)
    return request
  }
}
