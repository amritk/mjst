/** A generated file: its name (with extension) and TypeScript source. */
export type IndexBarrelFile = {
  filename: string
  content: string
}

/** Options controlling how the barrel re-exports each module. */
export type GenerateIndexBarrelOptions = {
  /**
   * When true, every re-export is type-only (`export type { ... }`). Used by the
   * types-only parser output, where no runtime values exist to re-export.
   * Defaults to `false`.
   */
  readonly typesOnly?: boolean
  /**
   * Extension used on every relative re-export specifier. `'js'` (default) is
   * the standard TS NodeNext form (`./x.js` resolving to a sibling `x.ts`);
   * `'ts'` emits the literal on-disk path so the output runs directly under
   * Node's type stripping.
   */
  readonly importExt?: 'js' | 'ts'
}

// Generated files declare their public surface with `export type <Name>` /
// `export const <Name>` at line starts, so the names can be recovered from the
// source text without parsing it.

/**
 * Non-ASCII identifier characters, tested one code point at a time.
 *
 * The scan below is charCode-based for speed, and its ASCII-only word test used
 * to end an identifier at the first non-ASCII character — so a definition named
 * `中文` produced `export type 中文` that the barrel read as *no name at all*,
 * and `export const parse中文` that it read as `parse`. Every non-ASCII module
 * then contributed the same truncated names and the barrel failed to compile
 * with duplicate identifiers. TypeScript identifiers are ID_Start/ID_Continue
 * (plus `$`), so that is the set to accept.
 */
const NON_ASCII_IDENTIFIER_PART = /[\p{ID_Continue}$]/u

/** True when the code point at `index` may appear inside an identifier. */
const isIdentifierPart = (content: string, index: number): boolean => {
  const code = content.charCodeAt(index)
  if ((code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57)) return true
  if (code === 95 || code === 36) return true
  if (code < 128) return false
  return NON_ASCII_IDENTIFIER_PART.test(String.fromCodePoint(content.codePointAt(index) as number))
}

/** Reads the identifier following `prefix` when `content` starts with it at `at`. */
const exportNameAt = (content: string, at: number, prefix: string): string | null => {
  if (!content.startsWith(prefix, at)) return null
  let end = at + prefix.length
  while (end < content.length && isIdentifierPart(content, end)) {
    // Advance a whole code point so an astral identifier character is not split
    // mid-surrogate (and its trailing half misread as the end of the name).
    end += (content.codePointAt(end) as number) > 0xffff ? 2 : 1
  }
  return end > at + prefix.length ? content.slice(at + prefix.length, end) : null
}

/** True for every JS LineTerminator code unit — the same set the old `/m` regexes anchored after. */
const isLineTerminator = (code: number): boolean => code === 10 || code === 13 || code === 8232 || code === 8233

const EXPORT_KEYWORD = 'export '

/**
 * Collects `export type` / `export const` names from a generated module.
 *
 * We jump straight to each `export ` with `indexOf` and then check it opens a
 * line, rather than walking the source line by line. Both a `/^export .../gm`
 * regex and a hand-rolled line walk read every character of every generated file
 * on every build, and the walk was still the single largest cost in a CPU
 * profile of a generation run (~18%). `indexOf` is the engine's native substring
 * search, so the long stretches between exports — which is nearly all of the
 * source — are skipped in bulk.
 *
 * The line-start test accepts any JS LineTerminator (LF, CR, U+2028, U+2029),
 * exactly the set the line walk treated as a line break; for CRLF the character
 * before the keyword is the `\n`, so it qualifies on the same rule.
 */
const collectExportNames = (content: string, typeNames: string[], constNames: string[]): void => {
  let at = content.indexOf(EXPORT_KEYWORD)
  while (at !== -1) {
    if (at === 0 || isLineTerminator(content.charCodeAt(at - 1))) {
      const typeName = exportNameAt(content, at, 'export type ')
      if (typeName !== null) {
        typeNames.push(typeName)
      } else {
        const constName = exportNameAt(content, at, 'export const ')
        if (constName !== null) constNames.push(constName)
      }
    }
    at = content.indexOf(EXPORT_KEYWORD, at + EXPORT_KEYWORD.length)
  }
}

/**
 * Builds the `index.ts` barrel that re-exports every generated module. This is
 * the shared version of the near-identical barrel each generator used to build
 * inline: it scans each file's source for `export type` / `export const`
 * declarations and emits one re-export line per module, sorted by filename.
 *
 * Files under `_helpers/` are internal runtime helpers (embedded-mode output)
 * and are never re-exported. Modules that expose nothing are skipped.
 *
 * @param files - The generated files to barrel (the `index.ts` itself excluded).
 * @param options - See {@link GenerateIndexBarrelOptions}.
 * @returns The `index.ts` file content.
 */
export const generateIndexBarrel = (files: IndexBarrelFile[], options: GenerateIndexBarrelOptions = {}): string => {
  const typesOnly = options.typesOnly ?? false
  const importExt = options.importExt ?? 'js'

  const sortedFiles = files
    .filter((file) => !file.filename.startsWith('_helpers/'))
    .sort((a, b) => a.filename.localeCompare(b.filename))

  let indexContent = ''
  for (const file of sortedFiles) {
    const moduleName = file.filename.replace(/\.ts$/, '')
    const typeNames: string[] = []
    const constNames: string[] = []

    collectExportNames(file.content, typeNames, constNames)

    if (typeNames.length === 0 && constNames.length === 0) continue

    // An explicit extension so the barrel resolves under Node ESM, not only Bun.
    if (typesOnly) {
      indexContent += `export type { ${typeNames.join(', ')} } from './${moduleName}.${importExt}';\n`
    } else {
      const typeExports = typeNames.map((name) => `type ${name}`)
      indexContent += `export { ${[...typeExports, ...constNames].join(', ')} } from './${moduleName}.${importExt}';\n`
    }
  }

  return indexContent
}
