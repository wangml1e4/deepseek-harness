// Keyless assembled-Web scenario for persisted, cold-session Token usage.
// Events are synthetic durable log records; no provider or production API is called.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  SESSION_FORMAT_VERSION, SessionId, type SessionEvent, type SessionHeader,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-token-meter'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/token-usage-settings', import.meta.url))
const SUMMARY_EXPECTED = join(SNAPSHOT_DIR, 'summary.expected.md')
const MODE = webSnapshotMode()
const FIXED_NOW = new Date('2026-08-14T12:00:00.000Z')

interface UsageSeed {
  date: string
  turn: number
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  chunkUsage?: {
    inputTokens: number
    outputTokens: number
  }
  durationMs: number
}

interface LegacyProjectionCacheAccess {
  table?: {
    put(
      sessionId: SessionId,
      record: {
        identity: { createdAt: number; cwd: string }
        rows: Record<string, never>
      },
    ): Promise<void>
  }
}

const legacyHeaders = new Map<SessionId, SessionHeader>()

function seedEvents(rows: readonly UsageSeed[]): SessionEvent[] {
  const events: SessionEvent[] = []
  let seq = 0
  const push = (time: number, type: string, data: unknown, surfaceOp?: 'append'): void => {
    events.push({ type, seq: seq++, time, data, ...surfaceOp === undefined ? {} : { surfaceOp } } as unknown as SessionEvent)
  }
  for (const row of rows) {
    const start = Date.parse(`${row.date}T08:00:00.000Z`)
    push(start, 'turn/start', { turn: row.turn, trigger: { kind: 'message', source: { kind: 'user' } } })
    push(start + 1, 'user/message', {
      content: [{ type: 'text', text: `usage ${row.turn}` }],
      source: { kind: 'user', rpcId: `usage-rpc-${row.turn}`, clientTimeZone: 'Asia/Shanghai' },
    }, 'append')
    push(start + 2, 'step/start', { turn: row.turn, step: 1 })
    if (row.chunkUsage !== undefined) {
      push(start + 3, 'assistant/chunk', {
        turn: row.turn, step: 1, chunk: { type: 'usage', usage: row.chunkUsage },
      })
    }
    push(start + 4, 'assistant/message', {
      turn: row.turn,
      step: 1,
      message: {
        id: `00000000-0000-4000-8000-${String(row.turn).padStart(12, '0')}`,
        role: 'assistant',
        content: [{ type: 'text', text: `usage reply ${row.turn}` }],
        source: { kind: 'model', provider: 'snapshot', model: 'usage-fixture' },
      },
      usage: row.usage,
    }, 'append')
    push(start + 5, 'step/end', { turn: row.turn, step: 1 })
    push(start + row.durationMs, 'turn/end', { turn: row.turn, reason: { kind: 'completed' } })
  }
  return events
}

async function persistColdWithLegacyCache(
  scaffold: WebScaffold,
  id: string,
  rows: readonly UsageSeed[],
  lineage?: { parentSession: SessionId; seed: readonly SessionEvent[] },
): Promise<void> {
  const sessionId = SessionId(id)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: Date.parse(`${rows[0]!.date}T08:00:00.000Z`),
    cwd: scaffold.workspaceCwd,
    ...lineage === undefined
      ? {}
      : { parentSession: lineage.parentSession, seedLength: lineage.seed.length },
  }
  await scaffold.ctx.sessionPersistence.create(header)
  const seedBoundary = lineage === undefined
    ? []
    : [{
      type: 'session/end-seed',
      seq: lineage.seed.length,
      time: lineage.seed.at(-1)?.time ?? header.createdAt,
      data: {},
    } as unknown as SessionEvent]
  const ownBase = lineage === undefined ? 0 : lineage.seed.length + 1
  const ownEvents = seedEvents(rows).map(event => ({ ...event, seq: event.seq + ownBase }))
  await scaffold.ctx.sessionPersistence.append(sessionId, [
    ...(lineage?.seed ?? []),
    ...seedBoundary,
    ...ownEvents,
  ])
  // Upgrade regression: write the shape a pre-tokenActivity cache could have
  // held, directly through the already-open cache table. Do not call
  // coldSnapshot here: opening Settings must be the action that exact-folds
  // the durable log and writes the new key back.
  const table = (scaffold.ctx.sessionProjectionCache as unknown as LegacyProjectionCacheAccess).table
  if (table === undefined) throw new Error('projection cache table did not initialize')
  await table.put(sessionId, {
    identity: { createdAt: header.createdAt, cwd: scaffold.workspaceCwd },
    rows: {},
  })
  legacyHeaders.set(sessionId, header)
}

