import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TaskboardRemoteResult, TaskboardTodoCountValue } from '@deepseek-ai/dsh-taskboard-remote/types'
import { TaskboardTodoCountController } from '../src/client/sidebar-counts.ts'

type CountResult = RemoteResult<TaskboardRemoteResult<TaskboardTodoCountValue>>

function success(count: number): CountResult {
  return { ok: true, value: { ok: true, value: { count } } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('TaskboardTodoCountController', () => {
  it('loads each row once and publishes changed mutation refreshes', async () => {
    let count = 2
    const remote = { todoCount: vi.fn(() => Promise.resolve(success(count))) }
    const controller = new TaskboardTodoCountController(remote)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    await Promise.all([controller.load('ws' as never), controller.load('ws' as never)])
    expect(remote.todoCount).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toEqual({ ws: 2 })
    expect(listener).toHaveBeenCalledOnce()

    await controller.load('ws' as never)
    await controller.refresh('ws' as never)
    expect(listener).toHaveBeenCalledOnce()
    count = 4
    await controller.refresh('ws' as never)
    expect(controller.getSnapshot()).toEqual({ ws: 4 })
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    count = 5
    await controller.refresh('ws' as never)
    expect(controller.getSnapshot()).toEqual({ ws: 5 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps counts absent across carrier and business failures', async () => {
    const remote = { todoCount: vi.fn()
      .mockResolvedValueOnce({ ok: false, error: new Error('offline') })
      .mockResolvedValueOnce({ ok: true, value: { ok: false, error: { code: 'workspace_not_found', message: 'missing' } } }) }
    const controller = new TaskboardTodoCountController(remote)

    await controller.load('missing' as never)
    await controller.load('missing' as never)
    expect(controller.getSnapshot()).toEqual({})
    expect(remote.todoCount).toHaveBeenCalledTimes(2)
  })

  it('ignores stale and post-disposal request results', async () => {
    const first = deferred<CountResult>()
    const second = deferred<CountResult>()
    const late = deferred<CountResult>()
    const remote = { todoCount: vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(late.promise) }
    const controller = new TaskboardTodoCountController(remote)

    const oldLoad = controller.load('ws' as never)
    const refresh = controller.refresh('ws' as never)
    second.resolve(success(3))
    await refresh
    first.resolve(success(1))
    await oldLoad
    expect(controller.getSnapshot()).toEqual({ ws: 3 })

    const disposedRefresh = controller.refresh('ws' as never)
    controller.dispose()
    late.resolve(success(9))
    await disposedRefresh
    expect(controller.getSnapshot()).toEqual({ ws: 3 })
  })

  it('contains Remote and subscriber failures', async () => {
    const remote = { todoCount: vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(success(1)) }
    const controller = new TaskboardTodoCountController(remote)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const afterFailure = vi.fn()
    controller.subscribe(() => { throw new Error('subscriber failed') })
    controller.subscribe(afterFailure)

    await controller.load('ws' as never)
    await controller.load('ws' as never)
    expect(controller.getSnapshot()).toEqual({ ws: 1 })
    expect(afterFailure).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('[ui-taskboard] todo-count load failed:', expect.any(Error))
    expect(log).toHaveBeenCalledWith('[ui-taskboard] todo-count listener threw:', expect.any(Error))
    log.mockRestore()
  })
})
