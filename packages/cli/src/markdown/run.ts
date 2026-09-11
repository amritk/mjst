import { relative, resolve } from 'node:path'
import { type GenerateDocsOptions, generateConfigTable, generateDocs } from '@amritk/generate-markdown'

import type { RunResult } from '../lint/run'
import { MARKDOWN_HELP_TEXT } from './help-text'
import { parseMarkdownArgs } from './parse-markdown-args'

// Exit code 2 marks a usage error (bad flags, missing schema) and 1 a failed
// generation — the same split the lint and compile-api subcommands use.
const usageError = (message: string): RunResult => ({ code: 2, stdout: '', stderr: `Error: ${message}\n` })

const failure = (message: string): RunResult => ({ code: 1, stdout: '', stderr: `Error: ${message}\n` })

/** The flags that only mean something for the prose reference, for the --table check below. */
const PAGE_FLAGS = ['outDir', 'file', 'title', 'language', 'layout', 'sort', 'headingLevel'] as const

/**
 * Runs `mjst markdown` over `argv`: renders a JSON Schema as documentation,
 * either as the prose reference pages (the default) or as the HTML config table
 * spliced into an existing markdown file (`--table`). Returns the exit code and
 * the text it would print (rather than writing to the process streams) so tests
 * can drive it in-process — the same shape as the other subcommands' `run`.
 */
export const run = async (argv: string[]): Promise<RunResult> => {
  let args: ReturnType<typeof parseMarkdownArgs>
  try {
    args = parseMarkdownArgs(argv)
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error))
  }

  if (args.help || argv.length === 0) {
    return { code: 0, stdout: MARKDOWN_HELP_TEXT, stderr: '' }
  }

  if (args.schema === undefined) {
    return usageError('A schema path is required. Usage: mjst markdown <schema> --out-dir <dir>')
  }

  // The two shapes take different flags, and a flag that belongs to the other
  // one is a misunderstanding worth hearing about: silently ignoring
  // `--out-dir` under `--table` would leave the user waiting for pages that
  // were never going to be written.
  if (args.table) {
    const stray = PAGE_FLAGS.filter((flag) => args[flag] !== undefined)
    if (stray.length > 0) {
      return usageError(
        `--table renders one table into a single file, so it cannot be combined with ${stray
          .map((flag) => `--${flag.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)
          .join(', ')}. Drop --table to generate the prose reference pages.`,
      )
    }
  } else if (args.readme !== undefined) {
    return usageError('--readme names the file the config table is spliced into, so it requires --table.')
  }

  const schemaPath = resolve(args.schema)
  // Resolved here rather than left to the generator, which resolves relative
  // paths against `process.cwd()` — the same directory this resolves against,
  // but saying so once keeps the paths this prints and the paths it wrote the
  // same strings.
  const outDir = resolve(args.outDir ?? '.')

  if (args.table) {
    let readmePath: string
    try {
      readmePath = await generateConfigTable({
        schemaPath,
        ...(args.readme !== undefined ? { readmePath: resolve(args.readme) } : {}),
      })
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error))
    }
    return { code: 0, stdout: `Generated config table: ${relative(process.cwd(), readmePath)}\n`, stderr: '' }
  }

  const options: GenerateDocsOptions = {
    schemaPath,
    outDir,
    file: args.file,
    title: args.title,
    language: args.language,
    layout: args.layout,
    sort: args.sort,
    headingLevel: args.headingLevel,
  }

  let files: Awaited<ReturnType<typeof generateDocs>>
  try {
    files = await generateDocs(options)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }

  const stdout = [
    ...files.map((file) => `Generated: ${relative(process.cwd(), resolve(outDir, file.filename))}`),
    '',
    `Total files generated: ${files.length}`,
    '',
  ].join('\n')
  return { code: 0, stdout, stderr: '' }
}
