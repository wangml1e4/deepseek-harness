import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/manage-taskboard/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/manage-taskboard/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface SmokeSnapshot {
  readonly catalog: readonly { readonly text?: string }[] | null
  readonly summary: {
    readonly name?: string
    readonly provider?: string
    readonly source?: string
    readonly invocation?: unknown
  } | null
  readonly result: {
    readonly isError?: boolean
    readonly value?: { readonly name?: string; readonly provider?: string; readonly content?: string }
  }
}

describe('manage-taskboard assembled snapshot', () => {
  it('advertises and loads the bundled workflow through the shipped app', async () => {
    const smoke = await runLoaderSmoke({
      label: 'manage-taskboard skill snapshot',
      tempDirPrefix: 'headless-snapshot-manage-taskboard-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
    })
    const snapshot = JSON.parse(smoke.stdout) as SmokeSnapshot
    const content = snapshot.result.value?.content ?? ''

    expect(smoke.stderr).toBe('')
    expect({
      catalogAdvertisesSkill: snapshot.catalog?.[0]?.text?.includes('`manage-taskboard`') ?? false,
      summary: snapshot.summary,
      loaded: {
        isError: snapshot.result.isError,
        name: snapshot.result.value?.name,
        provider: snapshot.result.value?.provider,
        readsIssueAndCommentsFirst: content.includes('first run `taskctl issue get` and `taskctl comment list`'),
        claimsOnlyTodo: content.includes('Only a `todo` Issue is claimable'),
        handsOffAtInReview: content.includes('move the Issue to `in_review` and end the current execution round'),
        forbidsDone: content.includes('Never move an Issue to `done` automatically'),
        forbidsDelete: content.includes('Never delete an Issue'),
      },
    }).toMatchInlineSnapshot(`
      {
        "catalogAdvertisesSkill": true,
        "loaded": {
          "claimsOnlyTodo": true,
          "forbidsDelete": true,
          "forbidsDone": true,
          "handsOffAtInReview": true,
          "isError": false,
          "name": "manage-taskboard",
          "provider": "manage-taskboard",
          "readsIssueAndCommentsFirst": true,
        },
        "summary": {
          "description": "Manage DeepSeek Harness Taskboard work with taskctl. Use for Taskboard Issue identifiers, status changes, comments, relations, or durable work tracking.",
          "invocation": {
            "modelInvocable": true,
            "userInvocable": true,
          },
          "name": "manage-taskboard",
          "provider": "manage-taskboard",
          "resourceBase": {
            "kind": "directory",
            "path": "{{resourceBase}}",
          },
          "source": "bundled",
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
