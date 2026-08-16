import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { IssueIdentifier } from '@deepseek-ai/dsh-taskboard'
import { PatrolGit, patrolBranch, patrolWorktreePath } from '../src/git.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function repository(): Promise<{ root: string; workspace: string; worktrees: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-taskboard-patrol-repo-'))
  const worktrees = await mkdtemp(join(tmpdir(), 'dsh-taskboard-patrol-worktrees-'))
  tempDirs.push(root, worktrees)
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.email', 'patrol@example.test')
  git(root, 'config', 'user.name', 'Patrol Test')
  const workspace = join(root, 'packages', 'app')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'value.txt'), 'base\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'base')
  return { root: await realpath(root), workspace: await realpath(workspace), worktrees: await realpath(worktrees) }
}

function scriptedRuntime(results: readonly {
  exitCode: number | null
  stdout?: string
  stderr?: string
}[]): SubprocessRuntime {
  const remaining = [...results]
  return {
    spawn: () => {
      const result = remaining.shift()
      if (result === undefined) throw new Error('unexpected subprocess call')
      const reader = (text: string) => ({
        readFrom: () => ({ text, nextOffset: text.length, lossy: false }),
      })
      return {
        done: Promise.resolve({ exitCode: result.exitCode }),
        collected: {
          ...(result.stdout === undefined ? {} : { stdout: reader(result.stdout) }),
          ...(result.stderr === undefined ? {} : { stderr: reader(result.stderr) }),
        },
      }
    },
  } as never
}

