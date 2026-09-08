import type { NormalizedChannel } from './types'

/**
 * The property a message contract falls back to when nothing names one.
 *
 * Kept as a literal rather than imported from `@amritk/api`: this package's
 * only dependency is `@amritk/helpers`, and the runtime it feeds must stay a
 * *peer* of the generated code, not a dependency of the extractor. The value
 * mirrors `DEFAULT_DISCRIMINATOR` there, and the contract tests hold the two
 * together.
 */
export const DEFAULT_DISCRIMINATOR = 'type'

/**
 * Decides which property tags a channel's messages, in the order the answer
 * gets more specific:
 *
 * 1. `x-mjst: { discriminator }` on the channel itself. The document is the one
 *    place that knows the wire, and it travels with the document — a consumer
 *    regenerating from it does not have to be told again.
 * 2. The caller's override (the CLI's `--discriminator`), for a document you do
 *    not control and cannot annotate.
 * 3. `'type'`, matching `@amritk/api`'s default, so the common case needs no
 *    declaration at all.
 *
 * The document wins over the flag deliberately: one `--discriminator` covers a
 * whole run, and a run may span channels that disagree. A channel that has
 * written its answer down should not have it overwritten by a blanket default
 * meant for the channels that have not.
 */
export const resolveDiscriminator = (channel: NormalizedChannel, override?: string): string =>
  channel.discriminator ?? override ?? DEFAULT_DISCRIMINATOR
