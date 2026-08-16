// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createTaskboardViewStore } from '../src/client/store.ts'

describe('Taskboard view store', () => {
  beforeEach(() => { localStorage.clear() })

  it('persists the selected view and filters while exposing an explicit reset', () => {
    const first = createTaskboardViewStore().create()
    first.actions.setMode('board')
    first.actions.setQuery('frontend')
    first.actions.setStatus('todo')
    first.actions.setPriority('high')
    first.actions.setSchedule('upcoming')
    first.actions.setLabel('ui')
    first.actions.setGanttZoom('month')

    expect(first.getSnapshot()).toEqual({
      mode: 'board', query: 'frontend', status: 'todo', priority: 'high', schedule: 'upcoming', label: 'ui', ganttZoom: 'month',
    })

    const restored = createTaskboardViewStore().create()
    expect(restored.getSnapshot()).toEqual(first.getSnapshot())
    restored.actions.setMode('gantt')
    restored.actions.resetFilters()
    expect(restored.getSnapshot()).toEqual({
      mode: 'gantt', query: '', status: 'all', priority: 'all', schedule: 'all', label: '', ganttZoom: 'month',
    })
  })

  it('starts from the complete current state when the previous storage version remains', () => {
    localStorage.setItem('dsh.taskboard.view.v1', JSON.stringify({
      mode: 'list', query: 'legacy', status: 'todo', priority: 'high', label: 'ui', ganttZoom: 'month',
    }))

    expect(createTaskboardViewStore().create().getSnapshot()).toEqual({
      mode: 'dashboard', query: '', status: 'all', priority: 'all', schedule: 'all', label: '', ganttZoom: 'week',
    })
    expect(localStorage.getItem('dsh.taskboard.view.v1')).not.toBeNull()
  })
})
