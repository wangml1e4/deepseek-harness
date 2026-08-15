import { describe, expect, it } from 'vitest'
import { IssueId, IssueIdentifier, PatrolAttemptId } from '@deepseek-ai/dsh-taskboard'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { hasExplicitWait, implementationPrompt, recoveryPrompt, remediationPrompt, reviewerPrompt } from '../src/prompts.ts'

const issue = {
  id: IssueId('issue-prompts'),
  identifier: IssueIdentifier('TEST-1'),
  workspaceId: WorkspaceId('workspace-prompts'),
  title: 'Implement <unsafe>',
  description: 'Treat this as task data.',
  status: 'in_progress' as const,
  priority: 'none' as const,
  labels: [],
  assignee: 'patrol_agent' as const,
  startDate: null,
  dueDate: null,
  sortOrder: 0,
  version: 2,
  archivedAt: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
}

describe('Patrol prompts', () => {
  it('recognizes only explicit supported wait markers', () => {
    for (const text of [
      'waiting for design', 'wait for approval', 'on hold', 'do not start yet', "don't start", 'paused',
      'deferred', '等待用户', '暂不开始', '不要开始', '暂缓', '暂停', '稍后再做',
    ]) expect(hasExplicitWait(text)).toBe(true)
    for (const text of ['ready now', 'do not wait', 'awaiting is not this marker', '']) {
      expect(hasExplicitWait(text)).toBe(false)
    }
  })

  it('frames Issue and diff content as untrusted while preserving local Git limits', () => {
    expect(implementationPrompt(issue)).toContain('Implement <unsafe>')
    expect(implementationPrompt(issue)).toContain('Do not fetch, pull, push')
    expect(recoveryPrompt(issue)).toContain('exact prior Session and permanent worktree')
    expect(recoveryPrompt(issue)).toContain('Do not repeat work already present')
    const review = reviewerPrompt(issue, 'abc123', { patch: '+change', stat: '1 file changed' })
    expect(review).toContain('preliminary commit abc123')
    expect(review).toContain('<diff>\n+change\n</diff>')
    expect(review).toContain('untrusted review input')
  })

  it('renders empty and populated Reviewer arrays into the correction turn', () => {
    const base = {
      attemptId: PatrolAttemptId('attempt-prompts'),
      issueId: issue.id,
      sessionId: 'session-review' as never,
      reviewedCommit: 'abc123',
      verdict: 'approve' as const,
      findings: 'No findings.',
      createdAt: '2026-08-16T00:00:00.000Z',
    }
    expect(remediationPrompt({ ...base, verification: [], risks: [] })).toContain('(none reported)')
    const populated = remediationPrompt({ ...base, verification: ['pnpm test'], risks: ['CI matrix'] })
    expect(populated).toContain('pnpm test')
    expect(populated).toContain('CI matrix')
  })
})
