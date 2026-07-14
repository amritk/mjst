import { extractRefs } from '@amritk/helpers/extract-refs'
import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { walkRefGraph } from '@amritk/helpers/walk-ref-graph'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Maps each generated filename to the set of *other* filenames sharing its
 * strongly connected component (SCC) in the `$ref` graph. A non-empty set means
 * the file takes part in a cross-file reference cycle (e.g. `a → b → a`), so any
 * reference it emits to one of those siblings must be lazy: two modules that
 * eagerly read each other's top-level `const` at import time crash with a
 * circular-ESM TDZ `ReferenceError`.
 *
 * A file that only references *itself* is a single-node SCC and never appears
 * here — that recursion is already tied lazily via `fc.letrec` inside
 * {@link generateArbitrary}.
 */
export type SchemaCycles = ReadonlyMap<string, ReadonlySet<string>>

/**
 * Collects the ref graph as an adjacency map of filename → referenced
 * filenames, restricted to nodes that are actually generated as files. Self
 * edges are dropped (they are `fc.letrec` recursion, not cross-file cycles).
 */
const buildRefGraph = (rootSchema: JSONSchema, rootTypeName: string, typeSuffix: string): Map<string, Set<string>> => {
  const schemas = new Map<string, JSONSchema>()
  walkRefGraph(rootSchema, rootTypeName, { typeSuffix }, (node) => {
    // `index` is reserved for the barrel and never generated as a definition.
    if (node.filename === 'index') return
    if (!schemas.has(node.filename)) schemas.set(node.filename, node.schema)
  })

  const graph = new Map<string, Set<string>>()
  for (const [filename, schema] of schemas) {
    const targets = new Set<string>()
    for (const ref of extractRefs(schema)) {
      const target = refToFilename(ref)
      // Only edges to other generated files matter — an unresolved/external ref
      // never becomes an eager cross-module reference.
      if (target !== filename && schemas.has(target)) targets.add(target)
    }
    graph.set(filename, targets)
  }
  return graph
}

/**
 * Tarjan's strongly-connected-components algorithm, iterative so a deep ref
 * graph cannot overflow the call stack. Returns one array of filenames per SCC.
 */
const stronglyConnectedComponents = (graph: Map<string, Set<string>>): string[][] => {
  let counter = 0
  const index = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const sccs: string[][] = []

  type Frame = { node: string; iter: Iterator<string> }

  for (const start of graph.keys()) {
    if (index.has(start)) continue

    const callStack: Frame[] = [{ node: start, iter: (graph.get(start) ?? new Set()).values() }]
    index.set(start, counter)
    lowlink.set(start, counter)
    counter++
    stack.push(start)
    onStack.add(start)

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1] as Frame
      const node = frame.node

      let descended = false
      let next = frame.iter.next()
      while (!next.done) {
        const child = next.value
        if (!index.has(child)) {
          index.set(child, counter)
          lowlink.set(child, counter)
          counter++
          stack.push(child)
          onStack.add(child)
          callStack.push({ node: child, iter: (graph.get(child) ?? new Set()).values() })
          descended = true
          break
        }
        if (onStack.has(child)) {
          lowlink.set(node, Math.min(lowlink.get(node) as number, index.get(child) as number))
        }
        next = frame.iter.next()
      }
      if (descended) continue

      // All successors visited: close this node.
      if (lowlink.get(node) === index.get(node)) {
        const scc: string[] = []
        let member: string
        do {
          member = stack.pop() as string
          onStack.delete(member)
          scc.push(member)
        } while (member !== node)
        sccs.push(scc)
      }

      callStack.pop()
      const parent = callStack[callStack.length - 1]
      if (parent) {
        lowlink.set(parent.node, Math.min(lowlink.get(parent.node) as number, lowlink.get(node) as number))
      }
    }
  }

  return sccs
}

/**
 * Detects cross-file `$ref` cycles in a schema's ref graph.
 *
 * Walks the graph via {@link walkRefGraph}, groups files into strongly connected
 * components, and returns — for every file inside a multi-file component — the
 * sibling files it must reference lazily to avoid a circular-ESM TDZ crash.
 * Files not involved in any cross-file cycle are absent from the result.
 *
 * @param rootSchema - The root JSON Schema being built.
 * @param rootTypeName - The name for the root type (e.g. `'Document'`).
 * @param typeSuffix - Suffix appended to every `$ref`-derived name (default `''`).
 */
export const findSchemaCycles = (rootSchema: JSONSchema, rootTypeName: string, typeSuffix = ''): SchemaCycles => {
  const graph = buildRefGraph(rootSchema, rootTypeName, typeSuffix)
  const cycles = new Map<string, Set<string>>()

  for (const scc of stronglyConnectedComponents(graph)) {
    // A single-file component is either an isolated node or pure self-recursion;
    // neither needs cross-file lazy references.
    if (scc.length < 2) continue
    const members = new Set(scc)
    for (const member of scc) {
      const siblings = new Set(members)
      siblings.delete(member)
      cycles.set(member, siblings)
    }
  }

  return cycles
}
