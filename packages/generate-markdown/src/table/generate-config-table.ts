import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { dereferenceSchema } from '#helpers/dereference'
import { renderConfigTable } from '#table/render-config-table'

const START_MARKER = '<!-- config-table-start -->'
const END_MARKER = '<!-- config-table-end -->'

export type GenerateConfigTableOptions = {
  /** Schema to render. Defaults to `config.schema.json` in the current directory. */
  readonly schemaPath?: string
  /** Markdown file the table is spliced into. Defaults to `README.md` in the current directory. */
  readonly readmePath?: string
}

/**
 * Renders the config table and splices it into a markdown file, returning the
 * path it wrote.
 *
 * This is the parameterized form of the table flow — what {@link generateMarkdown}
 * calls, and what the `mjst markdown --table` subcommand needs, since a CLI
 * cannot assume the schema is named `config.schema.json` and sits in the
 * directory it was invoked from.
 *
 * Only the content between the two markers is replaced. If the file exists but
 * is missing one or both markers we refuse to write rather than destroy
 * hand-written content; when it does not exist yet the table is written on its
 * own, with the markers, so a second run can splice instead of refusing.
 *
 * @example
 * ```ts
 * await generateConfigTable({ schemaPath: './config.schema.json', readmePath: './docs/config.md' })
 * ```
 */
export const generateConfigTable = async (options: GenerateConfigTableOptions = {}): Promise<string> => {
  const root = process.cwd()

  const schemaPath = resolve(root, options.schemaPath ?? 'config.schema.json')
  const schemaRaw = await readFile(schemaPath, 'utf-8')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(schemaRaw) as Record<string, unknown>
  } catch (error) {
    // `JSON.parse` reports an offset and nothing else. The repo runs this from
    // several package directories in one command, so the offset alone does not
    // say which schema is malformed.
    throw new Error(`${schemaPath} is not valid JSON: ${(error as Error).message}`, { cause: error })
  }
  // Inline every $ref against the document's own $defs before rendering.
  const schema = dereferenceSchema(parsed)

  const table = renderConfigTable(schema)
  const readmePath = resolve(root, options.readmePath ?? 'README.md')

  let existing: string | undefined
  try {
    existing = await readFile(readmePath, 'utf-8')
  } catch (error) {
    // Only a missing file means "safe to create one". Swallowing every read
    // error let an existing-but-unreadable README (EACCES, EISDIR) be replaced
    // wholesale by the bootstrap path — the opposite of this module's documented
    // refusal to overwrite hand-written content.
    // Keyed on `code` being set: a filesystem failure that is not ENOENT must
    // not be mistaken for "no README yet". An error without a `code` is left
    // swallowed — no reachable `readFile` path produces one.
    const code = (error as NodeJS.ErrnoException)?.code
    if (code !== undefined && code !== 'ENOENT') throw error
    existing = undefined
  }

  // A marker inside the generated table would make the next run splice against
  // its own output, re-copying the region every time and growing the README
  // without bound. Nothing in a sane schema produces one, so refuse rather than
  // try to repair it.
  if (table.includes(START_MARKER) || table.includes(END_MARKER)) {
    throw new Error(
      `The generated config table contains a ${START_MARKER} / ${END_MARKER} marker, which would corrupt ` +
        `${readmePath} on the next run. Remove the marker text from the schema (a property name, title, or ` +
        'description).',
    )
  }

  let content: string
  if (existing === undefined) {
    // With the markers, so a second run can splice instead of refusing.
    content = `${START_MARKER}\n${table}\n${END_MARKER}\n`
  } else {
    // Search for the end marker *after* the start marker. Taking the document's
    // first one let prose above the region ("the table ends at <!-- … -->")
    // supply it, and the resulting backwards slice duplicated the span between
    // the two indices on every run instead of replacing it.
    let startIdx = existing.indexOf(START_MARKER)
    const endIdx = startIdx === -1 ? -1 : existing.indexOf(END_MARKER, startIdx + START_MARKER.length)
    // A start marker *between* the two — one quoted in a code fence documenting
    // the markers, say — is the real opener. Taking the document's first one
    // silently deleted everything from the decoy down to the real region.
    if (startIdx !== -1 && endIdx !== -1) {
      const lastStart = existing.lastIndexOf(START_MARKER, endIdx)
      if (lastStart > startIdx) startIdx = lastStart
    }
    // Both markers present: splice the table in and keep everything else. If a
    // marker is missing, overwriting would silently wipe the existing file, so
    // fail loudly and let the user add the markers where they want the table.
    if (startIdx === -1 || endIdx === -1) {
      throw new Error(
        `${readmePath} exists without a ${START_MARKER} … ${END_MARKER} region. ` +
          'Add both markers, in that order, where the config table should go, then re-run — refusing to overwrite ' +
          'the existing file.',
      )
    }
    content = existing.slice(0, startIdx + START_MARKER.length) + '\n' + table + '\n' + existing.slice(endIdx)
  }

  // The target is a path the caller chose — `--readme docs/config.md` names a
  // directory that may not exist yet — and a bootstrap run that failed with a
  // bare ENOENT would read as a bug in the generator rather than a missing
  // directory. Existing directories make this a no-op.
  await mkdir(dirname(readmePath), { recursive: true })
  await writeFile(readmePath, content)
  return readmePath
}
