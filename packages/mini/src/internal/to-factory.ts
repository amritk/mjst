/**
 * Normalises a control-flow branch — passed either as an already-built node or
 * as a function that builds one — into a factory that produces the node.
 *
 * The distinction is deliberate and load-bearing. Because mini has no compiler,
 * JSX children are evaluated eagerly: `<Show><Heavy/></Show>` builds `<Heavy/>`
 * before `Show` ever runs. Passing a **function** (`{() => <Heavy/>}`) defers
 * that construction to the moment the branch is shown and rebuilds it on every
 * re-entry — the lazy form. Passing a **node** reuses the same element each time
 * it re-enters, preserving its internal state (focus, scroll, input value). The
 * caller picks the trade-off; this helper keeps both on one call path.
 */
export const toFactory = (value: Node | (() => Node)): (() => Node) =>
  typeof value === 'function' ? value : () => value