describe('PatrolGit', () => {
  it('creates and reuses a dedicated local worktree without changing the source checkout', async () => {
    const fixture = await repository()
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const patrol = new PatrolGit(ctx.subprocess, {
        gitCommand: 'git',
        graceMs: 500,
        maxOutputBytes: 64 * 1024,
      })
      const identifier = IssueIdentifier('HARNESS-42')
      const context = {
        baseBranch: 'main',
        branch: patrolBranch(identifier),
        worktreePath: patrolWorktreePath(fixture.worktrees, 'workspace-1', identifier),
      }

      await expect(patrol.repository(fixture.workspace)).resolves.toEqual({
        root: fixture.root,
        workspaceRelativePath: 'packages/app',
      })
      await expect(patrol.currentBranch(fixture.workspace)).resolves.toBe('main')
      await expect(patrol.localBranches(fixture.workspace)).resolves.toEqual(['main'])
      const first = await patrol.ensureWorktree(fixture.workspace, context)
      expect(first).toEqual({
        root: context.worktreePath,
        sessionCwd: join(context.worktreePath, 'packages', 'app'),
      })
      expect(git(fixture.root, 'branch', '--show-current')).toBe('main')
      expect(git(context.worktreePath, 'branch', '--show-current')).toBe(context.branch)
      await expect(patrol.ensureWorktree(fixture.workspace, context)).resolves.toEqual(first)

      await writeFile(join(first.sessionCwd, 'value.txt'), 'changed\n')
      await expect(patrol.result(context)).resolves.toMatchObject({ clean: false, changedFromBase: false })
      git(context.worktreePath, 'add', '.')
      git(context.worktreePath, 'commit', '-m', 'implement issue')
      const result = await patrol.result(context)
      expect(result).toMatchObject({ clean: true, changedFromBase: true })
      const diff = await patrol.diff(context, result.head)
      expect(diff.patch).toContain('+changed')
      expect(diff.stat).toContain('value.txt')
      await expect(patrol.isAncestor(fixture.workspace, result.head, context.branch)).resolves.toBe(true)
      await expect(patrol.isAncestor(fixture.workspace, result.head, 'main')).resolves.toBe(false)
      await expect(patrol.worktreePresent(context)).resolves.toBe(true)
      await patrol.removeWorktree(fixture.workspace, context)
      await expect(patrol.worktreePresent(context)).resolves.toBe(false)
      expect(git(fixture.root, 'show-ref', '--verify', `refs/heads/${context.branch}`)).not.toBe('')
      await expect(patrol.ensureWorktree(fixture.workspace, context)).resolves.toEqual(first)
      await expect(patrol.result(context)).resolves.toMatchObject({ head: result.head, clean: true })
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects a detached source checkout instead of inventing a Base Branch', async () => {
    const fixture = await repository()
    git(fixture.root, 'checkout', '--detach')
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const patrol = new PatrolGit(ctx.subprocess, {
        gitCommand: 'git',
        graceMs: 500,
        maxOutputBytes: 64 * 1024,
      })
      await expect(patrol.currentBranch(fixture.workspace)).rejects.toThrow('detached HEAD')
    } finally {
      await fiber.dispose()
    }
  })

  it('recovers an existing Issue branch and validates root-Workspace and missing-directory layouts', async () => {
    const fixture = await repository()
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const patrol = new PatrolGit(ctx.subprocess, {
        gitCommand: 'git',
        graceMs: 500,
        maxOutputBytes: 64 * 1024,
      })
      const existingIdentifier = IssueIdentifier('HARNESS-43')
      const existing = {
        baseBranch: 'main',
        branch: patrolBranch(existingIdentifier),
        worktreePath: patrolWorktreePath(fixture.worktrees, 'workspace-1', existingIdentifier),
      }
      git(fixture.root, 'branch', existing.branch, 'main')
      await expect(patrol.ensureWorktree(fixture.workspace, existing)).resolves.toMatchObject({
        root: existing.worktreePath,
      })

      const rootIdentifier = IssueIdentifier('HARNESS-44')
      const rootContext = {
        baseBranch: 'main',
        branch: patrolBranch(rootIdentifier),
        worktreePath: patrolWorktreePath(fixture.worktrees, 'workspace-1', rootIdentifier),
      }
      await expect(patrol.ensureWorktree(fixture.root, rootContext)).resolves.toEqual({
        root: rootContext.worktreePath,
        sessionCwd: rootContext.worktreePath,
      })

      await rename(join(existing.worktreePath, 'packages', 'app'), join(existing.worktreePath, 'packages', 'moved-app'))
      await expect(patrol.ensureWorktree(fixture.workspace, existing)).rejects.toThrow('does not exist in the Issue worktree')
      await symlink('app', join(existing.worktreePath, 'packages', 'app'))
      await expect(patrol.ensureWorktree(fixture.workspace, existing)).rejects.toMatchObject({ code: 'ELOOP' })
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects an incorrect or aliased worktree and invalid diff evidence', async () => {
    const fixture = await repository()
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const patrol = new PatrolGit(ctx.subprocess, {
        gitCommand: 'git',
        graceMs: 500,
        maxOutputBytes: 64 * 1024,
      })
      await expect(patrol.ensureWorktree(fixture.workspace, {
        baseBranch: 'main',
        branch: 'dsh-task/invalid-path',
        worktreePath: '\0',
      })).rejects.toBeInstanceOf(TypeError)
      await expect(patrol.ensureWorktree(fixture.workspace, {
        baseBranch: 'main',
        branch: 'dsh-task/not-main',
        worktreePath: fixture.root,
      })).rejects.toThrow('expected "dsh-task/not-main"')

      const identifier = IssueIdentifier('HARNESS-45')
      const context = {
        baseBranch: 'main',
        branch: patrolBranch(identifier),
        worktreePath: patrolWorktreePath(fixture.worktrees, 'workspace-1', identifier),
      }
      await patrol.ensureWorktree(fixture.workspace, context)
      const alias = join(fixture.worktrees, 'aliased-worktree')
      await symlink(context.worktreePath, alias)
      await expect(patrol.worktreePresent({ worktreePath: alias })).resolves.toBe(false)
      await expect(patrol.ensureWorktree(fixture.workspace, {
        ...context,
        worktreePath: alias,
      })).rejects.toThrow(`at "${context.worktreePath}"`)
      await expect(patrol.result({ ...context, baseBranch: 'missing-base' })).rejects.toThrow('git diff --quiet')
      await expect(patrol.removeWorktree(fixture.workspace, {
        ...context,
        worktreePath: alias,
      })).rejects.toThrow(context.worktreePath)
    } finally {
      await fiber.dispose()
    }
  })

  it('reports checked-command failures from stderr, stdout, or the exit status', async () => {
    const fixture = await repository()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-taskboard-patrol-outside-'))
    tempDirs.push(outside)
    const outsidePatrol = new PatrolGit(scriptedRuntime([
      { exitCode: 0, stdout: `${outside}\n` },
    ]), { gitCommand: 'git', graceMs: 1, maxOutputBytes: 1024 })
    await expect(outsidePatrol.repository(fixture.workspace)).rejects.toThrow('is outside Git repository')

    const empty = new PatrolGit(scriptedRuntime([
      { exitCode: 0 },
    ]), { gitCommand: 'git', graceMs: 1, maxOutputBytes: 1024 })
    await expect(empty.localBranches(fixture.workspace)).resolves.toEqual([])

    const stderr = new PatrolGit(scriptedRuntime([
      { exitCode: 2, stderr: 'bad ancestor\n' },
    ]), { gitCommand: 'git', graceMs: 1, maxOutputBytes: 1024 })
    await expect(stderr.isAncestor(fixture.workspace, 'bad', 'main')).rejects.toThrow('bad ancestor')

    const stdout = new PatrolGit(scriptedRuntime([
      { exitCode: 2, stdout: 'stdout diagnostic\n' },
    ]), { gitCommand: 'git', graceMs: 1, maxOutputBytes: 1024 })
    await expect(stdout.currentBranch(fixture.workspace)).rejects.toThrow('stdout diagnostic')

    const status = new PatrolGit(scriptedRuntime([
      { exitCode: null },
    ]), { gitCommand: 'git', graceMs: 1, maxOutputBytes: 1024 })
    await expect(status.currentBranch(fixture.workspace)).rejects.toThrow('exit null')
  })
})
