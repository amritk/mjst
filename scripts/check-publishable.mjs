import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The last gate before a tarball leaves the machine.
//
// `release:publish` prepares three things no checked-in manifest carries — concrete
// versions in place of `workspace:`/`catalog:`, the `development` condition stripped,
// and a LICENSE copied into each package — and `bun run build` produces the `dist/`
// every entry point names. All four happen in the ephemeral publish job, which means
// all four are skipped by an `npm publish` run anywhere else.
//
// That is not hypothetical. `@amritk/mjst@0.7.15` and `@amritk/generate-parsers@0.12.3`
// shipped dead on arrival — tsc-alias corrupted a regex literal in the compiled JS and
// the CLI threw a SyntaxError before doing any work — and are deprecated on npm rather
// than fixable, because a published version is forever. In the sibling repo the same
// class of miss went further: `@amritk/mini-lynx-native@0.2.0` was published by hand
// with no `dist/` at all, and the surviving `development` condition pointed at the
// `src` its tarball also shipped, so anything honouring that condition resolved raw
// TypeScript and the package looked healthy.
//
// `npm publish` runs this from the package root as `prepublishOnly`, so a publish that
// skipped the pipeline fails loudly instead of shipping a manifest whose exports name
// files that are not there. dist-smoke and cli-e2e guard the same ground for the repo;
// this guards the act of publishing, which is the part no CI step can reach.

/** Every `./dist/...` target declared anywhere in a manifest subtree. */
const distTargets = (node, found = []) => {
  if (typeof node === 'string') {
    if (node.startsWith('./dist/')) found.push(node)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  for (const value of Object.values(node)) distTargets(value, found)
  return found
}

/**
 * The fields through which a package can hand a consumer its build output.
 *
 * `exports` alone is not enough: `@amritk/mjst` is a CLI, its only entry is
 * `bin.mjst`, and its exports map carries nothing but `./package.json` — so a
 * check that read exports alone would call the one package with an executable
 * unreachable, and would have nothing to say if that executable went missing.
 */
const ENTRY_FIELDS = ['exports', 'bin', 'main', 'module', 'types']

/** True when a `development` condition survives anywhere in an exports subtree. */
const hasDevelopmentCondition = (node) => {
  if (node === null || typeof node !== 'object') return false
  if ('development' in node) return true
  return Object.values(node).some(hasDevelopmentCondition)
}

/**
 * Whether an export target names a file that is actually there.
 *
 * `@amritk/helpers` exports `./*` as `./dist/*.js`, so a target can be a pattern
 * rather than a path. A pattern is satisfied by any one file of that extension —
 * which is all the manifest itself promises — while a literal target has to exist
 * outright.
 */
const targetExists = (dir, target) => {
  if (!target.includes('*')) return existsSync(join(dir, target))
  const distDir = join(dir, 'dist')
  if (!existsSync(distDir)) return false
  const extension = target.slice(target.lastIndexOf('*') + 1)
  return readdirSync(distDir, { recursive: true }).some((file) => file.endsWith(extension))
}

/**
 * Returns the reasons `dir` must not be published, empty when it is publishable.
 * A private package is publishable by definition — npm will not publish it.
 */
export const checkPublishable = (dir) => {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
  if (pkg.private === true) return []

  const problems = []

  const targets = [...new Set(ENTRY_FIELDS.flatMap((field) => distTargets(pkg[field] ?? {})))]
  if (targets.length === 0) {
    // Not a stylistic complaint: a manifest with no dist target anywhere is how
    // this check goes quiet, and a quiet check is worse than no check.
    problems.push(
      `no ./dist/ target in ${ENTRY_FIELDS.join('/')} — the build output is not reachable from the manifest`,
    )
  }
  const missing = targets.filter((target) => !targetExists(dir, target))
  if (missing.length > 0) {
    problems.push(`the manifest points at files that do not exist — run \`bun run build\`:\n  ${missing.join('\n  ')}`)
  }

  if (hasDevelopmentCondition(pkg.exports ?? {})) {
    // The condition points at `./src/*.ts`. `@amritk/helpers` ships four of those
    // files outright, so for that package it resolves rather than failing — which
    // is the quiet version of this bug and the reason it is checked here at all.
    problems.push(
      'exports still carries a `development` condition — run `bun run scripts/strip-development-exports.ts`',
    )
  }

  if (!existsSync(join(dir, 'LICENSE'))) {
    problems.push('no LICENSE in the package directory — run `bun run scripts/copy-license.ts`')
  }

  return problems
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? process.cwd()
  const problems = checkPublishable(dir)
  if (problems.length > 0) {
    const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name ?? dir
    console.error(`${name} is not publishable as it stands:\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`)
    console.error('Publish through the release workflow (`bun run release:publish`), which prepares all of them.')
    process.exit(1)
  }
}
