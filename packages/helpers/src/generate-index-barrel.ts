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

/** Reads the identifier following `prefix` when `content` starts with it at `at`. */
const exportNameAt = (content: string, at: number, prefix: string): string | null => {
  if (!content.startsWith(prefix, at)) return null
  let end = at + prefix.length
  while (end < content.length) {
    const code = content.charCodeAt(end)
    const isWord =
      (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 95
    if (!isWord) break
    end++
  }
  return end > at + prefix.length ? content.slice(at + prefix.length, end) : null
}

/** True for every JS LineTerminator code unit — the same set the old `/m` regexes anchored after. */
const isLineTerminator = (code: number): boolean => code === 10 || code === 13 || code === 8232 || code === 8233

/**
 * Collects `export type` / `export const` names with a single line-start walk.
 * A multiline-anchored regex scan (`/^export .../gm`) does the same job but
 * showed up at several percent of total generation time in CPU profiles — the
 * regex engine re-anchors at every line of every generated file on every build.
 */
const collectExportNames = (content: string, typeNames: string[], constNames: string[]): void => {
  let lineStart = 0
  while (lineStart < content.length) {
    // charCode prefilter: almost every line starts with whitespace, a brace, or
    // a keyword other than `export` — one integer compare skips the substring
    // comparison for all of them (101 === 'e').
    if (content.charCodeAt(lineStart) === 101 && content.startsWith('export ', lineStart)) {
      const typeName = exportNameAt(content, lineStart, 'export type ')
      if (typeName !== null) {
        typeNames.push(typeName)
      } else {
        const constName = exportNameAt(content, lineStart, 'export const ')
        if (constName !== null) constNames.push(constName)
      }
    }
    // Advance past the next line break of ANY JS flavor (LF, CR, CRLF,
    // U+2028, U+2029) — matching the multiline regexes this walk replaced,
    // which treated all of them as line starts.
    let next = lineStart
    while (next < content.length && !isLineTerminator(content.charCodeAt(next))) next++
    if (next >= content.length) break
    // \r\n counts as one break.
    lineStart = content.charCodeAt(next) === 13 && content.charCodeAt(next + 1) === 10 ? next + 2 : next + 1
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
