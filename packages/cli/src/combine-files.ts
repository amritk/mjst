import type { GeneratedFile } from '@amritk/generate-parsers'

// Require whitespace after `import` so a property literally named `import` (e.g.
// `import?: string`) is not mistaken for an import statement.
const IMPORT_RE = /^import\s/
const RELATIVE_IMPORT_RE = /\bfrom\s+['"]\.\.?\//

/**
 * Merges the per-schema {@link GeneratedFile}s into a single self-contained
 * TypeScript module. Each generated file imports its sibling definitions via
 * relative paths; since everything now lives in one file those imports are
 * dropped, while any external (package) imports are hoisted to the top and
 * deduplicated. The `index.ts` barrel is skipped because it only re-exports the
 * declarations that are already inlined here.
 *
 * Intended for types-only output, where files contain only type definitions and
 * type-only relative imports (no runtime helpers).
 */
export const combineGeneratedFiles = (files: readonly GeneratedFile[]): string => {
  const externalImports = new Set<string>()
  const bodies: string[] = []

  for (const file of files) {
    if (file.filename === 'index.ts') continue

    const bodyLines: string[] = []
    for (const line of file.content.split('\n')) {
      if (IMPORT_RE.test(line.trimStart())) {
        // Relative imports point at sibling files that are now inlined — drop them.
        if (RELATIVE_IMPORT_RE.test(line)) continue
        externalImports.add(line.trim())
        continue
      }
      bodyLines.push(line)
    }

    const body = bodyLines.join('\n').trim()
    if (body) bodies.push(body)
  }

  const importBlock = [...externalImports].sort().join('\n')
  return [importBlock, bodies.join('\n\n')].filter(Boolean).join('\n\n') + '\n'
}
