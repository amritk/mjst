import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Describes the shape of a single property entry inside a JSON Schema object,
 * as the renderer sees it — every `$ref` is already inlined by
 * {@link dereference}, so no reference keyword appears here. We include the x-
 * extension fields we added so the generator can produce richer output (CLI flag
 * labels, icons) without hard-coding them here, plus the composition
 * (`enum`/`const`/`anyOf`/…) keywords that real-world schemas lean on. `type` is
 * optional because a property can describe itself purely through those keywords;
 * {@link displayType} fills the gap.
 *
 * Only the keywords the renderer actually reads are listed: a member here is a
 * claim that some cell is driven by it.
 */
type SchemaProperty = {
  readonly type?: string | readonly string[]
  readonly description?: string
  readonly default?: unknown
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly examples?: readonly unknown[]
  readonly required?: readonly string[]
  readonly properties?: Readonly<Record<string, SchemaProperty>>
  readonly items?: SchemaProperty | readonly SchemaProperty[]
  readonly anyOf?: readonly SchemaProperty[]
  readonly oneOf?: readonly SchemaProperty[]
  readonly allOf?: readonly SchemaProperty[]
  readonly 'x-cli-flag'?: string
  readonly 'x-icon'?: string
}

/**
 * The top-level structure of our config.schema.json file, again as the renderer
 * sees it: `$defs` has already been inlined into the properties that referenced
 * it, so the root is just the required list and the properties to render.
 */
type ConfigSchema = {
  readonly required?: readonly string[]
  readonly properties?: Readonly<Record<string, SchemaProperty>>
}

/**
 * Which optional columns to render. A column is only shown when at least one
 * property somewhere in the schema would put content in it, so a table never
 * carries a column that is empty for every row. The set is computed once for the
 * whole schema and shared by the main table and every nested table so all tables
 * keep the same shape (and the detail row's `colspan` stays correct).
 */
