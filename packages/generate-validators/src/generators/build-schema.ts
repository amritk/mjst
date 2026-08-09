import { generateIndexBarrel } from '@amritk/helpers/generate-index-barrel'
import { walkRefGraph } from '@amritk/helpers/walk-ref-graph'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { generateValidatorFile } from './generate-files'

/**
 * Represents a generated TypeScript file with its filename and content.
 */
export type GeneratedFile = {
  filename: string
  content: string
}

/**
 * The runtime contract every generated validator imports: the `ValidationResult`
 * types plus the helpers emitted code calls as free identifiers. Exported so tests
 * can evaluate the very source that ships instead of reimplementing it.
 */
export const VALIDATION_RESULT_CONTENT = `/**
 * A single validation error with a human-readable message and a JSON Pointer
 * path indicating where in the document the error occurred.
 */
export type ValidationError = {
  message: string
  path: string
}

/**
 * The result of a generated validator function.
 * Returns \`true\` when the input is valid, or an object with \`valid: false\`
 * and a list of errors when it is not.
 */
export type ValidationResult = true | { valid: false; errors: ValidationError[] }

/**
 * Structural deep equality used by generated \`const\` checks. Objects compare by
 * their key sets rather than serialization, so \`{ a: 1, b: 2 }\` and
 * \`{ b: 2, a: 1 }\` are equal — unlike \`JSON.stringify\`, which is key-order
 * sensitive and would reject a reordered-but-equal value.
 */
export const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aArray = Array.isArray(a)
  const bArray = Array.isArray(b)
  if (aArray !== bArray) return false
  if (aArray) {
    const aa = a as unknown[]
    const bb = b as unknown[]
    if (aa.length !== bb.length) return false
    for (let i = 0; i < aa.length; i++) if (!valuesEqual(aa[i], bb[i])) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  for (const key of keys) {
    if (!Object.hasOwn(bo, key) || !valuesEqual(ao[key], bo[key])) return false
  }
  return true
}

/**
 * True when every element of \`arr\` is distinct under structural equality
 * ({@link valuesEqual}). Backs generated \`uniqueItems\` checks whose items may be
 * objects or arrays, where a \`JSON.stringify\` dedupe key would be key-order
 * sensitive and let a reordered-but-equal duplicate (\`{ a: 1, b: 2 }\` vs
 * \`{ b: 2, a: 1 }\`) slip through. A native \`Set\` dedupes the all-primitive case
 * in one linear pass; object/array elements fall back to an exact pairwise
 * structural comparison.
 */
export const allUnique = (arr: readonly unknown[]): boolean => {
  const len = arr.length
  if (len < 2) return true
  let allPrimitive = true
  for (let i = 0; i < len; i++) {
    const v = arr[i]
    if (v !== null && typeof v === 'object') {
      allPrimitive = false
      break
    }
  }
  if (allPrimitive) return new Set(arr).size === len
  for (let i = 0; i < len; i++) {
    for (let j = i + 1; j < len; j++) {
      if (valuesEqual(arr[i], arr[j])) return false
    }
  }
  return true
}

/**
 * Escapes one JSON Pointer segment (RFC 6901): \`~\` → \`~0\`, \`/\` → \`~1\`, in that
 * order. Generated error paths are built from *runtime* keys wherever the schema
 * did not name them — a \`patternProperties\` match, an \`additionalProperties\`
 * sweep, a \`propertyNames\` loop — and a key containing a \`/\` would otherwise read
 * back as two segments, so an error on \`{"a/b": …}\` pointed at \`/a/b\`, which is
 * the child \`b\` of a property \`a\`. Keys the schema *does* name are escaped at
 * generation time instead, and \`@amritk/runtime-validators\` escapes the same way,
 * so all three agree.
 *
 * The \`indexOf\` pre-test keeps the common key — no \`/\`, no \`~\` — off the replace
 * path entirely, which is what the interpreter does for the same reason.
 */
export const escapePointer = (key: string): string =>
  key.indexOf('/') !== -1 || key.indexOf('~') !== -1 ? key.replace(/~/g, '~0').replace(/\\//g, '~1') : key
`

