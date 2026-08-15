import { describe, expect, it } from 'vitest'
import { API_REMOTE_FORWARDED_EVENTS } from '../src/remote-events.ts'

describe('Taskboard Remote event selection', () => {
  it('forwards Workspace-scoped Taskboard invalidations to browser Consumers', () => {
    expect(API_REMOTE_FORWARDED_EVENTS).toContain('taskboard/changed')
  })
})
