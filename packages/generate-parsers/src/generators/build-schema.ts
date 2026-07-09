import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import { generateIndexBarrel } from '@amritk/helpers/generate-index-barrel'
import { walkRefGraph } from '@amritk/helpers/walk-ref-graph'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { applySchemaExtensions } from '#helpers/apply-schema-extensions'
import type { HelpersMode, RuntimeHelperName } from '#helpers/collect-helpers'
import type { ImportExtension } from '#helpers/collect-imports'
import type { SchemaExtensions } from '#types/schema-extensions'

import { generateFile } from './generate-files'

/** An embedded runtime-helper file: the extension to write it under and its source. */
type EmbeddedHelper = { ext: 'ts' | 'js'; content: string }

/**
 * Loads a runtime helper's source to copy into `_helpers/` in embedded mode.
 *
 * Prefers the TypeScript source (`src/<helper>.ts`), rewriting any extensionless
 * sibling import (e.g. `validate-record` → `./is-object`) to `./is-object.js` so
 * the embedded copy resolves under Node ESM, not only Bun. When the resolved
 * `@amritk/helpers` is a published/cached tarball that ships only `dist/` (its
 * `files` historically excluded `src/`, which is exactly why `bunx mjst` crashed
 * on this lookup), it falls back to the always-published compiled `dist/<helper>.js`
 * — which tsc already emits with `.js`-extension imports — and writes it verbatim.
 */
