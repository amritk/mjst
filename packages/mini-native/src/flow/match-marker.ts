import type { ChildFactory } from '../render-child'
import type { HostElement } from '../types'

/** The data a `<Match>` carries for its enclosing `<Switch>`. */
export type MatchData = {
  /** The branch's condition, read reactively by the `<Switch>`. */
  when: () => unknown
  /** Builds the branch's subtree, and only once `<Switch>` has selected it. */
  render: ChildFactory
}

/**
 * The property key a `<Match>` stashes its {@link MatchData} under on the
 * carrier it returns. A `Symbol` cannot collide with anything a host might put
 * on its own node type and stays invisible to enumeration, so a `<Switch>` can
 * recognise its `<Match>` children with a single `in` check.
 */
export const MATCH = Symbol('mini.match')

/** A `<Match>`'s return value, tagged with the data its `<Switch>` reads. */
export type MatchElement = HostElement & { [MATCH]?: MatchData }
