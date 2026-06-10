import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import type { ValidateFunction } from 'ajv'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

import { buildValidatorSchema } from '../src/index.ts'
import type { BenchCase } from './schemas.ts'

/** A validator that returns a plain boolean, normalising each library's verdict. */
export type BoolValidator = (input: unknown) => boolean

/**
 * The libraries under comparison, in display order. `mjst` is what this package
 * generates; the other three are the rivals from
 * `moltar/typescript-runtime-type-benchmarks` that are installed here. Each id
 * is what the orchestrator passes to a worker to select one library to isolate.
 */
export const LIBRARY_IDS = ['mjst', 'ajv', 'typebox', 'zod'] as const
export type LibraryId = (typeof LIBRARY_IDS)[number]

export const LIBRARY_LABELS: Record<LibraryId, string> = {
  mjst: 'mjst (generated)',
  ajv: 'ajv (compiled)',
  typebox: 'typebox (compiled)',
  zod: 'zod',
}

const makeAjv = (): Ajv => {
  const ajv = new Ajv({ strict: false })
  addFormats(ajv)
  return ajv
}

/**
 * Generates mjst validator source for `benchCase`, writes the files to a temp
 * dir, and dynamically imports the exported `validate<TypeName>`. The generated
 * code only imports its sibling `./validation-result`, so a temp dir resolves
 * cleanly. Used both to build the steady-state validator and (via
 * {@link buildValidatorSchema} directly) to time the cold codegen cost.
 */
const loadMjstValidator = async (benchCase: BenchCase): Promise<BoolValidator> => {
  const files = await buildValidatorSchema(benchCase.schema, benchCase.typeName)
  const dir = mkdtempSync(join(tmpdir(), 'mjst-bench-'))
  for (const file of files) writeFileSync(join(dir, file.filename), file.content)

  const mod = await import(pathToFileURL(join(dir, 'index.ts')).href)
  rmSync(dir, { recursive: true, force: true })

  const validate = mod[`validate${benchCase.typeName}`] as (input: unknown, path?: string) => unknown
  return (input) => validate(input) === true
}

/**
 * Builds the ready-to-run boolean validator for one library against one case.
 * Each library does the equivalent steady-state work it would in production:
 * mjst loads its generated function, Ajv and TypeBox use their compiled checker,
 * and Zod runs its authored schema.
 */
export const buildValidator = async (lib: LibraryId, benchCase: BenchCase): Promise<BoolValidator> => {
  switch (lib) {
    case 'mjst':
      return loadMjstValidator(benchCase)
    case 'ajv': {
      const validate = makeAjv().compile(benchCase.schema as object) as ValidateFunction
      return (input) => validate(input) === true
    }
    case 'typebox': {
      const checker = TypeCompiler.Compile(benchCase.typebox)
      return (input) => checker.Check(input)
    }
    case 'zod': {
      const zod = benchCase.zod
      return (input) => zod.safeParse(input).success
    }
  }
}
