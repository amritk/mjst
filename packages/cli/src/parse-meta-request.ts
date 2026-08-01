import { flagTakesValue } from './parse-cli-args'

/** A request that short-circuits generation and just prints something. */
export type MetaRequest = 'version' | 'help'

/**
 * Detects `mjst version` / `mjst help` and the `--version` / `-v` / `--help` /
 * `-h` flags in raw argv.
 *
 * The subtlety is *where* the token sits. Scanning the whole argv with
 * `includes('-v')` meant that any flag whose **value** happened to be `-v` — say
 * `--type-suffix -v` — printed the version and exited 0 without generating
 * anything, which CI reads as a successful build. So a token in the value
 * position of a value-taking flag is skipped: it belongs to that flag.
 *
 * @returns What the args ask for, or `undefined` for a normal generation run.
 */
export const parseMetaRequest = (args: readonly string[]): MetaRequest | undefined => {
  if (args[0] === 'version') return 'version'
  if (args[0] === 'help') return 'help'

  for (let i = 0; i < args.length; i++) {
    const previous = i > 0 ? args[i - 1] : undefined
    // `--flag=value` carries its own value, so it never consumes the next token.
    const consumedAsValue = previous?.startsWith('--') && !previous.includes('=') && flagTakesValue(previous.slice(2))
    if (consumedAsValue) continue

    const arg = args[i]
    if (arg === '--version' || arg === '-v') return 'version'
    if (arg === '--help' || arg === '-h') return 'help'
  }

  return undefined
}
