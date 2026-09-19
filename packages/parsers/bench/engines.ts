import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSchema } from '@amritk/generate-parsers'
import { buildValidatorSchema } from '@amritk/generate-validators'

import { generate, type Mode } from '../src/index.ts'
import { type ModeId, SCHEMA, TYPE_NAME } from './cases.ts'

type GeneratedFile = { filename: string; content: string }

/**
 * The two ways to reach a mode: through the packages as they were before
 * `@amritk/parsers` existed, and through `@amritk/parsers`.
 *
 * "Before" is not a strawman. It is exactly what a consumer wrote: pick the
 * package that owns the mode, and call it with the positional arguments it takes.
 * Reaching the whole matrix meant doing both and living with two type trees,
 * which is what the `whole matrix` weighing below measures.
 */
export const WAY_IDS = ['before', 'after'] as const
export type WayId = (typeof WAY_IDS)[number]

export const WAY_LABELS: Record<WayId, string> = {
  before: 'before (direct)',
  after: 'after (@amritk/parsers)',
}

/** How each mode was reached before this package existed. */
const before = async (mode: ModeId): Promise<GeneratedFile[]> => {
  switch (mode) {
    case 'guard':
    case 'validate':
      return buildValidatorSchema(SCHEMA, TYPE_NAME, '', undefined, 'count-keys', undefined, false, false)
    case 'coerce':
      return buildValidatorSchema(SCHEMA, TYPE_NAME, '', undefined, 'count-keys', undefined, true, false)
    case 'repair':
      return buildValidatorSchema(SCHEMA, TYPE_NAME, '', undefined, 'count-keys', undefined, false, false, true)
    case 'parse':
      return buildSchema(SCHEMA, TYPE_NAME, undefined, false, false, false, 'embedded', './', false, false)
    case 'parseStrict':
      return buildSchema(SCHEMA, TYPE_NAME, undefined, false, false, true, 'embedded', './', false, false)
  }
}

/** The modes `@amritk/parsers` emits to serve one mode, types included. */
const MODE_REQUEST: Record<ModeId, Mode[]> = {
  guard: ['types', 'guard'],
  validate: ['types', 'validate'],
  coerce: ['types', 'coerce'],
  repair: ['types', 'repair'],
  parse: ['types', 'parse'],
  parseStrict: ['types', 'parseStrict'],
}

/** How each mode is reached now. */
const after = async (mode: ModeId): Promise<GeneratedFile[]> =>
  generate(SCHEMA, TYPE_NAME, { modes: MODE_REQUEST[mode], helpersMode: 'embedded' })

/** Generates one mode's source, whichever way was asked for. */
export const generateWay = async (way: WayId, mode: ModeId): Promise<GeneratedFile[]> =>
  way === 'before' ? before(mode) : after(mode)

/**
 * Everything a consumer needed to reach the *whole* matrix, each way. Before, that
 * meant running both generators and shipping both trees — including two
 * declarations of the same type. This is the case the new package is supposed to
 * win, and the only one where the emitted text differs at all.
 */
export const wholeMatrix = async (way: WayId): Promise<GeneratedFile[]> =>
  way === 'before'
    ? [
        ...(await buildValidatorSchema(SCHEMA, TYPE_NAME, '', undefined, 'count-keys', undefined, true, false, true)),
        // Namespaced the way the CLI does it, since both generators name their
        // files after the schema and a flat merge would collide.
        ...(await buildSchema(SCHEMA, TYPE_NAME, undefined, false, false, false, 'embedded', './', false, false)).map(
          (file) => ({ ...file, filename: `parsers/${file.filename}` }),
        ),
      ]
    : generate(SCHEMA, TYPE_NAME, {
        modes: ['types', 'guard', 'validate', 'coerce', 'repair', 'parse'],
        helpersMode: 'embedded',
      })

/** Writes a generated set to a temp dir and imports one export from its barrel. */
export const load = async (files: readonly GeneratedFile[], entry: string): Promise<(input: unknown) => unknown> => {
  const dir = mkdtempSync(join(tmpdir(), 'mjst-compare-'))
  for (const file of files) {
    const path = join(dir, file.filename)
    await mkdir(dirname(path), { recursive: true })
    // Bun resolves `./x.js` back to the `.ts` on disk; Node's type stripping does
    // not, so the specifier is pointed at the file actually written.
    writeFileSync(path, file.content.replace(/(from '\.[^']*)\.js'/g, "$1.ts'"))
  }

  const mod = await import(pathToFileURL(join(dir, 'index.ts')).href)
  rmSync(dir, { recursive: true, force: true })

  const fn = mod[entry]
  if (typeof fn !== 'function') throw new Error(`generated output has no ${entry}`)
  return fn as (input: unknown) => unknown
}
