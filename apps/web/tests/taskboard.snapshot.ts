// @vitest-environment jsdom
// Assembled Taskboard snapshot: boots the built browser plugin graph against
// FixtureApiClient, enters the implicit Taskboard from a Workspace row, and
// pins the shared Dashboard, Board, List, Gantt, and right-column Issue detail path.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/snapshots/taskboard/workspace-taskboard.expected.txt')

installAssembledBootEnv()

describe('assembled Workspace Taskboard', () => {
  it('opens from the Workspace row and preserves one Issue set across every V1 view', async () => {
    mountAssembledApp()

    const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
    const workspaceRow = (await within(tree).findAllByText('fixture'))
      .map(node => node.closest<HTMLElement>('[role="treeitem"]'))
      .find(node => node?.getAttribute('aria-expanded') !== null)
    if (workspaceRow === undefined || workspaceRow === null) throw new Error('fixture Workspace row missing')
    fireEvent.mouseEnter(workspaceRow)
    fireEvent.click(await within(tree).findByRole(
      'button',
      { name: 'Open Taskboard for fixture' },
      { timeout: 10_000 },
    ))

    const surface = await screen.findByRole('main', undefined, { timeout: 10_000 })
    await within(surface).findByText('Ship Taskboard dashboard')
    const dashboard = [
      `title=${within(surface).getByRole('heading', { level: 1 }).textContent}`,
      `tabs=${within(surface).getAllByRole('tab').map(tab => `${tab.textContent}:${tab.getAttribute('aria-selected')}`).join('|')}`,
      `metrics=${['Completion', 'All Issues', 'Active', 'Overdue'].map(label => within(surface).getByText(label).parentElement?.textContent).join('|')}`,
      `recent=${['FIX-1', 'FIX-2', 'FIX-3'].filter(id => surface.textContent?.includes(id)).join(',')}`,
    ].join('\n')

    fireEvent.click(within(surface).getByRole('tab', { name: 'Board' }))
    await waitFor(() => { expect(surface.querySelectorAll('[data-status]').length).toBeGreaterThanOrEqual(7) })
    const board = `columns=${['Backlog', 'Todo', 'In progress', 'In review', 'Blocked', 'Done', 'Canceled'].map(label => within(surface).getByRole('heading', { name: label }).parentElement?.textContent).join('|')}`

    fireEvent.click(within(surface).getByRole('tab', { name: 'List' }))
    const table = await within(surface).findByRole('table', { name: 'Issue list' })
    const list = [...within(table).getAllByRole('row')].map(row => row.textContent?.trim()).join('|')

    fireEvent.click(within(table).getByRole('button', { name: /FIX-1/ }))
    const details = await screen.findByText('Keep the Taskboard scoped to its Workspace.', undefined, { timeout: 10_000 })
    const detailPanel = details.closest('aside')
    if (detailPanel === null) throw new Error('Issue details must render in the right column')
    await within(detailPanel).findByText('taskboard-preview.png')
    fireEvent.click(within(detailPanel).getByRole('button', { name: 'Preview taskboard-preview.png' }))
    await within(detailPanel).findByRole('img', { name: 'taskboard-preview.png' })
    const detail = [
      `issue=${detailPanel.textContent?.includes('FIX-1') ? 'FIX-1' : '<absent>'}`,
      `sections=${['Attachments', 'Comments', 'Dependencies', 'Activity'].filter(label => detailPanel.textContent?.includes(label)).join(',')}`,
      `attachment=${detailPanel.textContent?.includes('taskboard-preview.png') ? 'taskboard-preview.png' : '<absent>'}|preview=${within(detailPanel).queryByRole('img', { name: 'taskboard-preview.png' }) === null ? '<absent>' : 'visible'}`,
      `dependency=${detailPanel.textContent?.includes('FIX-2') ? 'FIX-2' : '<absent>'}`,
      `archive=${within(detailPanel).getByRole('button', { name: 'Archive Issue' }).textContent}`,
    ].join('\n')

    fireEvent.click(within(surface).getByRole('button', { name: 'Open Patrol settings' }))
    const patrolStatus = await screen.findByText('Patrol disabled', undefined, { timeout: 10_000 })
    const patrolPanel = patrolStatus.closest('aside')
    if (patrolPanel === null) throw new Error('Patrol settings must reuse the right column')
    const interval = within(patrolPanel).getByRole('combobox', { name: 'Fixed interval' }) as HTMLSelectElement
    fireEvent.change(interval, { target: { value: '30m' } })
    fireEvent.click(within(patrolPanel).getByRole('switch', { name: 'Enable or disable automatic Patrol' }))
    await within(patrolPanel).findByText('Patrol enabled')
    fireEvent.click(within(patrolPanel).getByRole('button', { name: 'Run now' }))
    await within(patrolPanel).findByText('No eligible Issue')
    const patrol = [
      `patrol=${patrolPanel.textContent?.includes('Patrol enabled') ? 'enabled' : 'disabled'}`,
      `interval=${interval.value}`,
      `permissions=${[...within(patrolPanel).getByRole('combobox', { name: 'Permission preset' }).querySelectorAll('option')].map(option => option.textContent).join('|')}`,
      `run=${patrolPanel.textContent?.includes('No eligible Issue') ? 'no_eligible_issue' : '<absent>'}`,
      `recovery=${patrolPanel.textContent?.includes('Recovered 1 time(s)') ? 'visible' : '<absent>'}`,
    ].join('\n')
    fireEvent.click(within(patrolPanel).getByRole('button', { name: 'Close Patrol settings' }))

    fireEvent.click(within(table).getByRole('button', { name: /FIX-2/ }))
    const reviewFinding = await screen.findByText(
      'Keep the SQLite mutation and Activity write in one transaction.',
      undefined,
      { timeout: 10_000 },
    )
    const reviewPanel = reviewFinding.closest('aside')
    if (reviewPanel === null) throw new Error('Reviewer evidence must render in the right column')
    const review = [
      `session=${within(reviewPanel).getByText('fx-beta').textContent}`,
      `review=${['Reviewer requested changes', 'Verification:', 'Remaining risks:'].filter(label => reviewPanel.textContent?.includes(label)).join('|')}`,
      `human=${['Return to todo', 'Mark done'].map(label => within(reviewPanel).getByRole('button', { name: label }).textContent).join('|')}`,
    ].join('\n')

    fireEvent.click(within(surface).getByRole('tab', { name: 'Gantt' }))
    const gantt = await within(surface).findByLabelText('Issue Gantt chart')
    await waitFor(() => { expect(gantt.querySelector('.gantt_container')).not.toBeNull() })
    await waitFor(() => { expect(gantt.querySelectorAll('.gantt_task_link')).toHaveLength(1) })
    const ganttStyles = document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-client-ui-taskboard/dhtmlxgantt.css"]')
    expect(ganttStyles?.textContent).toContain('.gantt_container')
    const scale = within(surface).getByLabelText('Gantt timeline scale') as HTMLSelectElement
    const timeline = `gantt=${scale.value}|mounted=${gantt.querySelector('.gantt_container') !== null}|styled=${ganttStyles !== null}|links=${gantt.querySelectorAll('.gantt_task_link').length}`

    const currentTree = screen.getByRole('tree', { name: 'Sessions' })
    const currentWorkspaceRow = within(currentTree).getAllByText('fixture')
      .map(node => node.closest<HTMLElement>('[role="treeitem"]'))
      .find(node => node?.getAttribute('aria-expanded') !== null)
    if (currentWorkspaceRow === undefined || currentWorkspaceRow === null) {
      throw new Error('current fixture Workspace row missing')
    }
    fireEvent.mouseEnter(currentWorkspaceRow)
    fireEvent.click(within(currentWorkspaceRow).getByRole('button', { name: 'Workspace actions for fixture' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete workspace' }))
    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete workspace' })
    const explainsMigration = deleteDialog.textContent?.includes(
      'Move every active and archived Taskboard Issue to another workspace first.',
    ) ?? false
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete workspace' }))
    const deleteFailure = await within(deleteDialog).findByRole('alert')
    const workspaceDelete = `workspaceDelete=migration:${explainsMigration ? 'visible' : '<absent>'}|blocked:${deleteFailure.textContent?.includes('Move all 3 active or archived Taskboard Issues') ?? false ? 'taskboard-issues' : '<absent>'}`

    const shape = `${dashboard}\n${board}\nlist=${list}\n${detail}\n${patrol}\n${review}\n${timeline}\n${workspaceDelete}\n`
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
  })
})
