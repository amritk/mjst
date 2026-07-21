import type { ChildFactory } from './render-child'

/** The data a `<Match>` carries for its enclosing `<Switch>`. */
export type MatchData = {
  /** The branch's condition, read reactively by the `<Switch>`. */
  when: () => unknown
  /** Builds the branch's subtree once `<Switch>` selects it. */
  render: ChildFactory
}

/**
 * The property key a `<Match>` stashes its {@link MatchData} under on the
 * placeholder element it returns. A `Symbol` keeps it invisible to attribute
 * enumeration and impossible to collide with a real DOM property, so a
 * `<Switch>` can recognise its `<Match>` children by a single `in` check.
 */
export const MATCH = Symbol('mini.match')

/** A `<Match>`'s return element, tagged with the data its `<Switch>` reads. */
export type MatchElement = HTMLElement & { [MATCH]?: MatchData }
