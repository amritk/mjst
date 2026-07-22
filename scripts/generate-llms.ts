/**
 * generate-llms — builds `llms.txt` and `llms-full.txt` at the repo root from
 * each package's `package.json` + `AI.md`, following the llmstxt.org convention.
 *
 * - `llms.txt` is a curated, link-rich index: a coding agent (or a docs crawler)
 *   fetches it, then follows the per-package links it needs.
 * - `llms-full.txt` inlines every package's `AI.md` into one file — the
 *   paste-into-context bundle for an agent with no network access.
 *
 * Generated from source so the AI-facing docs can't drift: edit a package's
 * `AI.md`/description, then re-run `bun run generate-llms`. Deterministic (no
 * timestamps) so the output is stable in git.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const REPO = 'https://github.com/amritk/mjst'
const BRANCH = 'main'

/** Curated ordering: entry points first, then generators, then infra. Others append alphabetically. */
const ORDER = [
  'cli',
  'api',
  'mini',
  'lint',
  'generate-parsers',
  'generate-validators',
  'generate-examples',
  'generate-markdown',
  'runtime-validators',
  'adapters',
  'resolve-refs',
  'yaml',
  'helpers',
]

type Pkg = { dir: string; name: string; description: string; aiDoc: string | null }

const readPackages = (): Pkg[] => {
  const dirs = readdirSync(join(ROOT, 'packages'))
  const byOrder = (a: string, b: string): number => {
    const ai = ORDER.indexOf(a)
    const bi = ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  }
  return dirs.sort(byOrder).map((dir) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'))
    let aiDoc: string | null = null
    try {
      aiDoc = readFileSync(join(ROOT, 'packages', dir, 'AI.md'), 'utf8').trim()
    } catch {
      aiDoc = null
    }
    return { dir, name: manifest.name as string, description: (manifest.description ?? '') as string, aiDoc }
  })
}

/** First-sentence-ish trim so the index stays scannable even when a description is a paragraph. */
const short = (description: string): string => {
  const firstSentence = description.split(/\.\s|\. |\.$/)[0]?.trim() ?? description
  return firstSentence.length > 0 ? firstSentence : description
}

const buildIndex = (packages: Pkg[]): string => {
  const lines: string[] = []
  lines.push('# mjst')
  lines.push('')
  lines.push(
    '> Fast, type-safe TypeScript parsers, validators, types, docs, and test data generated from JSON Schema (Draft 2020-12), plus a JSON/YAML linter, a contract-first API layer, and a tiny signals UI layer.',
  )
  lines.push('')
  lines.push(
    'mjst is a pre-alpha monorepo of independently published `@amritk/*` packages. Each package ships an `AI.md` — a mental model, a minimal runnable example, and the gotchas most likely to trip up an LLM. `llms-full.txt` inlines all of them into one file.',
  )
  lines.push('')
  lines.push('## Packages')
  lines.push('')
  for (const pkg of packages) {
    const ai = pkg.aiDoc ? ` — [AI.md](${REPO}/blob/${BRANCH}/packages/${pkg.dir}/AI.md)` : ''
    const readme = `${REPO}/blob/${BRANCH}/packages/${pkg.dir}/README.md`
    lines.push(`- [${pkg.name}](${readme}): ${short(pkg.description)}${ai}`)
  }
  lines.push('')
  lines.push('## Optional')
  lines.push('')
  lines.push(`- [Full AI docs bundle](${REPO}/blob/${BRANCH}/llms-full.txt): every package's AI.md in one file`)
  lines.push(`- [Repository](${REPO}): source, issues, and human-facing READMEs`)
  lines.push('')
  return lines.join('\n')
}

const buildFull = (packages: Pkg[]): string => {
  const parts: string[] = []
  parts.push('# mjst — full AI documentation bundle')
  parts.push('')
  parts.push(
    "Generated from each package's AI.md by `scripts/generate-llms.ts`. This is the paste-into-context bundle; the curated index is `llms.txt`.",
  )
  for (const pkg of packages) {
    if (!pkg.aiDoc) continue
    parts.push('')
    parts.push('---')
    parts.push('')
    parts.push(pkg.aiDoc)
  }
  parts.push('')
  return parts.join('\n')
}

const packages = readPackages()
writeFileSync(join(ROOT, 'llms.txt'), buildIndex(packages))
writeFileSync(join(ROOT, 'llms-full.txt'), buildFull(packages))
console.log(`Wrote llms.txt and llms-full.txt (${packages.filter((p) => p.aiDoc).length} packages with AI.md).`)
