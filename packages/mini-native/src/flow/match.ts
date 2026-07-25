import { toFactory } from '../to-factory'
import { toGetter } from '../to-getter'
import type { HostElement, MaybeReactive } from '../types'
import { MATCH, type MatchData } from './match-marker'

/** Props for {@link Match}. `children` is lazy-or-eager, see {@link toFactory}. */
export type MatchProps = {
  /** This branch's condition; the enclosing `<Switch>` picks the first truthy one. */
  when: MaybeReactive<unknown>
  /** The branch's content, built only if `<Switch>` selects it. */
  children: HostElement | (() => HostElement)
}

/**
 * One branch of a {@link Switch}. It renders nothing itself — it hands back an
 * unmounted carrier holding its condition and its content, which the enclosing
 * `<Switch>` reads and mounts.
 *
 * The carrier is a plain object cast to `HostElement`, not a real element from
 * the host, and the cast is safe because the carrier never reaches the host:
 * `<Switch>` only ever reads the data hung off it and it is never inserted into
 * the tree. Asking the host for an element here would create a real view for
 * every branch of every `<Switch>` — including the branches that never render —
 * which is free on the web and decidedly not free on a device.
 *
 * @example
 * ```tsx
 * <Switch fallback={() => <text>idle</text>}>
 *   <Match when={() => status() === 'loading'}>{() => <text>loading</text>}</Match>
 *   <Match when={() => status() === 'error'}>{() => <text>failed</text>}</Match>
 * </Switch>
 * ```
 */
export const Match = (props: MatchProps): HostElement => {
  const data: MatchData = { when: toGetter(props.when), render: toFactory(props.children) }
  const carrier: { [MATCH]: MatchData } = { [MATCH]: data }
  // The double cast is the honest spelling: `HostElement` is an opaque brand no
  // plain object can satisfy, and nothing here ever pretends otherwise beyond
  // the return type the JSX call site needs.
  return carrier as unknown as HostElement
}
