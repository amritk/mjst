/**
 * Core data model for the parser. Every node carries its absolute `[start, end)`
 * character-offset span as two inline fields so a consumer can map any value
 * back to an exact `line:column` in the source — the whole reason this package
 * exists. Storing them inline (rather than as a `range` tuple) avoids a second
 * heap allocation per node.
 */

/** Scalar styles we distinguish, because the style decides how a value resolves. */
export type ScalarStyle = 'plain' | 'single' | 'double' | 'block-literal' | 'block-folded'

/**
 * A leaf value: a string, number, boolean, or null. `value` is the resolved
 * JavaScript value; `source` is the raw text exactly as it appeared (handy for
 * diagnostics that want to quote the original).
 */
export type YamlScalar = {
  kind: 'scalar'
  value: string | number | boolean | null
  source: string
  style: ScalarStyle
  /** Inclusive start offset into the source. */
  start: number
  /** Exclusive end offset into the source. */
  end: number
  /** A `!!`-style tag if one was written, e.g. `str` for `!!str`. */
  tag?: string
  /** The `&name` anchor declared on this node, if any. */
  anchor?: string
}

/** A `*name` reference to a previously anchored node. Resolved during `toJS`. */
export type YamlAlias = {
  kind: 'alias'
  /** The anchor name this alias points at (without the leading `*`). */
  source: string
  start: number
  end: number
}

/** One `key: value` entry of a block or flow mapping. */
export type YamlPair = {
  kind: 'pair'
  key: YamlNode
  /** `null` when a key is written with no value, e.g. `paths:` on its own line. */
  value: YamlNode | null
  start: number
  end: number
}

/** A mapping — an ordered list of key/value pairs. */
export type YamlMap = {
  kind: 'map'
  items: YamlPair[]
  start: number
  end: number
  tag?: string
  anchor?: string
}

/** A sequence — an ordered list of nodes. */
export type YamlSeq = {
  kind: 'seq'
  items: YamlNode[]
  start: number
  end: number
  tag?: string
  anchor?: string
}

export type YamlNode = YamlScalar | YamlAlias | YamlMap | YamlSeq

/** Severity for collected problems. Errors mean the data may be wrong; warnings are advisory. */
export type YamlErrorKind = 'error' | 'warning'

/**
 * A parse problem with an exact source span. `start`/`end` are `[start, end)`
 * offsets; pair them with {@link import('./line-counter').lineCounter} for
 * `line:column`.
 */
export type YamlError = {
  kind: YamlErrorKind
  /** Short stable code, e.g. `DUPLICATE_KEY`, so callers can branch without string-matching. */
  code: string
  message: string
  start: number
  end: number
}

/** A parsed document: the node tree, any problems, and a lazy `toJS` projection. */
export type YamlDocument = {
  /** Root node, or `null` for an empty document. */
  contents: YamlNode | null
  errors: YamlError[]
  warnings: YamlError[]
  /** Materializes the plain JavaScript value, resolving aliases and merge keys. */
  toJS: () => unknown
}

export type ParseOptions = {
  /**
   * Report duplicate mapping keys. Default `true`. Set `false` to allow them
   * (the last value wins, matching `JSON.parse` semantics).
   */
  uniqueKeys?: boolean
  /**
   * Honor the `<<` merge key (YAML merge spec). Default `true`. When off, `<<`
   * is treated as an ordinary key.
   */
  merge?: boolean
}
