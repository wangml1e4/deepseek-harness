/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/** One plugin-owned replacement for the center and details surfaces. */
export interface LayoutSurface {
  /** Stable surface family used by chain selectors. */
  readonly id: string
  /** Opaque entity identity interpreted by the selected surface plugin. */
  readonly context: string
}

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout extends HostObservable<LayoutSurface | null> {
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /** Replace the conversation and details surfaces for one plugin-owned context. */
  openSurface(surface: LayoutSurface): void
  /** Return to the resident conversation surface. */
  showConversation(): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  #surface: LayoutSurface | null = null
  readonly #listeners = new Set<() => void>()

  /** Read the current alternate surface, or null for conversation. */
  getSnapshot = (): LayoutSurface | null => this.#surface

  /** Subscribe to alternate-surface changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /** Replace the conversation and details surfaces for one plugin-owned context. */
  openSurface(surface: LayoutSurface): void {
    if (this.#surface !== null && this.#surface.id === surface.id && this.#surface.context === surface.context) return
    this.#require().closeDetails()
    this.#publishSurface(Object.freeze({ ...surface }))
  }

  /** Return to the resident conversation surface. */
  showConversation(): void {
    if (this.#surface === null) return
    this.#require().closeDetails()
    this.#publishSurface(null)
  }

  #publishSurface(surface: LayoutSurface | null): void {
    this.#surface = surface
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch (error: unknown) {
        console.error('[ui-layout] surface listener threw:', error)
      }
    }
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
