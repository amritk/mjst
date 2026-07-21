import { createHost } from '../internal/create-host'
import { renderChild } from '../internal/render-child'
import { toFactory } from '../internal/to-factory'
import type { MiniChildren } from '../jsx-runtime'
import { MATCH, type MatchData, type MatchElement } from './match-marker'

/** Props for {@link Switch}. `children` are the `<Match>` branches. */
export type SwitchProps = {
  /** The `<Match>` branches, in priority order. */
  children: MiniChildren
  /** Shown when no branch matches. Nothing renders when omitted. */
  fallback?: Node | (() => Node)
}

/**
 * Collects the {@link MatchData} off every `<Match>` element among `children`,
 * flattening arrays and skipping anything that is not a tagged `<Match>` (stray
 * whitespace, comments). Order is preserved because it decides branch priority.
 */
const collectMatches = (children: MiniChildren): MatchData[] => {
  const matches: MatchData[] = []
  const visit = (child: unknown): void => {
    if (Array.isArray(child)) {
      for (const nested of child) visit(nested)
      return
    }
    if (child !== null && typeof child === 'object' && MATCH in child) {
      const data = (child as MatchElement)[MATCH]
      if (data) matches.push(data)
    }
  }
  visit(children)
  return matches
}

/**
 * Renders the first `<Match>` whose `when` is truthy, or `fallback` when none
 * match — mini's multi-way conditional. It is `Show` generalised: the branches
 * are evaluated in order and only the winner is built and mounted, so the
 * losing branches never create DOM or bindings.
 */
export const Switch = (props: SwitchProps): HTMLElement => {
  const host = createHost()
  const matches = collectMatches(props.children)
  const fallback = props.fallback === undefined ? null : toFactory(props.fallback)
  renderChild(host, () => {
    for (const match of matches) {
      if (match.when()) return match.render
    }
    return fallback
  })
  return host
}
