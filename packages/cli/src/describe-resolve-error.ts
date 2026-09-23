import { withAllowedRootsHint } from './allowed-roots-hint'

/**
 * Turns a `ResolveError` message from `@amritk/resolve-refs` into the text the
 * CLI shows.
 *
 * The resolver records a document that failed to load as `String(err)`, so the
 * message opens with the error's class name — `Error: ENOENT: …`, `Error:
 * Failed to parse …` — which tells the reader nothing and pushes the part that
 * does to the right. Only that leading prefix is dropped; the library keeps its
 * wording, since other callers may match on it. A confinement refusal also gets
 * the `--allowed-roots` hint (see {@link withAllowedRootsHint}).
 */
export const describeResolveError = (message: string): string =>
  withAllowedRootsHint(message.startsWith('Error: ') ? message.slice('Error: '.length) : message)