const readHelperSource = async (helper: RuntimeHelperName, importExt: ImportExtension): Promise<EmbeddedHelper> => {
  const require = createRequire(import.meta.url)
  const helpersRoot = dirname(require.resolve('@amritk/helpers/package.json'))
  try {
    const source = await readFile(resolvePath(helpersRoot, 'src', `${helper}.ts`), 'utf-8')
    // The leading `\b` in this pattern is load-bearing beyond its regex meaning.
    // Our build runs tsc-alias --resolveFullPaths over the compiled output, and its
    // scanner rewrites anything that looks like `from '<path>'` — even inside a
    // regex literal. Without the `\b`, normalize-path turned this pattern's
    // backslashes into slashes and v0.12.3 shipped with an unparseable regex that
    // crashed the CLI on load. The `\b` blocks that scan (in the emitted text,
    // `from` is preceded by the word character `b`, so tsc-alias's own `\bfrom`
    // never matches) and is also semantically correct: an import keyword always
    // sits at a word boundary. The dist smoke test (scripts/dist-smoke.test.ts)
    // fails the build if this ever regresses.
    return { ext: 'ts', content: source.replace(/\bfrom '(\.\/[^'".]+)'/g, `from '$1.${importExt}'`) }
  } catch {
    const compiled = await readFile(resolvePath(helpersRoot, 'dist', `${helper}.js`), 'utf-8')
    // With `.ts` import specifiers the on-disk file must literally be `.ts`, so
    // ship the compiled JS (valid TS) under that name and retarget its own
    // sibling imports to match. The pattern keeps the same `\bfrom` shape as
    // above so tsc-alias's scanner can't corrupt it (see the comment there).
    if (importExt === 'ts') {
      return { ext: 'ts', content: compiled.replace(/\bfrom '(\.\/[^'"]+)\.js'/g, "from '$1.ts'") }
    }
    return { ext: 'js', content: compiled }
  }
}

/**
 * Represents a generated file with its filename and content.
 */
export type GeneratedFile = {
  filename: string
  content: string
}

/**
 * Builds all TypeScript files from a JSON Schema by traversing its entire
 * `$ref` / `$dynamicRef` graph (via the shared `@amritk/helpers/walk-ref-graph`
 * walker, which also seeds `$dynamicAnchor` definitions and rewrites
 * `$dynamicRef` to `$ref`).
 *
 * For the root schema and each reachable definition this function generates a
 * TypeScript file, then emits an `index.ts` barrel re-exporting them all.
 *
 * @param rootSchema - The root JSON Schema to build from
 * @param rootTypeName - The name for the root type (e.g., "Document")
 * @param extensions - Optional map of custom extension properties to add to specific definitions.
 *   Keys are definition names (matching $defs keys), values are records of extension property
 *   names to their JSON Schema definitions. Extensions are merged as optional properties before
 *   type and parser generation.
 * @param typesOnly - When true, only generate TypeScript type definitions without parser functions.
 * @param logWarnings - When true, the generated parsers emit a console.warn for every input key
 *   that is not declared in the schema's properties.
 * @param strict - When true, the generated parsers throw on type/shape mismatches
 *   (wrong type, missing required property, enum/pattern/min/max violations) instead
 *   of coercing invalid input to default values.
 * @param helpersMode - `'package'` (default) emits `import ... from '@amritk/helpers/...'`.
 *   `'embedded'` emits `import ... from './_helpers/...'` and appends the helper sources
 *   as additional `GeneratedFile` entries so the output directory is self-contained.
 * @param helpersImportPrefix - Relative path prefix to the `_helpers/` directory in
 *   embedded mode. Defaults to `'./'`. The recursive multi-schema build passes `'../'`,
 *   `'../../'`, etc. so nested parsers can import from a single shared `_helpers/`
 *   directory while the helper sources are emitted once at the output root.
 * @param readonly - When true, every property, array, and record in the generated type
 *   definitions is emitted as `readonly`.
 * @param stripUnknown - When true, the generated parsers build their result from declared
 *   properties only, silently dropping undeclared input keys at every nesting level (zod's
 *   `.strip()`) without treating extras as a validation error. Composes with `strict` and
 *   yields to `additionalProperties: false` (which rejects rather than strips in strict mode).
 * @param typeSuffix - Suffix appended to every type/parser name derived from a `$ref`
 *   (e.g. `'Object'` → `ContactObject`). Defaults to `''` (no suffix). The root type name
 *   is used verbatim and is not affected by this suffix.
 * @param importExt - Extension used on every relative import specifier in the generated
 *   output (cross-file `$ref` imports, the index barrel, and embedded-helper imports).
 *   `'js'` (this function's default) is the standard TS NodeNext form; `'ts'` emits the
 *   literal on-disk paths so the generated sources run directly under Node's type
 *   stripping. Note the `mjst` CLI defaults this to `'ts'` (falling back to `'js'` only
 *   under `--build`, where tsc must compile the sources) so generated output runs under
 *   Node without a build step; direct callers of `buildSchema` opt in explicitly.
 * @param caseInsensitive - When true, the generated coercing parsers normalize a mis-cased
 *   string to the exact casing of a declared `enum`/`const` member it matches
 *   case-insensitively (e.g. `hElLo` → `hello`) instead of coercing to the default. Coerce
 *   mode only — strict parsers still reject a casing mismatch. The normalization lives on
 *   the coercion failure branch, so correctly-cased input keeps the exact-match fast path
 *   and the hot path is unaffected.
 * @returns An array of generated TypeScript files
 *
 * @example
 * ```typescript
 * const schema = {
 *   type: "object",
 *   properties: {
 *     info: { $ref: "#/$defs/info" }
 *   },
 *   $defs: {
 *     info: {
 *       type: "object",
 *       properties: {
 *         title: { type: "string" }
 *       }
 *     }
 *   }
 * };
 *
 * const files = buildSchema(schema, "Document");
 *
 * // Types-only mode — no parser functions or runtime helpers included:
 * const typesFiles = buildSchema(schema, "Document", undefined, true);
 *
 * // With extensions:
 * const filesWithExtensions = buildSchema(schema, "Document", {
 *   info: {
 *     'x-internal': { type: 'boolean' },
 *   },
 * });
 * ```
 */
export const buildSchema = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  extensions?: SchemaExtensions,
  typesOnly?: boolean,
  logWarnings?: boolean,
  strict?: boolean,
  helpersMode: HelpersMode = 'package',
  helpersImportPrefix = './',
  readonly = false,
  stripUnknown = false,
  typeSuffix = '',
  importExt: ImportExtension = 'js',
  caseInsensitive = false,
): Promise<GeneratedFile[]> => {
  const files: GeneratedFile[] = []
  const usedHelpers = new Set<RuntimeHelperName>()

  walkRefGraph(rootSchema, rootTypeName, { typeSuffix }, (node) => {
    // `index` is reserved for the barrel below, so never let a definition of
    // that name overwrite it.
    if (node.filename === 'index') return

    // Extensions are keyed by definition name, which is the node's filename for
    // both the root (the lowercased root type name) and every `$ref` target.
    const extended = extensions ? applySchemaExtensions(node.schema, node.filename, extensions) : node.schema
    const result = generateFile(extended, node.typeName, {
      typesOnly: typesOnly ?? false,
      rootSchema: node.rootSchema,
      helpersMode,
      helpersImportPrefix,
      readonly,
      typeSuffix,
      importExt,
      isRoot: node.isRoot,
      ...(node.ref !== undefined ? { selfRef: node.ref } : {}),
      ...(logWarnings !== undefined ? { logWarnings } : {}),
      ...(strict !== undefined ? { strict } : {}),
      ...(stripUnknown ? { stripUnknown } : {}),
      ...(caseInsensitive ? { caseInsensitive } : {}),
    })

    files.push({ filename: `${node.filename}.ts`, content: result.content })
    for (const helper of result.usedHelpers) usedHelpers.add(helper)
  })

  // In embedded mode, ship the runtime helper source files alongside the parsers so
  // the output directory is self-contained (no `@amritk/helpers` install required).
  // typesOnly skips parser generation entirely, so no runtime helpers are needed.
  if (helpersMode === 'embedded' && !typesOnly) {
    for (const helper of usedHelpers) {
      const { ext, content } = await readHelperSource(helper, importExt)
      files.push({ filename: `_helpers/${helper}.${ext}`, content })
    }
  }

  files.push({
    filename: 'index.ts',
    content: generateIndexBarrel(files, { typesOnly: typesOnly ?? false, importExt }),
  })

  return files
}
