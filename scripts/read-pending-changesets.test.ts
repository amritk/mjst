import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readPendingChangesets } from './read-pending-changesets'

describe('read-pending-changesets', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mjst-read-changesets-'))
    await mkdir(join(root, '.changeset'), { recursive: true })
    const write = async (name: string, contents: string): Promise<void> => {
      await writeFile(join(root, '.changeset', name), contents, 'utf-8')
    }

    await write(
      'single-quoted.md',
      "---\n'@amritk/helpers': major\n'@amritk/yaml': patch\n---\n\nA summary that mentions major on its own line.\n",
    )
    // changesets itself writes single quotes, but a hand-edited file can carry
    // either style, or none — all three are valid YAML and all three ship.
    await write('double-quoted.md', '---\n"@amritk/api": minor\n---\n\nSummary.\n')
    await write('unquoted.md', '---\n@amritk/lint: major\n---\n\nSummary.\n')
    await write('empty.md', '---\n---\n\nAn empty changeset records intent without a release.\n')
    await write('README.md', '# Changesets\n\nNot a changeset.\n')
    await write('config.json', '{ "not": "markdown" }')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads the bumps out of the frontmatter', async () => {
    const changesets = await readPendingChangesets(root)
    const single = changesets.find((changeset) => changeset.id === 'single-quoted')

    expect(single?.releases).toEqual([
      { name: '@amritk/helpers', type: 'major' },
      { name: '@amritk/yaml', type: 'patch' },
    ])
  })

  it('handles double-quoted and unquoted package names', async () => {
    const changesets = await readPendingChangesets(root)

    expect(changesets.find((changeset) => changeset.id === 'double-quoted')?.releases).toEqual([
      { name: '@amritk/api', type: 'minor' },
    ])
    expect(changesets.find((changeset) => changeset.id === 'unquoted')?.releases).toEqual([
      { name: '@amritk/lint', type: 'major' },
    ])
  })

  it('reads an empty changeset as no releases', async () => {
    const changesets = await readPendingChangesets(root)

    expect(changesets.find((changeset) => changeset.id === 'empty')?.releases).toEqual([])
  })

  // The word "major" appears in plenty of summaries, and the body must never be
  // mistaken for a bump — that would fail the build over prose.
  it('stops at the closing marker and ignores the summary', async () => {
    const changesets = await readPendingChangesets(root)

    expect(changesets.find((changeset) => changeset.id === 'single-quoted')?.releases).toHaveLength(2)
  })

  it('skips the README and non-markdown files', async () => {
    const changesets = await readPendingChangesets(root)

    expect(changesets.map((changeset) => changeset.id).sort()).toEqual([
      'double-quoted',
      'empty',
      'single-quoted',
      'unquoted',
    ])
  })
})
