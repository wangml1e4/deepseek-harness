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
    first.actions.setLabel('ui')

    expect(first.getSnapshot()).toEqual({
      mode: 'board', query: 'frontend', status: 'todo', priority: 'high', label: 'ui',
    })

    const restored = createTaskboardViewStore().create()
    expect(restored.getSnapshot()).toEqual(first.getSnapshot())
    restored.actions.resetFilters()
    expect(restored.getSnapshot()).toEqual({
      mode: 'board', query: '', status: 'all', priority: 'all', label: '',
    })
  })
})
