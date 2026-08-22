import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { generateMarkdownFiles } from '#reference/generate-markdown-files'
import type { GeneratedFile, MarkdownOptions } from '#types/doc'

export type GenerateDocsOptions = MarkdownOptions & {
  /** Schema to document. Defaults to `config.schema.json` in the current directory. */
  readonly schemaPath?: string
  /** Directory the pages are written to. Defaults to the current directory. */
  readonly outDir?: string
}

/**
 * Reads a schema from disk, renders it, and writes every page it declares.
 *
 * Unlike {@link generateMarkdown} — which splices a table into an existing
 * README between markers — the pages here are owned by the generator and
 * overwritten wholesale. That is the deal that keeps documentation honest: the
 * schema is where you edit, and the markdown is build output.
 *
 * @example
 * ```ts
 * await generateDocs({ schemaPath: './config.schema.json', outDir: './documentation' })
 * ```
 */
export const generateDocs = async (options: GenerateDocsOptions = {}): Promise<readonly GeneratedFile[]> => {
  const { schemaPath, outDir, ...markdownOptions } = options
  const root = process.cwd()
  const schemaFile = resolve(root, schemaPath ?? 'config.schema.json')
  const targetDir = resolve(root, outDir ?? '.')

  const raw = await readFile(schemaFile, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    // `JSON.parse` reports an offset and nothing else, which does not say which
    // file is malformed when a build documents several schemas in one command.
    throw new Error(`${schemaFile} is not valid JSON: ${(error as Error).message}`, { cause: error })
  }

  const files = generateMarkdownFiles(parsed, markdownOptions)
  for (const file of files) {
    const target = resolve(targetDir, file.filename)
    // The filenames come from the schema, so they are input: `../../etc/passwd`
    // (or an absolute path) must not be able to write outside the output
    // directory the caller chose.
    // Compared by path segment, not by string prefix: `..extra.md` is an
    // ordinary file name that lives right where it says it does, and the page
    // model already accepts it.
    const inside = relative(targetDir, target)
    const climbs = inside === '..' || inside.startsWith(`..${sep}`) || inside.startsWith('../')
    if (isAbsolute(file.filename) || climbs || isAbsolute(inside)) {
      throw new Error(
        `The page file "${file.filename}" resolves outside the output directory. Use a path relative to it.`,
      )
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content)
  }
  return files
}
