/** Independent read-only Reviewer Session for one Patrol Attempt. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  Issue,
  PatrolAttempt,
  PatrolDevelopmentContext,
  PatrolReviewVerdict,
} from '@deepseek-ai/dsh-taskboard'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { PatrolGitDiff, PatrolWorktree } from './git.ts'
import { reviewerPrompt } from './prompts.ts'

/** Structured evidence returned by the scoped Reviewer tool. */
export interface PatrolReviewerResult {
  readonly sessionId: SessionId
  readonly reviewedCommit: string
  readonly verdict: PatrolReviewVerdict
  readonly findings: string
  readonly verification: readonly string[]
  readonly risks: readonly string[]
}

interface ReviewSubmission {
  readonly verdict: PatrolReviewVerdict
  readonly findings: string
  readonly verification: readonly string[]
  readonly risks: readonly string[]
}

const SUBMISSION_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      accepted: { type: 'boolean', required: true },
    },
  },
  render: (_args: unknown, value: { accepted: boolean }) => [{
    type: 'text' as const,
    /* v8 ignore next -- the tool body always returns accepted: true. */
    text: value.accepted ? 'Patrol review recorded.' : 'Patrol review rejected.',
  }],
} as const

/** Runs a separate persistent Session with no inherited tools and fixed read-only/never policy. */
export class PatrolReviewer {
  constructor(private readonly ctx: Context) {}

  /**
   * Review one exact preliminary commit using only its supplied diff.
   * @param attempt - active Attempt being reviewed.
   * @param issue - claimed Issue snapshot.
   * @param context - implementation composition reused for model selection only.
   * @param worktree - verified cwd used for the visible Session header.
   * @param commit - exact preliminary commit.
   * @param diff - bounded committed patch.
   * @param workspace - Workspace that publishes the Reviewer Session.
   * @returns validated structured Reviewer evidence.
   */
  async review(
    attempt: PatrolAttempt,
    issue: Issue,
    context: PatrolDevelopmentContext,
    worktree: PatrolWorktree,
    commit: string,
    diff: PatrolGitDiff,
    workspace: Workspace,
  ): Promise<PatrolReviewerResult> {
    if (attempt.state !== 'active' || attempt.issueId !== issue.id) {
      throw new Error(`Patrol Attempt "${attempt.id}" cannot start an independent review`)
    }
    const sessionId = SessionId(`session-${randomUUID()}`)
    let submission: ReviewSubmission | undefined
    const staged = new WeakMap<ToolExecution, ReviewSubmission>()
    const setup = async (agentCtx: Context): Promise<void> => {
      const agent = agentCtx.agent
      if (agent === undefined) throw new Error('Taskboard Patrol Reviewer setup has no scoped Agent')
      await this.ctx.agentPresets.mount(agentCtx, context.agentPreset)
      const selected: ModelSelectionRef = {
        current: {
          provider: context.provider,
          model: context.model,
          ...context.reasoningEffort === null
            ? {}
            : { reasoningEffort: ReasoningEffortId(context.reasoningEffort) },
        },
        assembled: undefined,
      }
      installModelSelection(agentCtx, selected)
      setSandboxMode(agent.session, 'read-only')
      setApprovalPolicy(agent.session, 'never')
      const inheritedTools = agentCtx.tools.schemas(agent).map(value => value.name)
      if (inheritedTools.length !== 0) agentCtx.tools.restrict({ deny: inheritedTools })
      agentCtx.tools.register(defineTool({
        name: 'patrol_review_submit',
        description: 'Submit the independent review exactly once and conclude the Reviewer turn.',
        parameters: {
          verdict: {
            type: 'string',
            required: true,
            enum: ['approve', 'changes_requested'],
            description: 'approve or changes_requested',
          },
          findings: {
            type: 'string',
            required: true,
            description: 'Concrete findings, or an explicit no-findings statement.',
          },
          verification: {
            type: 'array',
            required: true,
            description: 'Commands or evidence visible in the supplied diff.',
            items: { type: 'string' },
          },
          risks: {
            type: 'array',
            required: true,
            description: 'Remaining risks for human review.',
            items: { type: 'string' },
          },
        },
        output: SUBMISSION_OUTPUT,
        execute(args, exec) {
          if (submission !== undefined) throw new Error('Patrol review was already submitted')
          const findings = args.findings.trim()
          const verification = args.verification.map(value => value.trim())
          const risks = args.risks.map(value => value.trim())
          if (findings === '' || verification.some(value => value === '') || risks.some(value => value === '')) {
            throw new Error('Patrol review evidence cannot contain empty text')
          }
          staged.set(exec, {
            verdict: args.verdict,
            findings,
            verification,
            risks,
          })
          exec.concludeTurn()
          return Promise.resolve({ accepted: true })
        },
        presentCall: args => ({
          card: 'generic',
          title: `Submit Patrol review: ${args.verdict}`,
          kind: 'other',
        }),
      }))
      agentCtx.on('tools/result', (exec, result) => {
        /* v8 ignore next -- this scope exposes only patrol_review_submit. */
        if (exec.name !== 'patrol_review_submit') return
        const value = staged.get(exec)
        if (value === undefined) return
        staged.delete(exec)
        if (!result.isError) submission = value
      })
    }
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd: worktree.sessionCwd, agentPreset: context.agentPreset },
      agentOptions: { provider: context.provider, model: context.model },
      setup,
    })
    try {
      await workspace.attachSession(sessionId)
      await this.ctx.sessions.flush(handle.agent.session)
      const priorTurns = handle.agent.session.events.filter(event => event.type === 'turn/end').length
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: reviewerPrompt(issue, commit, diff) }],
        source: { kind: 'plugin', plugin: 'taskboard-patrol' },
      }))
      await handle.agent.whenIdle()
      const ends = handle.agent.session.events.filter(event => event.type === 'turn/end')
      const last = ends.at(-1)
      if (ends.length !== priorTurns + 1 || last?.type !== 'turn/end' || last.data.reason.kind !== 'completed') {
        throw new Error(`independent Reviewer Session "${sessionId}" did not complete its review turn`)
      }
      if (submission === undefined) {
        throw new Error(`independent Reviewer Session "${sessionId}" did not submit structured evidence`)
      }
      await this.ctx.sessions.flush(handle.agent.session)
      return { sessionId, reviewedCommit: commit, ...submission }
    } finally {
      await handle.dispose()
    }
  }
}
