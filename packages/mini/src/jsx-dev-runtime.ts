/**
 * Development-mode entry for the automatic JSX runtime. Bundlers and bun
 * import `<source>/jsx-dev-runtime` when transpiling JSX in development;
 * mini's dev behaviour is identical to production, so this just re-exports.
 */

// The JSX namespace holds only types, so it must be re-exported type-only —
// at runtime there is no `JSX` binding to forward.
export type { Component, JSX, MiniChild, MiniChildren, MiniElementProps } from './jsx-runtime'
export { jsxDEV } from './jsx-runtime'
