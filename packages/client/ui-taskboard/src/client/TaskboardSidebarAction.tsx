/** Compact Workspace-row entry point for its implicit Taskboard. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import css from './Taskboard.module.css'

/** Injected navigation callback for the Workspace row contribution. */
export interface TaskboardSidebarInjected {
  openTaskboard: (workspaceId: WorkspaceId) => void
}

/** Full Workspace-row action props. */
export type TaskboardSidebarActionProps =
  & PropsRuntime<'sidebar.workspace.action'>
  & TaskboardSidebarInjected
  & PropsLocale<'taskboard'>

/** Open the selected Workspace's Taskboard without toggling its session group. */
export function TaskboardSidebarAction({ workspaceId, title, openTaskboard, t }: TaskboardSidebarActionProps) {
  return (
    <button
      type="button"
      className={css.sidebarAction}
      aria-label={t('sidebar.open', { name: title })}
      onClick={() => { openTaskboard(workspaceId) }}
    >
      <IconChecklistOutline14 />
    </button>
  )
}
