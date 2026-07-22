import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseWithPointers } from '@amritk/lint'
import type { RulesetDefinition } from '@amritk/lint/types'

const RULESET_FILENAMES = ['.lint.yaml', '.lint.yml', '.lint.json', '.lint.js', '.lint.mjs']

/** Loads a ruleset definition from a YAML, JSON, or JS/MJS file. */
export const loadRuleset = async (path: string): Promise<RulesetDefinition> => {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path)
  if (/\.(c|m)?js$/.test(absolute)) {
    const module = await import(pathToFileURL(absolute).href)
    return (module.default ?? module) as RulesetDefinition
  }
  const content = await readFile(absolute, 'utf8')
  return parseWithPointers<RulesetDefinition>(content).data
}

/** Walks up from a directory looking for a `.lint.*` ruleset file. */
export const discoverRuleset = (startDir: string): string | undefined => {
  let dir = resolve(startDir)
  while (true) {
    for (const name of RULESET_FILENAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
