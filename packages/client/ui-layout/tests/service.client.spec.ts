/**
 * LayoutController behavior: the cross-plugin panel-action face. Geometry
 * lives in the entry store (layout-store.spec.ts) — here we assert the
 * delegation contract: attachPanels wiring, the three actions forwarding, the
 * unwired fail-loud, and re-attach overwriting a stale action set.
 */
import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards the three panel actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('publishes an alternate shell surface and returns to conversation', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    const notified = vi.fn()
    service.attachPanels(panels)
    const unsubscribe = service.subscribe(notified)

    service.openSurface({ id: 'taskboard', context: 'workspace-1' })

    expect(service.getSnapshot()).toEqual({ id: 'taskboard', context: 'workspace-1' })
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(notified).toHaveBeenCalledTimes(1)

    service.showConversation()

    expect(service.getSnapshot()).toBeNull()
    expect(panels.closeDetails).toHaveBeenCalledTimes(2)
    expect(notified).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('does not republish an identical shell surface', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    const notified = vi.fn()
    service.attachPanels(panels)
    service.subscribe(notified)

    service.openSurface({ id: 'taskboard', context: 'workspace-1' })
    service.openSurface({ id: 'taskboard', context: 'workspace-1' })

    expect(notified).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
  })

  it('contains surface observer failures and keeps notifying subscribers', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    const notified = vi.fn()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    service.attachPanels(panels)
    service.subscribe(() => { throw new Error('surface observer') })
    service.subscribe(notified)

    expect(() => { service.openSurface({ id: 'taskboard', context: 'workspace-1' }) }).not.toThrow()

    expect(notified).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('[ui-layout] surface listener threw:', expect.any(Error))
    log.mockRestore()
  })
})