async function persistColdWithStaleCache(
  scaffold: WebScaffold,
  id: string,
  rows: readonly [UsageSeed, ...UsageSeed[]],
): Promise<void> {
  const sessionId = SessionId(id)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: Date.parse(`${rows[0].date}T08:00:00.000Z`),
    cwd: scaffold.workspaceCwd,
  }
  await scaffold.ctx.sessionPersistence.create(header)
  const cachedEvents = seedEvents([rows[0]])
  await scaffold.ctx.sessionPersistence.append(sessionId, cachedEvents)
  const cached = await scaffold.ctx.sessionProjectionCache.coldSnapshot(sessionId)
  if (cached.values.tokenActivity === undefined) throw new Error('stale activity fixture did not cache its first turn')
  const laterEvents = seedEvents(rows.slice(1)).map(event => ({
    ...event,
    seq: event.seq + cachedEvents.length,
  }))
  await scaffold.ctx.sessionPersistence.append(sessionId, laterEvents)
  legacyHeaders.set(sessionId, header)
}

describe('web e2e: Token usage settings over cold persisted sessions', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    if (MODE === 'record') throw new Error('token-usage-settings is a keyless assembled snapshot')
    scaffold = await launchWebScaffold({})
    await persistColdWithStaleCache(scaffold, 'token-usage-cold-a', [
      { date: '2026-08-12', turn: 1, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 5 }, durationMs: 30_000 },
      {
        date: '2026-08-13', turn: 2,
        chunkUsage: { inputTokens: 100, outputTokens: 10 },
        usage: { inputTokens: 1_200, outputTokens: 300, cacheReadTokens: 500, cacheWriteTokens: 200 },
        durationMs: 125_000,
      },
      { date: '2026-08-14', turn: 3, usage: { inputTokens: 50, outputTokens: 25 }, durationMs: 10_000 },
    ])
    const parentId = SessionId('token-usage-cold-b')
    const parentRows = [
      { date: '2026-08-13', turn: 1, usage: { inputTokens: 200, outputTokens: 100 }, durationMs: 60_000 },
    ] as const
    await persistColdWithLegacyCache(scaffold, parentId, parentRows)
    await persistColdWithLegacyCache(scaffold, 'token-usage-cold-child', [
      { date: '2026-08-14', turn: 2, usage: { inputTokens: 30, outputTokens: 20 }, durationMs: 15_000 },
    ], { parentSession: parentId, seed: seedEvents(parentRows) })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 960, height: 900 },
      locale: ZH_BROWSER_LOCALE,
      timezoneId: 'Asia/Shanghai',
    })
    await page.clock.setFixedTime(FIXED_NOW)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('lists the page and updates heatmap and peak across all three granularities', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-token-usage-settings'))
    const settingsTrigger = page.locator('button[aria-haspopup="dialog"]')
    expect(await settingsTrigger.count()).toBe(1)
    await settingsTrigger.click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: 'Token 用量' }).click()
    const section = dialog.locator('[data-token-usage-section]')
    await section.getByRole('heading', { name: 'Token 用量' }).waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('button', { name: 'Token 用量' }).getAttribute('aria-current')).toBe('true')
    await section.getByLabel('累计 Token 数: 2,760 Token').waitFor({ timeout: 10_000 })
    expect(await section.getByLabel('峰值 Token 数: 2,500 Token').count()).toBe(1)
    expect(await section.getByLabel('最长工作时间: 2分5秒').count()).toBe(1)
    expect(await section.getByLabel('当前连续天数: 3 天').count()).toBe(1)
    expect(await section.getByLabel('最长连续天数: 3 天').count()).toBe(1)
    expect(await section.getByRole('button', { name: /2026年8月13日：2,500 Token/ }).count()).toBe(1)
    expect(await section.getByRole('button', { name: /2026年8月14日：125 Token/ }).count()).toBe(1)

    const weekly = section.getByRole('button', { name: '每周' })
    await weekly.click()
    expect(await weekly.getAttribute('aria-pressed')).toBe('true')
    expect(await section.getByLabel('峰值 Token 数: 2,760 Token').count()).toBe(1)
    const monthly = section.getByRole('button', { name: '每月' })
    await monthly.click()
    expect(await monthly.getAttribute('aria-pressed')).toBe('true')
    expect(await section.getByLabel('峰值 Token 数: 2,760 Token').count()).toBe(1)
    const daily = section.getByRole('button', { name: '每日' })
    await daily.click()
    expect(await daily.getAttribute('aria-pressed')).toBe('true')

    const snapshot = await captureStableAria(page, '[data-token-usage-summary]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SUMMARY_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('replaces the stale cold value with the exact key and keeps the browser console clean', async () => {
    const id = SessionId('token-usage-cold-a')
    const header = legacyHeaders.get(id)
    if (header === undefined) throw new Error('legacy cache header missing')
    const snapshot = scaffold.ctx.sessionProjectionCache.cachedSnapshot(header)
    if (snapshot === undefined) throw new Error('exact projection cache write-back missing')
    expect(snapshot.values.tokenActivity).toMatchObject({ longestCompletedTurnMs: 125_000 })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['summary.expected.md'])
  })
})
