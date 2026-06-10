import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type TSchema, Value } from '@sinclair/typebox/value'

import { buildSchema } from '../src/index.ts'
import type { ParseCase } from './schemas.ts'

/** A parser that turns unknown input into a clean typed object (or throws). */
export type Parser = (input: unknown) => unknown

/**
 * The libraries under comparison, in display order. `mjst` is the parser this
 * package generates; `zod` and `typebox` are the two rivals from
 * `moltar/typescript-runtime-type-benchmarks` that expose a *pure* parseSafe
 * operation. ajv (`removeAdditional`) and typia (`assertPrune`) strip by
 * mutating the input in place, so they are excluded here and covered by the
 * validators benchmark instead.
 */
export const LIBRARY_IDS = ['mjst', 'zod', 'typebox'] as const
export type LibraryId = (typeof LIBRARY_IDS)[number]

export const LIBRARY_LABELS: Record<LibraryId, string> = {
  mjst: 'mjst (generated)',
  zod: 'zod (.parse)',
  typebox: 'typebox (Value.Parse)',
}

/**
 * TypeBox parse pipeline: clone the input (so the operation stays pure), strip
 * undeclared properties, then assert the declared shape. This is the parseSafe
 * equivalent — `Default`/`Convert` are deliberately left out so no value is
 * coerced, matching what mjst's `strict` parser and zod's `.parse` do.
 */
const TYPEBOX_PARSE_OPS = ['Clone', 'Clean', 'Assert'] as const

/**
 * Generates mjst parser source for `parseCase` in `strict + stripUnknown` mode,
 * writes the self-contained embedded output (parsers plus their `_helpers/`
 * sources) to a temp dir, and dynamically imports the exported `parse<TypeName>`.
 * strict makes the parser throw on a type mismatch like the others; stripUnknown
 * removes the undeclared keys instead of preserving them.
 */
const loadMjstParser = async (parseCase: ParseCase): Promise<Parser> => {
  const files = await buildSchema(
    parseCase.schema,
    parseCase.typeName,
    undefined, // extensions
    false, // typesOnly
    false, // logWarnings
    true, // strict
    'embedded', // helpersMode — ship helper sources so the temp dir is self-contained
    './', // helpersImportPrefix
    false, // readonly
    true, // stripUnknown
  )
  const dir = mkdtempSync(join(tmpdir(), 'mjst-parse-bench-'))
  for (const file of files) {
    const path = join(dir, file.filename)
    await mkdir(dirname(path), { recursive: true })
    writeFileSync(path, file.content)
  }

  const mod = await import(pathToFileURL(join(dir, 'index.ts')).href)
  rmSync(dir, { recursive: true, force: true })

  return mod[`parse${parseCase.typeName}`] as Parser
}

/**
 * Builds the ready-to-run parser for one library against one case. Each library
 * does the equivalent steady-state work it would in production: mjst loads its
 * generated function, zod runs its authored schema's `.parse`, and TypeBox runs
 * its `Value.Parse` pipeline.
 */
export const buildParser = async (lib: LibraryId, parseCase: ParseCase): Promise<Parser> => {
  switch (lib) {
    case 'mjst':
      return loadMjstParser(parseCase)
    case 'zod': {
      const zod = parseCase.zod
      return (input) => zod.parse(input)
    }
    case 'typebox': {
      const schema = parseCase.typebox as TSchema
      return (input) => Value.Parse(TYPEBOX_PARSE_OPS, schema, input)
    }
  }
}
