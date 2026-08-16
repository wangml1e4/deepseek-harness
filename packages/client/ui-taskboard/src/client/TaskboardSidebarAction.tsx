/** Compact Workspace-row entry point for its implicit Taskboard. */

import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import css from './Taskboard.module.css'
import type { TaskboardTodoCounts } from './sidebar-counts.ts'

/** Injected navigation callback for the Workspace row contribution. */
export interface TaskboardSidebarInjected {
  hooks: { taskboardTodoCounts: HostObservable<TaskboardTodoCounts> }
  loadTodoCount: (workspaceId: WorkspaceId) => Promise<void>
  openTaskboard: (workspaceId: WorkspaceId) => void
}

/** Full Workspace-row action props. */
export type TaskboardSidebarActionProps =
  & PropsRuntime<'sidebar.workspace.action'>
  & InjectFace<TaskboardSidebarInjected>
  & PropsLocale<'taskboard'>

/** Open the selected Workspace's Taskboard without toggling its session group. */
export function TaskboardSidebarAction({
  workspaceId,
  title,
  useTaskboardTodoCounts,
  loadTodoCount,
  openTaskboard,
  t,
}: TaskboardSidebarActionProps) {
  const todoCount = useTaskboardTodoCounts(counts => counts[workspaceId])
  useEffect(() => { void loadTodoCount(workspaceId) }, [loadTodoCount, workspaceId])
  return (
    <button
      type="button"
      className={css.sidebarAction}
      aria-label={todoCount === undefined
        ? t('sidebar.open', { name: title })
        : t('sidebar.openTodo', { name: title, count: todoCount })}
      onClick={() => { openTaskboard(workspaceId) }}
    >
      <IconChecklistOutline14 />
      {todoCount !== undefined && <span className={css.sidebarBadge}>{todoCount}</span>}
    </button>
  )
}
