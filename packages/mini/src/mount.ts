import { effectScope } from 'alien-signals'

/**
 * Mounts a component into a container and returns a dispose that tears down
 * everything the component set up — mini's application root.
 *
 * A mini component runs once and returns an element; the reactivity it creates
 * (bindings, effects, `onCleanup` registrations) lives in whatever
 * `effectScope` is active while it runs. At the top level there is none, so a
 * root component appended straight with `container.appendChild(App())` leaves
 * its effects with no owner — nothing can dispose them and a top-level
 * `onCleanup` never fires. `mount` is that owner: it runs `component` inside a
 * fresh `effectScope`, appends the returned node, and hands back a `dispose`
 * that removes the node and tears the scope down (stopping every effect and
 * running every `onCleanup`).
 *
 * Use it once at the entry point — `const dispose = mount(document.body, App)` —
 * and call `dispose()` when the whole tree should go away (a test, an unmounted
 * micro-frontend, a hot-reload boundary).
 *
 * @example
 * ```tsx
 * const Counter = () => {
 *   const count = signal(0)
 *   return (
 *     <button onClick={() => count(count() + 1)}>
 *       {() => `clicked ${count()} times`}
 *     </button>
 *   )
 * }
 * const dispose = mount(document.body, Counter)
 * // later: dispose() removes the node and stops every effect it created.
 * ```
 */
export const mount = (container: Element, component: () => Node): (() => void) => {
  // effectScope runs its body synchronously; the assignment is definite, just
  // invisible to the compiler — hence the non-null assertion.
  let node!: Node
  const dispose = effectScope(() => {
    node = component()
  })
  container.appendChild(node)
  return () => {
    dispose()
    ;(node as ChildNode).remove()
  }
}
