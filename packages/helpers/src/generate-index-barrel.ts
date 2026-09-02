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
 * declarations and emits re-exports per module, sorted by filename.
 *
 * Values are re-exported as `const` aliases (`import { parseFoo as parseFoo$0 }
 * … export const parseFoo = parseFoo$0`) rather than through `export { parseFoo }
 * from './foo.js'`. Under ESM the two are equivalent, but TypeScript lowers a
 * re-export to CommonJS as an **accessor**
 * (`Object.defineProperty(exports, 'parseFoo', { get() { … } })`), so every call
 * reached through the barrel pays a getter — and a consumer importing from a
 * barrel that itself barrels a subdirectory pays one per hop. The alias form
 * lowers to a plain data property (`exports.parseFoo = foo_1.parseFoo`), which
 * costs nothing, and stays statically analysable for tree-shaking in esbuild and
 * rollup. Types keep the `export type { … } from` form: a type cannot be aliased
 * through a `const`, and a type re-export emits no runtime code either way.
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

  const modules: { readonly specifier: string; readonly typeNames: string[]; readonly constNames: string[] }[] = []
  // Every name the barrel itself will declare, so an alias can be proven not to
  // shadow one. Two modules exporting the same name is already a barrel that
  // does not compile, so uniqueness across modules comes for free.
  const declaredNames = new Set<string>()

  for (const file of sortedFiles) {
    const moduleName = file.filename.replace(/\.ts$/, '')
    const typeNames: string[] = []
    const constNames: string[] = []

    collectExportNames(file.content, typeNames, constNames)

    if (typeNames.length === 0 && constNames.length === 0) continue

    // An explicit extension so the barrel resolves under Node ESM, not only Bun.
    modules.push({ specifier: `./${moduleName}.${importExt}`, typeNames, constNames })
    for (const name of constNames) declaredNames.add(name)
  }

  if (typesOnly) {
    let indexContent = ''
    for (const { specifier, typeNames } of modules) {
      indexContent += `export type { ${typeNames.join(', ')} } from '${specifier}';\n`
    }
    return indexContent
  }

  const importLines: string[] = []
  const typeLines: string[] = []
  const valueLines: string[] = []

  modules.forEach(({ specifier, typeNames, constNames }, index) => {
    if (typeNames.length > 0) {
      typeLines.push(`export type { ${typeNames.join(', ')} } from '${specifier}';`)
    }
    if (constNames.length === 0) return
    const aliases = constNames.map((name) => {
      // `$<module index>` cannot collide with another module's alias; the loop
      // covers the pathological case of a module exporting that exact name.
      let alias = `${name}$${index}`
      while (declaredNames.has(alias)) alias += '$'
      declaredNames.add(alias)
      return alias
    })
    importLines.push(
      `import { ${constNames.map((name, i) => `${name} as ${aliases[i]}`).join(', ')} } from '${specifier}';`,
    )
    for (const [i, name] of constNames.entries()) valueLines.push(`export const ${name} = ${aliases[i]};`)
  })

  const sections = [importLines, typeLines, valueLines].filter((section) => section.length > 0)
  return sections.map((section) => `${section.join('\n')}\n`).join('\n')
}
