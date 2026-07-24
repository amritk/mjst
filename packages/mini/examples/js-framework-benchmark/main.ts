/**
 * A keyed [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
 * implementation in `@amritk/mini`, tuned for the operations that benchmark
 * measures. It is an example, not part of the published package — it shows how
 * to reach for mini's fast paths when a screen really is create/update/reorder
 * heavy (a data grid), the exact case the core README points at a real framework
 * for.
 *
 * Four techniques carry it, each mapped to the column it moves:
 *
 * 1. **`template()`-cloned rows** — a row is cloned from one parsed `<tr>`
 *    instead of built element-by-element through the JSX runtime, so *create*,
 *    *replace all*, and *create many* pay one `cloneNode` per row, not a dozen
 *    `createElement`s. `data-ref` pulls the label cell straight out of the clone.
 * 2. **Keyed `list`** — reconciliation is mini's move-minimal two-ended diff, so
 *    *swap rows* is two DOM moves, *remove row* is zero, and *append* batches
 *    through a fragment. Row identity survives every reorder.
 * 3. **O(1) select** — selection is applied imperatively to the two rows that
 *    actually change (clear the old, set the new), never as a per-row reactive
 *    class every row would re-read. Selecting in a 1,000-row table touches two
 *    nodes, not a thousand.
 * 4. **Event delegation** — one `click` listener on the `<tbody>` handles every
 *    row's select and remove via `event.target.closest`, so 1,000 rows add one
 *    listener, not two thousand. Delegation is deliberately out of mini's core
 *    charter (`on*` props are plain `addEventListener`), so it lives here in the
 *    app, wired through a `ref` — the sanctioned escape hatch.
 *
 * Only the label is reactive (a per-row `signal` bound with `bindText`), so
 * *partial update* rewrites just the touched cells and never reconciles the list.
 */

import { bindText, list, type Signal, signal, template } from '@amritk/mini'

/** One table row: a stable id for keying and a reactive label. */
export type Row = { id: number; label: Signal<string> }

const ADJECTIVES = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
]
const COLOURS = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange']
const NOUNS = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
]

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T

/** The benchmark's "AdjectiveColourNoun" label, e.g. "elegant red keyboard". */
const randomLabel = (): string => `${pick(ADJECTIVES)} ${pick(COLOURS)} ${pick(NOUNS)}`

/** The parsed row template — cloned once per row instead of built element-by-element. */
const rowTemplate = template(
  '<tr>' +
    '<td class="col-md-1" data-ref="id"></td>' +
    '<td class="col-md-4"><a class="lbl" data-ref="label"></a></td>' +
    '<td class="col-md-1"><a class="remove"><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>' +
    '<td class="col-md-6"></td>' +
    '</tr>',
)

/** The store plus the operations the benchmark's buttons and row clicks invoke. */
export type BenchmarkStore = {
  rows: () => readonly Row[]
  selectedId: () => number | null
  run: () => void
  runLots: () => void
  add: () => void
  update: () => void
  clear: () => void
  swapRows: () => void
  select: (id: number) => void
  remove: (id: number) => void
}

/**
 * Builds the benchmark UI and returns its root element plus the store driving
 * it. Append `element` to the document to run it; call the store operations
 * directly (or click the rendered controls) to exercise each measured path.
 */
export const createBenchmarkApp = (): { element: HTMLElement; store: BenchmarkStore } => {
  const rows = signal<readonly Row[]>([])
  let nextId = 1
  // Selection is tracked imperatively: the currently-danger row node and its id.
  // Nothing reactive reads it, so a select touches exactly two nodes.
  let selectedNode: HTMLElement | null = null
  let selectedId: number | null = null

  const buildRows = (count: number): Row[] =>
    Array.from({ length: count }, () => ({ id: nextId++, label: signal(randomLabel()) }))

  const setSelected = (node: HTMLElement | null, id: number | null): void => {
    if (selectedNode === node) return
    if (selectedNode) selectedNode.classList.remove('danger')
    if (node) node.classList.add('danger')
    selectedNode = node
    selectedId = id
  }

  const store: BenchmarkStore = {
    rows,
    selectedId: () => selectedId,
    run: () => rows(buildRows(1000)),
    runLots: () => rows(buildRows(10000)),
    add: () => rows([...rows(), ...buildRows(1000)]),
    update: () => {
      const data = rows()
      // Every tenth label, rewritten in place. The array reference is unchanged,
      // so `list` never reconciles — only the touched `bindText` effects fire.
      for (let i = 0; i < data.length; i += 10) {
        const row = data[i] as Row
        row.label(`${row.label()} !!!`)
      }
    },
    clear: () => {
      rows([])
      setSelected(null, null)
    },
    swapRows: () => {
      const data = rows()
      if (data.length <= 998) return
      const next = data.slice()
      const one = next[1] as Row
      next[1] = next[998] as Row
      next[998] = one
      rows(next)
    },
    select: (id) => {
      const node = tbody.querySelector<HTMLElement>(`tr[data-id="${id}"]`)
      setSelected(node, node ? id : null)
    },
    remove: (id) => {
      if (id === selectedId) setSelected(null, null)
      rows(rows().filter((row) => row.id !== id))
    },
  }

  /** Builds one row node from the template clone, binding only the reactive label. */
  const createRow = (row: Row): HTMLElement => {
    const { root, ref } = rowTemplate()
    ref['id'].textContent = String(row.id)
    root.dataset['id'] = String(row.id)
    // The label is the one reactive cell: `partial update` rewrites it without
    // rebuilding the row or reconciling the list.
    bindText(ref['label'], row.label)
    return root
  }

  const shell = template(
    '<div class="container">' +
      '<div class="jumbotron"><div class="row"><div class="col-md-6"><h1>mini keyed</h1></div>' +
      '<div class="col-md-6"><div class="row">' +
      '<div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" data-ref="run">Create 1,000 rows</button></div>' +
      '<div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" data-ref="runlots">Create 10,000 rows</button></div>' +
      '<div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" data-ref="add">Append 1,000 rows</button></div>' +
      '<div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" data-ref="update">Update every 10th row</button></div>' +
      '<div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" data-ref="clear">Clear</button></div>' +
      '<div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" data-ref="swaprows">Swap Rows</button></div>' +
      '</div></div></div></div>' +
      '<table class="table table-hover table-striped test-data"><tbody data-ref="tbody"></tbody></table>' +
      '</div>',
  )

  const { root, ref } = shell()
  const tbody = ref['tbody'] as HTMLTableSectionElement

  list(tbody, rows, (row) => String(row.id), createRow)

  ref['run'].addEventListener('click', store.run)
  ref['runlots'].addEventListener('click', store.runLots)
  ref['add'].addEventListener('click', store.add)
  ref['update'].addEventListener('click', store.update)
  ref['clear'].addEventListener('click', store.clear)
  ref['swaprows'].addEventListener('click', store.swapRows)

  // One delegated listener for every row. A click on the remove glyph (or its
  // anchor) deletes; any other click in a row selects it.
  tbody.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const tr = target.closest<HTMLElement>('tr')
    if (!tr) return
    const id = Number(tr.dataset['id'])
    if (target.closest('.remove')) {
      event.preventDefault()
      store.remove(id)
    } else {
      setSelected(tr, id)
    }
  })

  return { element: root, store }
}
