import type { MemoryNode } from './create-memory-host'

/**
 * Renders an in-memory tree as indented text.
 *
 * Assertions read far better against one string than against a walk of nested
 * objects, and a diff on failure shows the shape that actually rendered rather
 * than the first property that happened to differ.
 *
 * Only the parts a test would care about are included: the tag, its props in a
 * stable order, and whether it is hidden. Listeners and parent links are left
 * out, since they are relationships rather than rendered output.
 */
export const serializeMemoryTree = (node: MemoryNode, depth = 0): string => {
  const pad = '  '.repeat(depth)

  if (node.kind === 'text') return `${pad}"${node.value}"`

  const props = Object.entries(node.props)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ` ${name}=${JSON.stringify(value)}`)
    .join('')

  const style = node.style === null ? '' : ` style=${JSON.stringify(node.style)}`
  const hidden = node.visible ? '' : ' hidden'
  const open = `${pad}<${node.tag}${props}${style}${hidden}>`

  if (node.children.length === 0) return open

  const children = node.children.map((child) => serializeMemoryTree(child, depth + 1)).join('\n')
  return `${open}\n${children}`
}
