/** Browser assembly for the Workspace Taskboard shell surfaces. */

import type { ClientContext, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: generated Taskboard namespace and forwarded Host events.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: shell-chain and Workspace-row SlotMap declarations.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { IssueReference, TaskboardActor, TaskboardActorId } from '@deepseek-ai/dsh-taskboard/types'
import { TaskboardController } from './controller.ts'
import type { TaskboardInjected } from './contract.ts'
import { createTaskboardViewStore } from './store.ts'
import { TaskboardSurface } from './TaskboardSurface.tsx'
import { TaskboardDetails } from './TaskboardDetails.tsx'
import { TaskboardSidebarAction, type TaskboardSidebarInjected } from './TaskboardSidebarAction.tsx'
import { en, zh, type TaskboardKey } from './locales.ts'

export type {
  TaskboardDetailsProps, TaskboardInjected, TaskboardSurfaceProps,
} from './contract.ts'
export type { TaskboardSidebarActionProps, TaskboardSidebarInjected } from './TaskboardSidebarAction.tsx'
export type { TaskboardKey } from './locales.ts'
export { createTaskboardViewStore } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workspace Taskboard navigation, center views, and Issue details copy. */
    taskboard: TaskboardKey
  }
}

const NS = 'taskboard'
const USER_ACTOR: TaskboardActor = Object.freeze({
  type: 'user',
  id: 'local-user' as TaskboardActorId,
  name: 'User',
})

/** Services used by Taskboard UI assembly. */
export const inject = ['slots', 'layout', 'locale', 'remote', 'remote.taskboard']

/**
 * Register the Taskboard's Workspace entry point and paired shell-chain surfaces.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-taskboard: dictionaries')
  const controller = new TaskboardController(ctx.remote.taskboard)
  const store = createTaskboardViewStore()
  const injected = (): TaskboardInjected => ({
    hooks: { taskboard: controller },
    activate: workspaceId => controller.activate(workspaceId),
    refresh: () => controller.refresh(),
    createIssue: input => controller.createIssue(input),
    openIssue: (reference: IssueReference) => {
      ctx.layout.openDetails()
      void controller.selectIssue(reference)
    },
    moveIssue: (issue, patch) => controller.updateIssue(issue, patch, USER_ACTOR),
    updateIssue: (issue, patch) => controller.updateIssue(issue, patch, USER_ACTOR),
    archiveIssue: issue => controller.archiveIssue(issue, USER_ACTOR),
    addComment: body => controller.addComment(body, USER_ACTOR),
    addRelation: (type, reference) => controller.addRelation(type, reference, USER_ACTOR),
    removeRelation: relation => controller.removeRelation(relation, USER_ACTOR),
    close: () => {
      controller.clearSelection()
      ctx.layout.closeDetails()
    },
  })
  const sidebarInjected = (): TaskboardSidebarInjected => ({
    openTaskboard: (workspaceId: WorkspaceId) => {
      ctx.layout.openSurface({ id: 'taskboard', context: workspaceId })
    },
  })
  const selectTaskboard = ({ surface }: { surface: { id: string; context: string } | null }): WorkspaceId | null =>
    surface?.id === 'taskboard' ? surface.context as WorkspaceId : null

  ctx.effect(() => ctx.remote.$on('taskboard/changed', (workspaceId) => {
    if (controller.getSnapshot().workspaceId !== workspaceId) return
    void controller.refresh()
  }), 'ui-taskboard: pushed invalidations')

  ctx.slots.inject('sidebar.workspace.action', () => ctx.slots.register({
    name: 'sidebar.workspace.action',
    id: 'taskboard',
    order: -10,
    locale: NS,
    inject: sidebarInjected,
  }, TaskboardSidebarAction))
  ctx.slots.inject('shell.center', () => ctx.slots.register({
    name: 'shell.center',
    priority: 10,
    select: selectTaskboard,
    store,
    locale: NS,
    inject: injected,
  }, TaskboardSurface))
  ctx.slots.inject('shell.details', () => ctx.slots.register({
    name: 'shell.details',
    priority: 10,
    select: selectTaskboard,
    store,
    locale: NS,
    inject: injected,
  }, TaskboardDetails))
  ctx.effect(() => () => { controller.dispose() }, 'ui-taskboard: controller lifecycle')
}
