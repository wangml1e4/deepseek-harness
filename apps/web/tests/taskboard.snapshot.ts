// @vitest-environment jsdom
// Assembled Taskboard snapshot: boots the built browser plugin graph against
// FixtureApiClient, enters the implicit Taskboard from a Workspace row, and
// pins the shared Dashboard, Board, List, and right-column Issue detail path.
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
    const detail = [
      `issue=${detailPanel.textContent?.includes('FIX-1') === true ? 'FIX-1' : '<absent>'}`,
      `sections=${['Comments', 'Dependencies', 'Activity'].filter(label => detailPanel.textContent?.includes(label)).join(',')}`,
      `archive=${within(detailPanel).getByRole('button', { name: 'Archive Issue' }).textContent}`,
    ].join('\n')

    const shape = `${dashboard}\n${board}\nlist=${list}\n${detail}\n`
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
  })
})
