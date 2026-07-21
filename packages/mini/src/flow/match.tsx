import { toFactory } from '../internal/to-factory'
import { toGetter } from '../internal/to-getter'
import type { MaybeReactive } from '../jsx-runtime'
import { MATCH, type MatchElement } from './match-marker'

/** Props for {@link Match}. `children` is lazy-or-eager, see {@link toFactory}. */
export type MatchProps = {
  /** This branch's condition; the enclosing `<Switch>` picks the first truthy one. */
  when: MaybeReactive<unknown>
  /** The branch's content, built only if `<Switch>` selects it. */
  children: Node | (() => Node)
}

/**
 * One branch of a {@link Switch}. It renders nothing itself — it returns an
 * unmounted placeholder element carrying its condition and content, which the
 * parent `<Switch>` reads and mounts.
 *
 * The placeholder is a real `HTMLElement` (so the return type stays mini's
 * `JSX.Element` with no cast at the call site), but it is never inserted into
 * the document; `<Switch>` only ever reads the data hung off it.
 */
export const Match = (props: MatchProps): HTMLElement => {
  const carrier = document.createElement('template') as MatchElement
  carrier[MATCH] = { when: toGetter(props.when), render: toFactory(props.children) }
  return carrier
}
