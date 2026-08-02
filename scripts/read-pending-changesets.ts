import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Bump = 'major' | 'minor' | 'patch' | 'none'

export type PendingChangeset = {
  /** The file name without its extension, the way changesets identifies it. */
  id: string
  releases: { name: string; type: Bump }[]
}

/** `'@amritk/helpers': major`, with the quotes optional and of either kind. */
const RELEASE_LINE = /^\s*['"]?(?<name>[^'":]+)['"]?\s*:\s*(?<type>major|minor|patch|none)\s*$/

/**
 * Reads the bumps every pending changeset asks for.
 *
 * This parses the frontmatter directly rather than calling `changeset status`,
 * which needs the full git history: it diffs against `config.baseBranch` to
 * warn about packages missing a changeset, and dies with "Failed to find where
 * HEAD diverged from main" on the shallow single-branch clone that
 * actions/checkout gives us. The frontmatter is two or three lines of trivial
 * YAML, and reading it keeps this check independent of git state entirely.
 */
export const readPendingChangesets = async (root: string): Promise<PendingChangeset[]> => {
  const dir = join(root, '.changeset')
  const changesets: PendingChangeset[] = []

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue

    const contents = await readFile(join(dir, entry.name), 'utf-8')
    const lines = contents.split('\n')
    if (lines[0]?.trim() !== '---') continue

    const releases: { name: string; type: Bump }[] = []
    for (const line of lines.slice(1)) {
      if (line.trim() === '---') break
      const groups = RELEASE_LINE.exec(line)?.groups
      const name = groups?.name?.trim()
      const type = groups?.type
      // Narrowed rather than cast: the regex already restricts `type` to the
      // four bumps, and this is what tells the compiler so.
      if (name === undefined) continue
      if (type !== 'major' && type !== 'minor' && type !== 'patch' && type !== 'none') continue
      releases.push({ name, type })
    }

    changesets.push({ id: entry.name.replace(/\.md$/, ''), releases })
  }

  return changesets
}
