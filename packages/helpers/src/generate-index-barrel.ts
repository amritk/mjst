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

// Generated files declare their public surface with these two forms, so we can
// recover the export names from the source text without parsing it.
const TYPE_EXPORT_RE = /^export type (\w+)/gm
const CONST_EXPORT_RE = /^export const (\w+)/gm

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

    for (const match of file.content.matchAll(TYPE_EXPORT_RE)) typeNames.push(match[1] as string)
    for (const match of file.content.matchAll(CONST_EXPORT_RE)) constNames.push(match[1] as string)

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
