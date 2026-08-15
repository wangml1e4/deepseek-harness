// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { TokenUsageSection, type TokenUsageSectionProps } from '../src/client/TokenUsageSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const emptySessions: SessionListState = {
  ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {},
  jobsBySession: {}, currentAddress: undefined,
}

function hook(state: SessionListState): SnapshotSelectorHook<SessionListState> {
  return selector => selector(state)
}

function props(state = emptySessions): TokenUsageSectionProps {
  return {
    close: () => {},
    useSessions: hook(state),
    useWorkspaces: () => { throw new Error('unused') },
    t: (key, params) => Object.entries(params ?? {}).reduce(
      (copy, [name, value]) => copy.replaceAll(`{${name}}`, value),
      zh[key],
    ),
    locale: () => 'zh-CN',
    timeZone: () => 'Asia/Shanghai',
    now: () => Date.parse('2026-08-14T12:00:00.000Z'),
    hydrateActivity: () => Promise.resolve({ failed: [] }),
  }
}

function populated(): SessionListState {
  const summary = {
    id: 'session-1', displayTitle: 'one', running: false, blank: false, updatedAt: 0,
    projectionValues: {
      tokenActivity: {
        days: [{
          date: '2026-08-14', uncachedInputTokens: 1_000, outputTokens: 300,
          cacheReadTokens: 500, cacheWriteTokens: 200,
        }],
        longestCompletedTurnMs: 125_000,
      },
    },
  } as unknown as SessionSummary
  return { ...emptySessions, ids: [summary.id], byId: { [summary.id]: summary } }
}

describe('TokenUsageSection', () => {
  it('shows all summaries, a clear empty state, explicit zone semantics, and neutral accessible days', () => {
    render(<TokenUsageSection {...props()} />)
    expect(screen.getByRole('heading', { name: 'Token 用量' })).toBeDefined()
    expect(screen.getByText(zh.intro)).toBeDefined()
    const summary = screen.getByRole('list', { name: 'Token 用量' })
    expect(within(summary).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('status').textContent).toContain(zh.empty)
    expect(screen.getByText('日界线使用 Asia/Shanghai；每周从周一开始。')).toBeDefined()
    expect(screen.getAllByRole('button', { name: /Token$/ }).length).toBeGreaterThan(300)
  })

  it('formats the visual total compactly but exposes the full value', () => {
    render(<TokenUsageSection {...props(populated())} />)
    const total = screen.getByLabelText('累计 Token 数: 2,000 Token')
    expect(total.textContent).toContain('2000')
    expect(total.getAttribute('title')).toBe('2,000 Token')
    expect(screen.getByLabelText('最长工作时间: 2分5秒')).toBeDefined()
  })

  it('hydrates listed sessions even when the list already carries cached activity', async () => {
    const requested: string[][] = []
    const hydrateActivity: TokenUsageSectionProps['hydrateActivity'] = (sessionIds) => {
      requested.push([...sessionIds])
      return Promise.resolve({ failed: [] })
    }
    const view = render(<TokenUsageSection {...props(populated())} hydrateActivity={hydrateActivity} />)
    await waitFor(() => { expect(requested).toEqual([['session-1']]) })
    view.rerender(<TokenUsageSection {...props(populated())} hydrateActivity={hydrateActivity} />)
    expect(requested).toEqual([['session-1']])
  })

  it('switches all three keyboard buttons and updates pressed state and chart identity', () => {
    const { container } = render(<TokenUsageSection {...props(populated())} />)
    const daily = screen.getByRole('button', { name: zh.daily })
    const weekly = screen.getByRole('button', { name: zh.weekly })
    const monthly = screen.getByRole('button', { name: zh.monthly })
    expect(daily.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(weekly)
    expect(weekly.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-token-usage-section]')?.getAttribute('data-granularity')).toBe('week')
    fireEvent.click(monthly)
    expect(monthly.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-token-usage-section]')?.getAttribute('data-granularity')).toBe('month')
  })

  it('keeps heat cells natively keyboard-focusable and names the exact period and token count', () => {
    render(<TokenUsageSection {...props(populated())} />)
    const cell = screen.getByRole('button', { name: /2026年8月14日：2,000 Token/ })
    expect(cell.tagName).toBe('BUTTON')
    expect(cell.getAttribute('title')).toContain('2,000 Token')
  })

  it('distinguishes exact-loading failure from a genuine zero state and offers retry', async () => {
    const coldId = 'cold' as SessionListState['ids'][number]
    const missing = {
      ...emptySessions,
      ids: [coldId],
      byId: {
        [coldId]: {
          id: coldId, displayTitle: 'cold', running: false, blank: false, updatedAt: 0,
        } as SessionSummary,
      },
    }
    let calls = 0
    render(<TokenUsageSection {...props(missing)} hydrateActivity={() => {
      calls += 1
      return Promise.resolve({ failed: [coldId] })
    }} />)
    expect(screen.getByRole('status').textContent).toContain(zh.loading)
    expect(screen.queryByText(zh.empty)).toBeNull()
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('1 个会话')
    })
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    await waitFor(() => { expect(calls).toBe(2) })
  })
})
