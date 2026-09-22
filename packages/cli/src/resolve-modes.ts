import type { Mode } from '@amritk/validation'

import type { CliConfig } from './cli-config'

/**
 * Turns the flags a run was given into the list of entry points `generate()`
 * should emit.
 *
 * The CLI predates the mode list: its flags grew one at a time, each one meaning
 * "also emit this function", so the mapping is additive rather than a choice.
 * Keeping it in one place means the four generation flows cannot drift on what
 * `--strict --validators --repair` is supposed to produce.
 *
 * `--types-only` is the one run with nothing to execute, so it stops at `types`
 * — asking for a parser there would emit runtime code the flag exists to avoid.
 * `--validators-only` is its mirror at the other end: everything that judges a
 * document, and nothing that builds one. Between them, every run carries a
 * parser, because emitting one is what the CLI does when you do not tell it
 * otherwise.
 */
export const resolveModes = (config: Partial<CliConfig>): Mode[] => {
  if (config.typesOnly === true) return ['types']

  const modes: Mode[] = ['types']

  // The validator half comes in through `--validators` or `--validators-only`,
  // which implies it; the flags that shape it are rejected on their own well
  // before we get here.
  if (config.validators === true || config.validatorsOnly === true) {
    modes.push('guard', 'validate')
    if (config.check === true) modes.push('check')
    if (config.coerce === true) modes.push('coerce')
    if (config.repair === true) modes.push('repair')
  }

  // `parse` and `parseStrict` are the same function under two contracts, so
  // exactly one of them is ever asked for — and `--validators-only` asks for
  // neither.
  if (config.validatorsOnly !== true) {
    modes.push(config.strict === true ? 'parseStrict' : 'parse')
  }

  return modes
}
