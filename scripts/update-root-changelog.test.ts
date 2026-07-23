import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { updateRootChangelog } from './update-root-changelog'

const CLI_CHANGELOG = `# @amritk/mjst

## 0.2.0

### Minor Changes

- aaa111: A CLI feature.

## 0.1.0

### Patch Changes

- bbb222: Initial CLI release.
`

const API_CHANGELOG = `# @amritk/api

## 0.3.0

### Minor Changes

- ccc333: An API feature.
`

describe('update-root-changelog', () => {
  let root: string

  const writePackage = async (dir: string, name: string, changelog: string): Promise<void> => {
    await mkdir(join(root, 'packages', dir), { recursive: true })
    await writeFile(join(root, 'packages', dir, 'package.json'), JSON.stringify({ name }), 'utf-8')
    await writeFile(join(root, 'packages', dir, 'CHANGELOG.md'), changelog, 'utf-8')
  }

  const readRoot = (): Promise<string> => readFile(join(root, 'CHANGELOG.md'), 'utf-8')

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mjst-changelog-'))
    await writePackage('cli', '@amritk/mjst', CLI_CHANGELOG)
    await writePackage('api', '@amritk/api', API_CHANGELOG)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const backfill = async (): Promise<void> => {
    const roundsPath = join(root, 'rounds.json')
    const rounds = [
      { date: '2026-01-01', pkgs: ['@amritk/mjst@0.1.0'] },
      { date: '2026-01-02', pkgs: ['@amritk/mjst@0.2.0', '@amritk/api@0.3.0'] },
    ]
    await writeFile(roundsPath, JSON.stringify(rounds), 'utf-8')
    await updateRootChangelog(root, { backfillFrom: roundsPath })
  }

  it('backfills newest-first with the CLI leading each release', async () => {
    await backfill()
    const content = await readRoot()

    expect(content.startsWith('# Changelog')).toBe(true)
    // Newer release comes first.
    expect(content.indexOf('## 2026-01-02')).toBeLessThan(content.indexOf('## 2026-01-01'))
    // Within a release the CLI leads, then packages sort alphabetically.
    expect(content.indexOf('### @amritk/mjst@0.2.0')).toBeLessThan(content.indexOf('### @amritk/api@0.3.0'))
    // A scoped ref keeps its name; only the trailing version is split off.
    expect(content).toContain('### @amritk/api@0.3.0')
  })

  it('demotes the per-package change headings by one level', async () => {
    await backfill()
    const content = await readRoot()

    expect(content).toContain('#### Minor Changes')
    expect(content).not.toContain('\n### Minor Changes')
  })

  it('is idempotent once every version is recorded', async () => {
    await backfill()
    const before = await readRoot()

    const result = await updateRootChangelog(root)

    expect(result.changed).toBe(false)
    expect(await readRoot()).toBe(before)
  })

  it('prepends a new release for a freshly bumped package', async () => {
    await backfill()
    await writePackage(
      'api',
      '@amritk/api',
      `# @amritk/api\n\n## 0.4.0\n\n### Minor Changes\n\n- ddd444: Another API feature.\n\n${API_CHANGELOG.slice(API_CHANGELOG.indexOf('## 0.3.0'))}`,
    )

    const result = await updateRootChangelog(root)
    const content = await readRoot()

    expect(result.changed).toBe(true)
    // The new release sits at the top, above the backfilled history.
    expect(content.indexOf('### @amritk/api@0.4.0')).toBeLessThan(content.indexOf('## 2026-01-02'))
    // Only the newly bumped package is listed, not the unchanged CLI.
    const newSection = content.slice(content.indexOf('### @amritk/api@0.4.0'), content.indexOf('## 2026-01-02'))
    expect(newSection).not.toContain('@amritk/mjst')
  })

  it('reports refs whose notes cannot be found', async () => {
    const roundsPath = join(root, 'rounds.json')
    await writeFile(roundsPath, JSON.stringify([{ date: '2026-01-03', pkgs: ['@amritk/api@9.9.9'] }]), 'utf-8')

    const result = await updateRootChangelog(root, { backfillFrom: roundsPath })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('@amritk/api@9.9.9')
  })
})
