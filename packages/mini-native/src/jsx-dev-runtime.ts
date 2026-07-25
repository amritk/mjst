/**
 * The development JSX entry point. TypeScript and bundlers resolve this module
 * instead of `jsx-runtime` when compiling in development mode, so it has to
 * exist as its own subpath even though the implementation is shared.
 */

// The JSX namespace holds only types, so it has to be re-exported as a type —
// there is no runtime value behind it to forward.
export type { JSX } from './jsx-runtime'
export { jsxDEV } from './jsx-runtime'