/**
 * Builds all TypeScript validator files from a JSON Schema by traversing all
 * `$ref` / `$dynamicRef` references recursively (via the shared
 * `@amritk/helpers/walk-ref-graph` walker).
 *
 * Each generated file exports:
 * - A TypeScript type definition
 * - A `validateFoo(input: unknown, _path?: string): ValidationResult` function
 *
 * A `validation-result.ts` file containing the `ValidationResult` and `ValidationError`
 * runtime contract is always emitted. An `index.ts` re-exports everything.
 *
 * @param rootSchema - The root JSON Schema to build from
 * @param rootTypeName - The name for the root type (e.g. "Document")
 * @param typeSuffix - Suffix appended to every type name derived from a `$ref`
 *   (e.g. `'Object'` → `ContactObject`). Defaults to `''`. The root type name is
 *   used verbatim and is not affected.
 * @param schemas - Other schema documents you have **already loaded**, keyed by
 *   the absolute URI a `$ref` names them by. Supplying them makes those URIs
 *   resolvable, so the schema can reference a document that is not itself — each
 *   one becomes a resource of the generated document, with its own `$id`,
 *   anchors and nested resources all resolvable. Nothing is fetched here:
 *   loading is yours to do (or `@amritk/resolve-refs`'), and a `$ref` to a URI
 *   nobody registered still stops generation. Only the documents actually
 *   referenced get files.
 * @returns An array of generated TypeScript files
 *
 * @example
 * ```typescript
 * const files = await buildValidatorSchema(schema, 'Document')
 * // files → [{ filename: 'document.ts', content: '...' }, { filename: 'info.ts', ... }, ...]
 *
 * // Referencing a document you loaded yourself:
 * const withRemote = await buildValidatorSchema({ $ref: 'https://example.com/user.json' }, 'Document', '', {
 *   'https://example.com/user.json': userSchema,
 * })
 * ```
 */
export const buildValidatorSchema = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  typeSuffix = '',
  schemas?: Readonly<Record<string, unknown>>,
): Promise<GeneratedFile[]> => {
  const files: GeneratedFile[] = []

  walkRefGraph(rootSchema, rootTypeName, { typeSuffix, ...(schemas !== undefined ? { schemas } : {}) }, (node) => {
    // `validation-result` and `index` are reserved output filenames. Skipping a
    // definition that wants one of them looked safe and was not: nothing stopped
    // the *importers* from being generated, so a `$defs.index` produced a
    // `root.ts` importing `validateIndex` from the barrel — a `TS2305` at build
    // time and a `SyntaxError` at runtime. Refusing here is what
    // `walkRefGraph` already does for two definitions that want one filename;
    // renaming has to be the caller's call, since the name is what every emitted
    // import is keyed on.
    if (node.filename === 'validation-result' || node.filename === 'index') {
      const owner = node.isRoot ? `the root type "${node.typeName}"` : `"${node.ref}"`
      const purpose = node.filename === 'index' ? 'the generated barrel' : "the generated validators' runtime contract"
      throw new Error(
        `${owner} generates the file "${node.filename}.ts", which is reserved for ${purpose}. Rename the ` +
          'definition (or pass a different root type name) so it gets a file of its own.',
      )
    }

    const content = generateValidatorFile(node.schema, node.typeName, {
      rootSchema: node.rootSchema,
      typeSuffix,
      ...(node.ref !== undefined ? { selfRef: node.ref } : {}),
    })
    files.push({ filename: `${node.filename}.ts`, content })
  })

  // Emit the runtime contract for validators. ValidationResult is mjst-defined
  // (not derived from the input schema), so its content is fixed.
  files.push({ filename: 'validation-result.ts', content: VALIDATION_RESULT_CONTENT })

  files.push({ filename: 'index.ts', content: generateIndexBarrel(files) })

  return files
}
