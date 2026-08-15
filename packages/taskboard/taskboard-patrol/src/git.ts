/** Local-only Git operations used by Taskboard Patrol execution. */

import { mkdir, realpath, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { IssueIdentifier, PatrolDevelopmentContext } from '@deepseek-ai/dsh-taskboard'

/** Resolved Git repository facts for one Workspace path. */
export interface PatrolRepository {
  /** Canonical Git top-level checkout path. */
  readonly root: string
  /** Workspace-relative directory inside the repository. */
  readonly workspaceRelativePath: string
}

/** Verified persistent worktree and Session cwd. */
export interface PatrolWorktree {
  /** Dedicated Git worktree root. */
  readonly root: string
  /** Directory the bound Session uses inside that worktree. */
  readonly sessionCwd: string
}

/** Current result evidence from one Issue worktree. */
export interface PatrolGitResult {
  /** Commit currently checked out on the Issue branch. */
  readonly head: string
  /** Whether tracked and untracked worktree state is empty. */
  readonly clean: boolean
  /** Whether the Issue branch differs from its fixed Base Branch. */
  readonly changedFromBase: boolean
}

/** Local patch supplied to the independent Reviewer without granting repository tools. */
export interface PatrolGitDiff {
  /** Base-to-commit patch text, bounded by the configured Git output retention. */
  readonly patch: string
  /** Base-to-commit summary retained alongside the patch. */
  readonly stat: string
}

interface GitResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Configuration resolved by the Patrol execution service. */
export interface PatrolGitConfig {
  readonly gitCommand: string
  readonly graceMs: number
  readonly maxOutputBytes: number
}

/**
 * Derive the persistent local branch for one globally unique Issue identifier.
 * @param identifier - Human-readable stable Issue identifier.
 * @returns dedicated local branch name.
 */
export function patrolBranch(identifier: IssueIdentifier): string {
  return `dsh-task/${String(identifier).toLowerCase()}`
}

/**
 * Derive one Issue worktree path below the Host-managed root.
 * @param root - Host-managed worktree parent.
 * @param workspaceId - Owning Workspace identity.
 * @param identifier - Human-readable stable Issue identifier.
 * @returns permanent Issue worktree path.
 */
export function patrolWorktreePath(root: string, workspaceId: string, identifier: IssueIdentifier): string {
  return join(root, workspaceId, String(identifier).toLowerCase())
}

/** Local Git adapter whose command vocabulary excludes every network and integration mutation. */
export class PatrolGit {
  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly config: PatrolGitConfig,
  ) {}

  /**
   * Resolve repository root and the Workspace's path within it.
   * @param workspacePath - Registered Workspace directory.
   * @returns canonical repository root and relative Workspace directory.
   */
  async repository(workspacePath: string): Promise<PatrolRepository> {
    const canonicalWorkspace = await realpath(workspacePath)
    const root = await realpath(await this.text(canonicalWorkspace, ['rev-parse', '--show-toplevel']))
    const workspaceRelativePath = relative(root, canonicalWorkspace)
    if (workspaceRelativePath.startsWith('..')) {
      throw new Error(`Workspace "${workspacePath}" is outside Git repository "${root}"`)
    }
    return { root, workspaceRelativePath }
  }

  /**
   * Read the currently checked-out local branch.
   * @param workspacePath - Registered Workspace checkout.
   * @returns checked-out branch name.
   */
  async currentBranch(workspacePath: string): Promise<string> {
    const branch = await this.text(workspacePath, ['branch', '--show-current'])
    if (branch === '') throw new Error(`Workspace "${workspacePath}" has a detached HEAD`)
    return branch
  }

  /**
   * List local branches in Git's stable ref-name order.
   * @param workspacePath - Registered Workspace checkout.
   * @returns local branch names.
   */
  async localBranches(workspacePath: string): Promise<readonly string[]> {
    const text = await this.text(workspacePath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    return text === '' ? [] : text.split('\n')
  }

  /**
   * Check whether one commit is integrated into the named local branch.
   * @param workspacePath - Registered Workspace checkout.
   * @param commit - Commit to verify.
   * @param branch - Local branch that must contain the commit.
   * @returns whether the commit is an ancestor of the branch.
   */
  async isAncestor(workspacePath: string, commit: string, branch: string): Promise<boolean> {
    const result = await this.run(workspacePath, ['merge-base', '--is-ancestor', commit, branch])
    if (result.exitCode === 0) return true
    if (result.exitCode === 1) return false
    throw this.failure(['merge-base', '--is-ancestor', commit, branch], result)
  }

  /**
   * Create or verify the exact persistent worktree recorded for one Issue.
   * @param workspacePath - Registered Workspace checkout.
   * @param context - Stored Base Branch, Issue branch, and worktree identity.
   * @returns verified worktree and Session directory.
   */
  async ensureWorktree(
    workspacePath: string,
    context: Pick<PatrolDevelopmentContext, 'baseBranch' | 'branch' | 'worktreePath'>,
  ): Promise<PatrolWorktree> {
    const repository = await this.repository(workspacePath)
    await this.text(repository.root, ['show-ref', '--verify', `refs/heads/${context.baseBranch}`])
    const exists = await stat(context.worktreePath).then(value => value.isDirectory(), (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    })
    if (!exists) {
      await mkdir(dirname(context.worktreePath), { recursive: true, mode: 0o700 })
      const branchExists = (await this.run(repository.root, [
        'show-ref', '--verify', `refs/heads/${context.branch}`,
      ])).exitCode === 0
      await this.text(repository.root, branchExists
        ? ['worktree', 'add', context.worktreePath, context.branch]
        : ['worktree', 'add', '-b', context.branch, context.worktreePath, context.baseBranch])
    }
    const actualRoot = await this.text(context.worktreePath, ['rev-parse', '--show-toplevel'])
    const actualBranch = await this.text(context.worktreePath, ['branch', '--show-current'])
    if (actualRoot !== context.worktreePath || actualBranch !== context.branch) {
      throw new Error(
        `Patrol worktree "${context.worktreePath}" is bound to branch "${actualBranch}" at "${actualRoot}", expected "${context.branch}"`,
      )
    }
    const sessionCwd = repository.workspaceRelativePath === ''
      ? context.worktreePath
      : join(context.worktreePath, repository.workspaceRelativePath)
    const sessionDirectoryExists = await stat(sessionCwd).then(value => value.isDirectory(), (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    })
    if (!sessionDirectoryExists) {
      throw new Error(`Patrol Session directory "${sessionCwd}" does not exist in the Issue worktree`)
    }
    return { root: context.worktreePath, sessionCwd }
  }

  /**
   * Read clean/commit/diff evidence without changing repository state.
   * @param context - Stored Base Branch and worktree identity.
   * @returns current commit, cleanliness, and Base Branch difference.
   */
  async result(context: Pick<PatrolDevelopmentContext, 'baseBranch' | 'worktreePath'>): Promise<PatrolGitResult> {
    const head = await this.text(context.worktreePath, ['rev-parse', 'HEAD'])
    const clean = (await this.text(context.worktreePath, ['status', '--porcelain=v1'])) === ''
    const diff = await this.run(context.worktreePath, ['diff', '--quiet', `${context.baseBranch}...HEAD`])
    if (diff.exitCode !== 0 && diff.exitCode !== 1) {
      throw this.failure(['diff', '--quiet', `${context.baseBranch}...HEAD`], diff)
    }
    return { head, clean, changedFromBase: diff.exitCode === 1 }
  }

  /**
   * Read one committed Base Branch diff for the independent Reviewer.
   * @param context - fixed Base Branch and Issue worktree.
   * @param commit - preliminary implementation commit to review.
   * @returns bounded patch and stat text.
   */
  async diff(
    context: Pick<PatrolDevelopmentContext, 'baseBranch' | 'worktreePath'>,
    commit: string,
  ): Promise<PatrolGitDiff> {
    const range = `${context.baseBranch}...${commit}`
    const [patch, stat] = await Promise.all([
      this.text(context.worktreePath, ['diff', '--no-ext-diff', '--binary', range]),
      this.text(context.worktreePath, ['diff', '--stat', '--no-ext-diff', range]),
    ])
    return { patch, stat }
  }

  /** Run one checked Git command and return its trimmed stdout. */
  private async text(cwd: string, args: readonly string[]): Promise<string> {
    const result = await this.run(cwd, args)
    if (result.exitCode !== 0) throw this.failure(args, result)
    return result.stdout.trim()
  }

  /** Spawn Git without a shell so arguments cannot introduce additional operations. */
  private async run(cwd: string, args: readonly string[]): Promise<GitResult> {
    const handle = this.subprocess.spawn({
      argv: [this.config.gitCommand, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: this.config.maxOutputBytes },
        stderr: { maxBytes: this.config.maxOutputBytes },
      },
      graceMs: this.config.graceMs,
    })
    const outcome = await handle.done
    return {
      exitCode: outcome.exitCode,
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
      stderr: handle.collected.stderr?.readFrom(0).text ?? '',
    }
  }

  /** Build a bounded diagnostic for one failed local command. */
  private failure(args: readonly string[], result: GitResult): Error {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`
    return new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
}