type Columns = {
  readonly cliFlag: boolean
  readonly type: boolean
  readonly required: boolean
  readonly default: boolean
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Decodes one JSON pointer segment: percent-decodes it (the pointer arrives as a
 * URI fragment, so `#/$defs/a%20b` addresses the definition named `a b`), then
 * unescapes `~1` → `/` and `~0` → `~` per RFC 6901. An invalid percent-escape is
 * left as written rather than throwing.
 */
const decodeSegment = (segment: string): string => {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // Not a valid escape sequence, so the segment already reads as itself.
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
}

/**
 * Follows a JSON pointer (the fragment after `#/`, e.g. `$defs/server`) from the
 * document root. Returns `undefined` when the pointer can't be resolved so a
 * broken `$ref` degrades gracefully instead of throwing.
 *
 * Arrays are stepped into as well as objects. `#/$defs/timeout/anyOf/0` is an
 * ordinary pointer that real schemas write; refusing to index an array left the
 * referring property documented as a bare name with no type and no description.
 *
 * Only *own* properties are addressable. A bare `current[segment]` read let
 * `#/constructor` resolve to `Object`'s constructor, and — on a process where
 * anything had polluted `Object.prototype` — let an arbitrary `#/<name>` resolve
 * to the injected value instead of being reported as unresolvable.
 */
const resolvePointer = (root: Record<string, unknown>, ref: string): unknown => {
  if (!ref.startsWith('#/')) return undefined
  const segments = ref.slice(2).split('/').map(decodeSegment)
  let current: unknown = root
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    // `Number` on an array index, so `length` and other non-index names miss.
    const key = Array.isArray(current) ? Number(segment) : segment
    if (!Object.hasOwn(current, key)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Assigns an own property. Plain assignment sets the prototype for a key named
 * `__proto__`, so a property with that name silently vanished from the README —
 * `JSON.parse` can produce it even though a JS object literal cannot.
 */
const defineOwn = (target: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/**
 * Keywords whose value is *data* rather than a subschema. A `{"$ref": …}` sitting
 * in one of these is a documented config value that happens to be `$ref`-shaped,
 * not a reference to follow — inlining it would replace the value the reader is
 * supposed to copy with the definition it collided with.
 *
 * Kept in step by hand with `@amritk/helpers`' `DATA_KEYWORDS`: this package
 * takes no `@amritk/*` dependency by design, so the set is restated rather
 * than imported. `example` is OpenAPI 3.0's singular spelling and belongs with
 * `examples`.
 */
const DATA_KEYWORDS: ReadonlySet<string> = new Set(['default', 'const', 'enum', 'examples', 'example'])

/**
 * Keywords holding a *map of name → subschema*. Their keys are author-chosen
 * names, so a property legitimately called `default` must not be mistaken for the
 * `default` keyword — the entries are stepped into as schemas without consulting
 * {@link DATA_KEYWORDS}.
 */
const SCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  'dependentSchemas',
  '$defs',
  'definitions',
  'dependencies',
])

/**
 * How many schema nodes the inlined document may contain. Inlining is a tree
 * expansion, so a definition reused twice at each of D nesting levels expands to
 * 2^D nodes: a 3 KB schema nested 22 deep never finished, and one nested 16 deep
 * quietly wrote a 29 MB README. Neither outcome is a document anyone can read,
 * so the walk stops and says why.
 *
 * Real config schemas are three orders of magnitude under this — the two in this
 * repo hold 41 and 7 nodes — so the budget only ever fires on an expansion that
 * has already gone wrong.
 */
const MAX_INLINED_NODES = 100_000

/**
 * The remaining node allowance for one {@link dereference} walk. Mutable because
 * the budget is shared across every branch of the expansion — the cost that
 * matters is the total size of the inlined document, not the depth of any one
 * path through it.
 */
type Budget = { remaining: number }

/**
 * Inlines every `$ref` in the schema by resolving it against the document root
 * (typically into `$defs`) and recursing into the result. Sibling keywords on a
 * `$ref` node — most commonly `description` — win over the referenced target, as
 * JSON Schema 2020-12 allows. A `seen` set of pointers along the current branch
 * breaks recursive definitions: the second time a ref is encountered it collapses
 * to a bare object stub so generation always terminates.
 *
 * Recursion is keyword-aware so it only follows refs in schema positions: the
 * values under {@link DATA_KEYWORDS} are copied through untouched, and the
 * name → schema maps in {@link SCHEMA_MAP_KEYWORDS} are stepped over so an
 * author's property named `default` is still treated as a schema.
 *
 * Terminating is not the same as finishing in a size anyone wants: a definition
 * reused at several levels of nesting is acyclic and still expands
 * exponentially, so the shared {@link Budget} caps the whole walk at
 * {@link MAX_INLINED_NODES} and throws when it runs out.
 */
const dereference = (
  node: unknown,
  root: Record<string, unknown>,
  seen: ReadonlySet<string>,
  budget: Budget,
): unknown => {
  if (Array.isArray(node)) return node.map((item) => dereference(item, root, seen, budget))
  if (!isObject(node)) return node
  if (budget.remaining-- <= 0) {
    throw new Error(
      `Inlining the schema's $refs produced more than ${MAX_INLINED_NODES} nodes. A definition reused at several ` +
        'levels of nesting expands exponentially — flatten the $defs or reduce how deeply they nest.',
    )
  }

  const { $ref: ref, ...siblings } = node
  if (typeof ref === 'string') {
    if (seen.has(ref)) {
      // Recursive reference: stop here, keeping any description from the ref site.
      return { type: 'object', ...(dereference(siblings, root, seen, budget) as object) }
    }
    const target = dereference(resolvePointer(root, ref), root, new Set(seen).add(ref), budget)
    return { ...(isObject(target) ? target : {}), ...(dereference(siblings, root, seen, budget) as object) }
  }

  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (DATA_KEYWORDS.has(key)) resolved[key] = value
    else if (SCHEMA_MAP_KEYWORDS.has(key) && isObject(value)) {
      const entries: Record<string, unknown> = {}
      for (const [name, child] of Object.entries(value))
        defineOwn(entries, name, dereference(child, root, seen, budget))
      resolved[key] = entries
    } else defineOwn(resolved, key, dereference(value, root, seen, budget))
  }
  return resolved
}

/** Maps a JSON value to the JSON Schema type name that best describes it. */
const jsonTypeOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Joins type names into a `a | b` union, dropping blanks and duplicates. */
const unionOf = (parts: readonly string[]): string => [...new Set(parts.filter((part) => part.length > 0))].join(' | ')

/**
 * Derives the type label to show for a property. Prefers the declared `type`
 * (string or `["string","null"]` union) and otherwise infers one from the
 * composition keywords real schemas use instead — `enum`, `const`, and
 * `anyOf`/`oneOf`/`allOf` — falling back to `object`/`array` when the shape is
 * implied by `properties`/`items`. Returns an empty string when nothing applies.
 */
const displayType = (prop: SchemaProperty): string => {
  if (typeof prop.type === 'string') return prop.type
  if (Array.isArray(prop.type)) return unionOf(prop.type.filter((entry): entry is string => typeof entry === 'string'))
  if (asArray(prop.enum).length > 0) return unionOf(asArray(prop.enum).map(jsonTypeOf))
  if (prop.const !== undefined) return jsonTypeOf(prop.const)
  // A declared `type` is shown verbatim, so `["string","null"]` keeps its `null`;
  // an *inferred* label drops it, because the branch that exists only to allow
  // null (`anyOf: [{$ref: …}, {type: "null"}]`) is noise next to the real shape.
  for (const variants of [prop.anyOf, prop.oneOf, prop.allOf]) {
    const union = unionOf(
      asArray(variants)
        .map((variant) => displayType(asSchema(variant)))
        .filter((type) => type !== 'null'),
    )
    if (union.length > 0) return union
  }
  if (prop.properties) return 'object'
  if (prop.items !== undefined) return 'array'
  return ''
}

/**
 * Collapses line endings to a single space. CommonMark counts a bare CR as a
 * line ending, so both are collapsed rather than just `\n`.
 *
 * Every piece of schema text needs this before it reaches the output, for two
 * different reasons: inside the `<table>` a line ending ends the HTML block
 * mid-row, and inside the `####` heading it escapes the code span and lets the
 * rest of the name open a fence, a heading, a list, or a raw HTML block.
 */
const collapseLineEndings = (value: string): string => value.replace(/[\r\n]+/g, ' ')

/**
 * Wraps text in a markdown code span that cannot be escaped from.
 *
 * A fixed single-backtick delimiter is not enough: a backtick *in the text*
 * closes the span, and the remainder lands in ordinary inline context where raw
 * HTML, links and emphasis are all live. CommonMark's rule is that a span is
 * delimited by a backtick run longer than any run inside it, and that one
 * leading and trailing space is stripped — so pad when the text would otherwise
 * begin or end with a backtick, or when its own edge spaces need preserving.
 */
const codeSpan = (text: string): string => {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
  const fence = '`'.repeat(longest + 1)
  // The strip only fires when the content is not entirely spaces, so padding an
  // all-spaces name just makes it two spaces wider.
  const needsPad = text === '' || (/^[`\s]|[`\s]$/.test(text) && !/^ *$/.test(text))
  const pad = needsPad ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

/**
 * Escapes the HTML-significant characters so schema text (and CLI flags such as
 * `--schema <path>`) renders literally inside the HTML table cells, and collapses
 * the line endings that would end the surrounding `<table>` block mid-row.
 */
const escapeHtml = (value: string): string =>
  collapseLineEndings(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Formats a JSON value for inline display inside an HTML table cell. Strings get
 * quoted so readers know they need quotes in their config.
 *
 * Strings go through `JSON.stringify` rather than being wrapped in literal quotes
 * so control characters are escaped: a raw newline reaching the cell would end the
 * `<table>`'s HTML block mid-row, and every tag after it renders as literal text.
 */
const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  // `Number.isFinite` guards the one case where interpolation and
  // `JSON.stringify` disagree: 1e400 would be documented as `Infinity`, telling
  // the reader to type something their JSON parser rejects.
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
    return `<code>${value}</code>`
  }
  return `<code>${escapeHtml(JSON.stringify(value))}</code>`
}

/**
 * Renders a comma-separated list of JSON values (used for `enum` and
 * `examples`), reusing {@link formatValue} so each entry is quoted and escaped
 * the same way a default is. `null` renders as `null` instead of the blank a
 * default uses — it is a listed value in its own right, and dropping it would
 * both contradict the Type column and leave a dangling separator.
 */
const formatList = (values: readonly unknown[] | undefined): string =>
  asArray(values)
    .map((value) => (value === null ? '<code>null</code>' : formatValue(value)))
    .join(', ')

/**
 * Builds the content of the full-width row beneath a property's metadata. It
 * always leads with the first paragraph of the description and then appends the
 * allowed values (`enum`) and sample values (`examples`) when the schema
 * provides them, so readers see the constraints the metadata columns can't hold.
 */
const renderDetailCell = (prop: SchemaProperty): string => {
  // First paragraph gives enough context without making the table unwieldy
  const desc = escapeHtml(
    asText(prop.description)
      // Normalise first, then split. Spelling the alternation inline —
      // `(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)` — lets the engine backtrack the
      // first group to a bare `\r` and hand the `\n` to the second, so a single
      // CRLF matched and everything after the first line break was dropped.
      .replace(/\r\n?/g, '\n')
      .split(/\n[ \t]*\n/)[0] ?? '',
  )
  const lines = [desc]
  if (asArray(prop.enum).length > 0) lines.push(`<strong>Allowed:</strong> ${formatList(prop.enum)}`)
  if (asArray(prop.examples).length > 0) lines.push(`<strong>Examples:</strong> ${formatList(prop.examples)}`)
  return lines.filter((line) => line.length > 0).join('<br>')
}

/**
 * True when any property in the tree (including nested object properties)
 * satisfies the predicate. Used to decide whether an optional column has any
 * content to show across the whole schema.
 */
const anyProperty = (properties: unknown, predicate: (prop: SchemaProperty) => boolean): boolean =>
  Object.values(asProperties(properties)).some((entry) => {
    const prop = asSchema(entry)
    return predicate(prop) || anyProperty(prop.properties, predicate)
  })

/**
 * Reads an `x-` extension that is declared as a string. The schema is parsed
 * JSON, not validated, so the declared type is a hope rather than a guarantee —
 * a number here would otherwise reach {@link escapeHtml} and throw a bare
 * `TypeError` naming neither the property nor the file.
 */
const stringExtension = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/**
 * The array-valued keywords, defensively. Same rationale as
 * {@link stringExtension}: the schema is parsed, never validated, so `enum: "abc"`
 * or `required: 5` would otherwise reach `.map` / `new Set` and throw a bare
 * `TypeError` naming neither the property nor the file.
 */
const asArray = <T>(value: readonly T[] | undefined): readonly T[] => (Array.isArray(value) ? value : [])

/**
 * A schema node, defensively. `asArray` guards the container but not its
 * members, so `anyOf: [null]` and `properties: {a: null}` still reached a
 * property read on `null`.
 */
const asSchema = (value: unknown): SchemaProperty => (isObject(value) ? (value as SchemaProperty) : {})

/**
 * A name → schema map, defensively. Every walk over `properties` reaches it
 * through here so they agree on what counts as a property: `Object.entries` on a
 * string spells its characters, so `properties: "ab"` rendered two rows named
 * `0` and `1` in the table while the column scan saw nothing to put in them.
 */
const asProperties = (value: unknown): Readonly<Record<string, SchemaProperty>> =>
  isObject(value) ? (value as Readonly<Record<string, SchemaProperty>>) : {}

/** The `description` keyword, defensively. See {@link asArray}. */
const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * True when the schema (or any nested object) marks at least one *rendered*
 * property as required. Required-ness lives on the parent's `required` array
 * rather than on the property itself, so this walks the `required`/`properties`
 * pairs directly.
 *
 * A name is only counted when `properties` declares it, because that is what
 * `renderRow` ticks. Taking any non-empty `required` array gave a schema whose
 * list names a property it does not declare — a typo, or a name left behind by
 * an edit — a Required column that stayed blank on every row, precisely the
 * empty column this scan exists to suppress.
 */
const anyRequired = (input: unknown): boolean => {
  const { properties, required } = asSchema(input)
  if (!isObject(properties)) return false
  const names = new Set(asArray(required))
  if (Object.keys(properties).some((name) => names.has(name))) return true
  return Object.values(properties).some(anyRequired)
}

/**
 * Decides which optional columns to render by scanning the whole schema once.
 * A column is included only when something would fill it, so empty columns
 * (e.g. CLI flags or defaults the schema never uses) disappear entirely.
 */
const resolveColumns = (schema: ConfigSchema): Columns => ({
  // Truthiness, matching what `renderRow` will actually put in the cell: keying
  // off `!== undefined` gave `"x-cli-flag": ""` a column that stayed blank on
  // every row — precisely the empty column this scan exists to suppress.
  cliFlag: anyProperty(schema.properties, (prop) => stringExtension(prop['x-cli-flag']) !== undefined),
  type: anyProperty(schema.properties, (prop) => displayType(prop).length > 0),
  required: anyRequired(schema),
  default: anyProperty(schema.properties, (prop) => prop.default !== undefined && prop.default !== null),
})

/** The number of rendered columns, used for the full-width detail row's colspan. */
const columnCount = (columns: Columns): number =>
  1 + Number(columns.cliFlag) + Number(columns.type) + Number(columns.required) + Number(columns.default)

/**
 * Header row shared by the main table and every nested detail table. The
 * description has no header of its own — it lives in a full-width row under each
 * property's metadata. Only the columns selected in {@link Columns} are emitted.
 */
const renderTableHead = (columns: Columns): string => {
  const headers = ['<th>Property</th>']
  if (columns.cliFlag) headers.push('<th>CLI Flag</th>')
  if (columns.type) headers.push('<th>Type</th>')
  if (columns.required) headers.push('<th align="center">Required</th>')
  if (columns.default) headers.push('<th align="center">Default</th>')
  return ['<thead>', '<tr>', ...headers, '</tr>', '</thead>'].join('\n')
}

/**
 * Builds an anchor id for an object property's detail table from its dotted path
 * (e.g. `server.tls` → `config-server-tls`). Explicit ids keep the in-table links
 * working regardless of how the host renderer slugifies headings.
 *
 * Every character outside `[A-Za-z0-9_-]` collapses to `-`, so the id is always
 * safe to drop into an unquoted-by-accident HTML attribute: a property named
 * `a"b` used to emit `id="config-a"b"`, terminating the attribute early.
 * Collapsing is lossy, which is why {@link buildAnchorIds} — not this function —
 * is what callers use; it resolves the collisions the collapse creates.
 */
const anchorId = (path: string): string => `config-${path.replace(/[^A-Za-z0-9_-]/g, '-')}`

/**
 * A property that gets a detail table of its own: an object that actually
 * declares fields. Narrowing rather than returning a plain boolean is what lets
 * the callers use `prop.properties` without a second, redundant guard to satisfy
 * the compiler.
 */
const isObjectWithProperties = (
  prop: SchemaProperty,
): prop is SchemaProperty & { readonly properties: Readonly<Record<string, SchemaProperty>> } =>
  isObject(prop.properties) && Object.keys(prop.properties).length > 0

/**
 * Identifies a node by its path *segments* rather than the dotted path they
 * render as. The dotted form is ambiguous — a root property literally named
 * `a.b` and `b` nested under `a` both display as `a.b` — so using it as a key
 * made the two nodes share one entry.
 */
const anchorKey = (segments: readonly string[]): string => JSON.stringify(segments)

/** Every node that will get its own detail table, in render order. */
const objectPaths = (properties: unknown, segments: readonly string[]): (readonly string[])[] =>
  Object.entries(asProperties(properties)).flatMap(([name, entry]) => {
    const prop = asSchema(entry)
    if (!isObjectWithProperties(prop)) return []
    const child = [...segments, name]
    return [child, ...objectPaths(prop.properties, child)]
  })

/**
 * Assigns each detail table a unique anchor id up front, so a row's link and the
 * table it points at agree without either having to see the other.
 *
 * {@link anchorId} is not injective — both nodes above collapse to
 * `config-a-b`, as does a property named `a"b` — and duplicate ids meant one of
 * the colliding tables was simply unreachable, every link landing on whichever
 * came first. Collisions get a `-2`, `-3`, … suffix in render order.
 */
const buildAnchorIds = (properties: unknown): ReadonlyMap<string, string> => {
  const used = new Set<string>()
  const ids = new Map<string, string>()
  for (const segments of objectPaths(properties, [])) {
    const base = anchorId(segments.join('.'))
    let id = base
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`
    used.add(id)
    ids.set(anchorKey(segments), id)
  }
  return ids
}

/**
 * Renders a property as two table rows: a metadata row (name, optional flag,
 * type, required, default) and a full-width detail row beneath it carrying the
 * description plus any allowed values (`enum`) and sample values (`examples`).
 * Icons and CLI flags are shown only when the property declares them — there is
 * no placeholder, and columns the schema never uses are omitted entirely. Object
 * properties with nested fields link to their own detail table rendered below.
 */
const renderRow = (
  name: string,
  prop: SchemaProperty,
  required: ReadonlySet<string>,
  segments: readonly string[],
  columns: Columns,
  anchors: ReadonlyMap<string, string>,
): string => {
  const code = `<code>${escapeHtml(name)}</code>`
  const anchor = anchors.get(anchorKey(segments))
  const label = isObjectWithProperties(prop) && anchor ? `<a href="#${anchor}">${code}</a>` : code
  // `x-icon` is schema-controlled text like every other field, so it must be
  // escaped before interpolation — otherwise an icon value containing HTML
  // (`<`, `&`) injects raw markup into the table.
  const icon = stringExtension(prop['x-icon'])
  const nameCell = icon ? `${escapeHtml(icon)} ${label}` : label

  const cliFlag = stringExtension(prop['x-cli-flag'])
  const cells = [`<td>${nameCell}</td>`]
  if (columns.cliFlag) cells.push(`<td>${cliFlag ? `<code>${escapeHtml(cliFlag)}</code>` : ''}</td>`)
  if (columns.type) {
    const type = displayType(prop)
    cells.push(`<td>${type ? `<code>${escapeHtml(type)}</code>` : ''}</td>`)
  }
  if (columns.required) cells.push(`<td align="center">${required.has(name) ? '✅' : ''}</td>`)
  if (columns.default) cells.push(`<td align="center">${prop.default != null ? formatValue(prop.default) : ''}</td>`)

  return [
    '<tr>',
    ...cells,
    '</tr>',
    '<tr>',
    `<td colspan="${columnCount(columns)}">${renderDetailCell(prop)}</td>`,
    '</tr>',
  ].join('\n')
}

/**
 * Renders the table for one object's properties followed by a detail table for
 * each nested object property (recursively). The root call passes an empty path
 * and omits a heading; nested calls add an anchored heading so parent rows can
 * link straight to the relevant table.
 */
const renderTables = (
  properties: unknown,
  required: ReadonlySet<string>,
  segments: readonly string[],
  columns: Columns,
  anchors: ReadonlyMap<string, string>,
): readonly string[] => {
  const entries = Object.entries(asProperties(properties))
  const rows = entries.map(([name, prop]) =>
    renderRow(name, asSchema(prop), required, [...segments, name], columns, anchors),
  )
  const table = ['<table>', renderTableHead(columns), '<tbody>', ...rows, '</tbody>', '</table>'].join('\n')
  const path = segments.join('.')
  // The heading is the one place a property name reaches the output outside a
  // `<td>`, and it is markdown rather than HTML — so it is contained by
  // `codeSpan` (whose content is literal) plus `collapseLineEndings`, not by
  // `escapeHtml`, which would display `&lt;` where the name says `<`. What a
  // code span cannot contain — a splice marker — the guard in `generateMarkdown`
  // catches instead, by refusing to write.
  const block = segments.length
    ? `<a id="${anchors.get(anchorKey(segments)) ?? anchorId(path)}"></a>\n#### ${codeSpan(collapseLineEndings(path))}\n\n${table}`
    : table

  const nested = entries.flatMap(([name, entry]) => {
    const prop = asSchema(entry)
    if (!isObjectWithProperties(prop)) return []
    return renderTables(prop.properties, new Set(asArray(prop.required)), [...segments, name], columns, anchors)
  })

  return [block, ...nested]
}

/**
 * Renders the config reference: a main properties table plus a linked detail
 * table for every nested object property. Descriptions use the first paragraph
 * from the schema so each table stays readable without losing context.
 */
const renderConfigTable = (input: ConfigSchema): string => {
  // A schema file holding `null` parses fine and reached `schema.required`.
  const schema = (isObject(input) ? input : {}) as ConfigSchema
  const required = new Set(asArray(schema.required))
  const columns = resolveColumns(schema)
  const anchors = buildAnchorIds(schema.properties)
  return renderTables(schema.properties, required, [], columns, anchors).join('\n\n')
}

const START_MARKER = '<!-- config-table-start -->'
const END_MARKER = '<!-- config-table-end -->'

/**
 * Generates the properties table from the JSON Schema and writes it to README.md.
 * Every user-facing description comes from the schema so the two stay in sync —
 * update the schema, then run `bun run generate-readme`.
 *
 * If README.md already exists and contains <!-- config-table-start --> and
 * <!-- config-table-end --> markers, only the content between those markers is
 * replaced. If it exists but is missing one or both markers we refuse to write
 * rather than destroy hand-written content. When no README exists yet the table
 * is written on its own.
 *
 * @example
 * ```ts
 * // Takes NO arguments and does its own file I/O: it reads ./config.schema.json
 * // from process.cwd() and writes ./README.md. Run it from the package directory.
 * await generateMarkdown()
 * ```
 */
export const generateMarkdown = async (): Promise<void> => {
  const root = process.cwd()

  const schemaPath = resolve(root, 'config.schema.json')
  const schemaRaw = await readFile(schemaPath, 'utf-8')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(schemaRaw) as Record<string, unknown>
  } catch (error) {
    // `JSON.parse` reports an offset and nothing else. The repo runs this from
    // several package directories in one command, so the offset alone does not
    // say which schema is malformed.
    throw new Error(`${schemaPath} is not valid JSON: ${(error as Error).message}`, { cause: error })
  }
  // Inline every $ref against the document's own $defs before rendering.
  const schema = dereference(parsed, parsed, new Set(), { remaining: MAX_INLINED_NODES }) as ConfigSchema

  const table = renderConfigTable(schema)
  const readmePath = resolve(root, 'README.md')

  let existing: string | undefined
  try {
    existing = await readFile(readmePath, 'utf-8')
  } catch (error) {
    // Only a missing README means "safe to create one". Swallowing every read
    // error let an existing-but-unreadable README (EACCES, EISDIR) be replaced
    // wholesale by the bootstrap path — the opposite of this module's documented
    // refusal to overwrite hand-written content.
    // Keyed on `code` being set: a filesystem failure that is not ENOENT must
    // not be mistaken for "no README yet". An error without a `code` is left
    // swallowed — no reachable `readFile` path produces one.
    const code = (error as NodeJS.ErrnoException)?.code
    if (code !== undefined && code !== 'ENOENT') throw error
    existing = undefined
  }

  // A marker inside the generated table would make the next run splice against
  // its own output, re-copying the region every time and growing the README
  // without bound. Nothing in a sane schema produces one, so refuse rather than
  // try to repair it.
  if (table.includes(START_MARKER) || table.includes(END_MARKER)) {
    throw new Error(
      `The generated config table contains a ${START_MARKER} / ${END_MARKER} marker, which would corrupt README.md ` +
        'on the next run. Remove the marker text from the schema (a property name, title, or description).',
    )
  }

  let content: string
  if (existing === undefined) {
    // With the markers, so a second run can splice instead of refusing.
    content = `${START_MARKER}\n${table}\n${END_MARKER}\n`
  } else {
    // Search for the end marker *after* the start marker. Taking the document's
    // first one let prose above the region ("the table ends at <!-- … -->")
    // supply it, and the resulting backwards slice duplicated the span between
    // the two indices on every run instead of replacing it.
    let startIdx = existing.indexOf(START_MARKER)
    const endIdx = startIdx === -1 ? -1 : existing.indexOf(END_MARKER, startIdx + START_MARKER.length)
    // A start marker *between* the two — one quoted in a code fence documenting
    // the markers, say — is the real opener. Taking the document's first one
    // silently deleted everything from the decoy down to the real region.
    if (startIdx !== -1 && endIdx !== -1) {
      const lastStart = existing.lastIndexOf(START_MARKER, endIdx)
      if (lastStart > startIdx) startIdx = lastStart
    }
    // Both markers present: splice the table in and keep everything else. If a
    // marker is missing, overwriting would silently wipe the existing README, so
    // fail loudly and let the user add the markers where they want the table.
    if (startIdx === -1 || endIdx === -1) {
      throw new Error(
        `README.md exists without a ${START_MARKER} … ${END_MARKER} region. ` +
          'Add both markers, in that order, where the config table should go, then re-run — refusing to overwrite ' +
          'the existing README.',
      )
    }
    content = existing.slice(0, startIdx + START_MARKER.length) + '\n' + table + '\n' + existing.slice(endIdx)
  }

  await writeFile(readmePath, content)
  console.log('README.md generated successfully.')
}
