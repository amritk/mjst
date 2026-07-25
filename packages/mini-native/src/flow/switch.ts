import { requireHost } from '../current-host'
import { renderChild } from '../render-child'
import { toFactory } from '../to-factory'
import type { HostElement, MiniChildren } from '../types'
import { MATCH, type MatchData, type MatchElement } from './match-marker'

/** Props for {@link Switch}. `children` are the `<Match>` branches. */
export type SwitchProps = {
  /** The `<Match>` branches, in priority order. */
  children: MiniChildren
  /** Rendered when no branch matches. Nothing renders when this is omitted. */
  fallback?: HostElement | (() => HostElement)
}

/**
 * Collects the {@link MatchData} off every `<Match>` among `children`, walking
 * into nested arrays and quietly skipping anything that is not a tagged
 * `<Match>` — a stray string, a `null` from a conditional. Order is preserved
 * because order is exactly what decides branch priority.
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
 * of them are — the multi-way conditional `Show` is the two-branch shortcut for.
 *
 * Branches are tested in order and only the winner is ever built, so a losing
 * branch creates no host nodes and no bindings at all. That matters more here
 * than on the web: the branches of a `<Switch>` are usually whole screens, and
 * building the three you are not showing would mean three view trees crossing
 * the bridge for nothing.
 *
 * Conditions are read in order and only as far as the winner, so a change to
 * any branch above it re-runs the selection while a change below it — which
 * could not have altered the outcome anyway — is not even tracked. When the
 * winner does not change, the pass resolves to the same factory reference and
 * the mounted branch is left alone.
 *
 * The subtree lives inside a wrapper element from the host, exactly as `Show`'s
 * does.
 */
export const Switch = (props: SwitchProps): HostElement => {
  const wrapper = requireHost().createFlowHost()
  const matches = collectMatches(props.children)
  const fallback = props.fallback === undefined ? null : toFactory(props.fallback)
  renderChild(wrapper, () => {
    for (const match of matches) {
      if (match.when()) return match.render
    }
    return fallback
  })
  return wrapper
}
