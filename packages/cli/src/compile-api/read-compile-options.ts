import { readFile } from 'node:fs/promises'
import type { CompileModuleOptions } from '@amritk/api'

/**
 * Reads the `--options` JSON file: everything `compileToModule` accepts that
 * has no dedicated flag (contextExport, mounts, info, servers, security,
 * securitySchemes, hook exports, ...) rides in here and is spread into the
 * compile options. Throws with the file path on unreadable or invalid input
 * so the CLI can report exactly which file to fix.
 */
export const readCompileOptions = async (optionsPath: string): Promise<Partial<CompileModuleOptions>> => {
  let raw: string
  try {
    raw = await readFile(optionsPath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read --options file at ${optionsPath}.\n${String(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in --options file at ${optionsPath}.\n${String(error)}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid --options file at ${optionsPath}: expected a JSON object of compileToModule options.`)
  }

  // The JSON boundary: the file is user input, so the shapes cannot be proven
  // here — compileToModule validates the semantic bits (identifiers, mount
  // prefixes) itself, the same trust the CLI extends to its own config file.
  return parsed as Partial<CompileModuleOptions>
}
