import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('Web Taskboard stack', () => {
  it('mounts durable storage, Patrol execution, Remote, browser UI, and bundled skill in dependency order', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    })
    if (!Array.isArray(parsed)) throw new TypeError('web-app patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [])
    const ids = rows.map(row => row.id)
    expect(ids.indexOf('workspace')).toBeLessThan(ids.indexOf('taskboard-sqlite'))
    expect(ids.indexOf('taskboard-sqlite')).toBeLessThan(ids.indexOf('taskboard-patrol'))
    expect(ids.indexOf('taskboard-sqlite')).toBeLessThan(ids.indexOf('taskboard-remote'))
    expect(ids.indexOf('ui-workspace')).toBeLessThan(ids.indexOf('ui-taskboard'))
    expect(rows.find(row => row.id === 'taskboard-sqlite')).toMatchObject({
      name: '@deepseek-ai/dsh-taskboard-sqlite',
      config: { path: { __jsExpr: "dshHomePath('taskboard.sqlite')" } },
    })
    expect(rows.find(row => row.id === 'taskboard-remote')).toMatchObject({
      name: '@deepseek-ai/dsh-taskboard-remote',
    })
    expect(rows.find(row => row.id === 'taskboard-patrol')).toMatchObject({
      name: '@deepseek-ai/dsh-taskboard-patrol',
      config: { worktreeRoot: { __jsExpr: "dshHomePath('taskboard-worktrees')" } },
    })
    expect(rows.find(row => row.id === 'ui-taskboard')).toMatchObject({
      name: '@deepseek-ai/dsh-client-ui-taskboard',
    })
    expect(rows.find(row => row.id === 'skill-manage-taskboard')).toMatchObject({
      name: '@deepseek-ai/dsh-skill-manage-taskboard',
    })
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-taskboard-sqlite': 'workspace:^',
      '@deepseek-ai/dsh-taskboard-remote': 'workspace:^',
      '@deepseek-ai/dsh-taskboard-patrol': 'workspace:^',
      '@deepseek-ai/dsh-client-ui-taskboard': 'workspace:^',
      '@deepseek-ai/dsh-skill-manage-taskboard': 'workspace:^',
    })
  })
})
