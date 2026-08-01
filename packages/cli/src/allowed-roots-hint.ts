/**
 * The CLI-level half of a local-`$ref` confinement refusal.
 *
 * `@amritk/resolve-refs` confines a local `$ref` to the directory holding the
 * document it appears in, and when it refuses one its message says to "set
 * allowedRoots" — the name of a *library* option. Someone standing at a terminal
 * cannot set a library option, so the message reads as a dead end: the ordinary
 * multi-version layout (`v1/api.json` referencing `../common/user.json`) fails
 * with no visible way forward. Appending this points them at the flag that
 * actually exists.
 */
const ALLOWED_ROOTS_HINT =
  '— pass --allowed-roots <dir> to permit it (relative paths resolve against the current directory).'

/**
 * Appends {@link ALLOWED_ROOTS_HINT} to a resolver message that blames
 * `allowedRoots`, and leaves every other message untouched. Matching on the
 * option name rather than the full sentence keeps this working across both
 * refusal wordings the resolver produces ("resolves outside the allowed roots"
 * and "no local directory is allowed for this document").
 */
export const withAllowedRootsHint = (message: string): string =>
  message.includes('allowedRoots') ? `${message} ${ALLOWED_ROOTS_HINT}` : message
