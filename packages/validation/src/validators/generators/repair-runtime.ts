/**
 * The repairing half of the runtime every generated validator file imports from
 * `validation-result.ts`, appended to {@link VALIDATION_RESULT_CONTENT} in
 * `build-schema.ts`.
 *
 * It lives in a file of its own because it is most of that module by now, and
 * because it holds two engines that share one vocabulary:
 *
 *  - the **loop** (`runRepairLoop`): validate, repair every reported position
 *    through the `repairXAt` lookup, validate again. It works for any schema the
 *    validator can emit, because it never needs to understand one — it only
 *    reads `validateX`'s errors.
 *  - the **walk** (`runRepairWalk`): one pass that checks each position and
 *    repairs it on the spot. It is emitted only for schemas whose keywords it
 *    understands (see `repair-walkable.ts`), and it is what makes a 24 MB
 *    document a few hundred milliseconds of work instead of several full
 *    validations.
 *
 * Both ask the very same lookup what a position repairs to, so they cannot land
 * on different values.
 *
 * The text is a plain template, so it carries no backticks and no interpolation:
 * the comments quote code with single quotes instead.
 */
export const REPAIR_RUNTIME_CONTENT = `/**
 * The result of a generated repairing validator.
 *
 * 'repairs' is not a second, parallel account of what went wrong — it *is* the
 * errors the validator produced, the ones a repair was found for. So a caller
 * that logs a repair logs the same path, keyword and params it would have been
 * rejected with, and the two can never drift apart, because there is only one of
 * them.
 *
 * A document that needed no repair comes back 'valid: true' with an empty
 * 'repairs'. One that was fully repaired is 'valid: true' with a non-empty
 * 'repairs' — the caller decides whether that is acceptable by looking, rather
 * than by being told. One that could not be fully repaired is 'valid: false' and
 * carries both: the repairs that were applied, and the 'errors' still
 * outstanding against the value handed back.
 */
export type RepairResult<T> =
  | { valid: true; value: T; repairs: ValidationError[] }
  | { valid: false; value: unknown; errors: ValidationError[]; repairs: ValidationError[] }

/**
 * What a lookup answers for a position that should be removed rather than
 * replaced: an '"x-repair": "drop"' schema, or a 'false' one. A symbol, so no
 * value a document can hold is ever mistaken for it.
 */
export const REPAIR_DROP: unique symbol = Symbol('mjst.repair.drop')

/**
 * Builds the value a position repairs to. Called once per repair, so no two
 * repaired positions ever share an object.
 *
 * 'depth' is how many required levels have been filled above this one: a
 * missing required object is built with its own required children in one step,
 * and the depth is what keeps a recursive definition from building forever.
 * 'into' is an object being filled already: a conditional branch adds its
 * required keys to it instead of building a separate value.
 */
export type RepairThunk = (depth: number, into?: Record<string, unknown>) => unknown

/** A lookup's answer: build a value, remove the position, or nothing to offer. */
export type RepairAnswer = RepairThunk | typeof REPAIR_DROP | null

/**
 * Looks up what the position at 'segments' repairs to, starting at
 * 'segments[index]', with 'value' the instance at the node the lookup belongs
 * to. The instance is what an 'if' is evaluated against, so a lookup under an
 * if/then/else answers from the branch the document actually takes.
 */
export type RepairLookup = (segments: readonly string[], index: number, value: unknown) => RepairAnswer

/** The segments of the position a lookup is asked about when it is the node itself. */
export const NO_SEGMENTS: readonly string[] = []

/**
 * How many required levels one repair fills. Deep enough for any document a
 * person writes by hand, and a hard stop for a definition that requires itself.
 */
export const MAX_FILL_DEPTH = 16

/**
 * How many validate-and-repair rounds the loop will run. Each round is bounded
 * further by the rule that a position is repaired at most once, so this is a
 * backstop rather than the thing doing the terminating.
 */
export const MAX_REPAIR_PASSES = 8

/** How deep a walk descends before it reports the position instead. */
const DEFAULT_MAX_DEPTH = 512

/**
 * How many containers a walk visits before it stops. Forty times what a 24 MB
 * OpenAPI document holds, so no real document comes near it — it is there for
 * an in-memory graph whose shared or cyclic subtrees fan out, which a depth cap
 * alone lets grow exponentially.
 */
const DEFAULT_MAX_WORK = 10_000_000

/**
 * What a call to 'repairX' may do to the document, and how hard it looks.
 *
 * The first three apply to every generated repairer. The rest are read by the
 * single-pass walk, which is emitted for schemas built from the keywords it
 * understands; the loop that repairs everything else ignores them.
 */
export type RepairOptions = {
  /** JSON Pointer every reported path is rooted at. Defaults to the document root, ''. */
  readonly path?: string
  /**
   * Assign and delete on the input itself instead of copying the containers a
   * repair touches. Off by default: a caller who compares the repaired document
   * against what was sent needs the original to survive.
   */
  readonly inPlace?: boolean
  /**
   * Move a scalar written in the wrong type toward the declared one before
   * repairing it ('"5"' to '5' under 'type: integer'). On by default. Off, a
   * wrong-typed value is a reported position like any other and is repaired to
   * the value the schema supplies.
   */
  readonly coerce?: boolean
  /**
   * Follow instance '$ref's at positions whose Reference schema opts in with
   * '"x-repair": "ref"', validating and repairing each target under the type of
   * the position that referenced it. On by default; it only does anything for a
   * schema that opted in.
   */
  readonly refs?: boolean
  /**
   * Pointer prefixes ('#/components/') whose targets are not walked again. Use
   * it for the parts of the document the root schema already covers. A skipped
   * target is still resolved, so a dangling '$ref' into it is still reported.
   */
  readonly skipRefs?: readonly string[]
  /**
   * Called for every opted-in '$ref', with the Reference object, its path and
   * the id of the position's type. Return 'false' to leave that one alone.
   */
  readonly onRef?: (value: Record<string, unknown>, path: string, typeId: string) => boolean | void
  /** How deep the walk descends before it reports 'maxDepth' instead. Defaults to 512. */
  readonly maxDepth?: number
  /** How many containers the walk visits before it stops with 'maxWork'. Defaults to ten million. */
  readonly maxWork?: number
  /**
   * Walk each object at most once per schema, and hand back the same result
   * every other time it is reached. Off by default, because it costs a map entry
   * per object; turn it on for in-memory graphs that share subtrees or hold
   * cycles, which a parsed JSON document never does.
   */
  readonly memo?: boolean
  /** Reject 'NaN' and the infinities where a number is declared. JSON cannot hold them. */
  readonly finite?: boolean
  /**
   * Accept only plain objects (the prototype is 'Object.prototype' or 'null')
   * where an object is declared, and remove an own '__proto__' key — the one
   * 'JSON.parse' creates and a later 'Object.assign' would turn into a prototype.
   */
  readonly plainObjects?: boolean
}

/** The own property or array element at one pointer segment, or 'undefined'. */
export const childAt = (value: unknown, segment: string): unknown => {
  if (Array.isArray(value)) {
    const index = Number(segment)
    return Number.isInteger(index) && index >= 0 ? value[index] : undefined
  }
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, segment)) {
    return (value as Record<string, unknown>)[segment]
  }
  return undefined
}

/**
 * Writes an own property. A plain assignment to '__proto__' replaces the
 * object's prototype instead, so that one key is defined rather than assigned.
 */
export const setOwn = (target: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
  } else {
    target[key] = value
  }
}

/**
 * How many keys one repair fills, across every level of it. The depth cap alone
 * bounds a definition that requires itself once, but one that requires itself
 * at three keys builds three to the sixteenth objects inside it.
 */
const MAX_FILL_KEYS = 10_000

/** What is left of {@link MAX_FILL_KEYS} for the repair being built. */
let fillBudget = MAX_FILL_KEYS

/**
 * Starts the budget for a new repair. A generated fill calls it when it is the
 * outermost one — depth zero, building rather than filling into an object.
 */
export const fillBegin = (): void => {
  fillBudget = MAX_FILL_KEYS
}

/**
 * Fills one required key of an object being built, through the lookup of the
 * node that declares it. Asking the node rather than the property is what lets a
 * key only an 'additionalProperties' schema describes, or one only a
 * conditional branch declares, be filled the same way.
 */
export const fillKey = (target: Record<string, unknown>, key: string, lookup: RepairLookup, depth: number): void => {
  if (Object.hasOwn(target, key) || fillBudget <= 0) return
  fillBudget--
  const answer = lookup([key], 0, target)
  if (typeof answer !== 'function') return
  const value = answer(depth + 1)
  if (value !== undefined) setOwn(target, key, value)
}

/** Lets a branch's answer add what it requires to an object being filled. */
export const fillInto = (target: Record<string, unknown>, answer: RepairAnswer, depth: number): void => {
  if (typeof answer === 'function') answer(depth, target)
}

/**
 * Splits a JSON Pointer into its segments, undoing the escaping
 * 'escapePointer' applied. The root pointer ('') is zero segments.
 */
export const pointerSegments = (path: string): string[] => {
  if (path === '') return []
  const segments = path.slice(1).split('/')
  for (let i = 0; i < segments.length; i++) segments[i] = unescapeSegment(segments[i] as string)
  return segments
}

/** RFC 6901 decoding: '~1' to '/' first, then '~0' to '~'. */
const unescapeSegment = (segment: string): string =>
  segment.indexOf('~') === -1 ? segment : segment.split('~1').join('/').split('~0').join('~')

/** What 'writeAt' and 'dropAt' answer when the position was not there to change. */
const NOT_APPLIED: unique symbol = Symbol('mjst.repair.not-applied')

/** True for the canonical decimal spelling of an array index. */
const isIndexSegment = (segment: string): boolean => {
  if (segment === '0') return true
  const first = segment.charCodeAt(0)
  if (!(first >= 49 && first <= 57)) return false
  for (let i = 1; i < segment.length; i++) {
    const c = segment.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/**
 * Returns 'root' with the position at 'segments' replaced by 'value'.
 *
 * Copy-on-write by default: only the containers along the way are copied, so a
 * repaired document shares everything the repair did not touch and the input
 * survives. In place, the containers are assigned to directly.
 *
 * Answers NOT_APPLIED when the path does not lead anywhere — a segment into a
 * missing or non-container parent — or when the position already holds exactly
 * that value. Neither is a failure to handle here: the parent has an error of
 * its own, and repairing *it* is what makes this position reachable.
 */
const writeAt = (
  root: unknown,
  segments: readonly string[],
  index: number,
  value: unknown,
  inPlace: boolean,
): unknown => {
  if (index === segments.length) return Object.is(root, value) ? NOT_APPLIED : value
  const head = segments[index] as string

  if (Array.isArray(root)) {
    const position = Number(head)
    // 'position === root.length' is an append, which is what padding a short
    // array is made of. Anything past that would leave a hole.
    if (!Number.isInteger(position) || position < 0 || position > root.length) return NOT_APPLIED
    if (position === root.length && index + 1 < segments.length) return NOT_APPLIED
    const next = writeAt(root[position], segments, index + 1, value, inPlace)
    if (next === NOT_APPLIED) return NOT_APPLIED
    const target = inPlace ? root : root.slice()
    target[position] = next
    return target
  }

  if (typeof root !== 'object' || root === null) return NOT_APPLIED
  const obj = root as Record<string, unknown>
  const own = Object.hasOwn(obj, head)
  // A missing key is reachable only when this is the last segment: that is the
  // 'required' repair, which is putting the key there.
  if (!own && index + 1 < segments.length) return NOT_APPLIED
  const next = writeAt(own ? obj[head] : undefined, segments, index + 1, value, inPlace)
  if (next === NOT_APPLIED) return NOT_APPLIED
  const target = inPlace ? obj : { ...obj }
  setOwn(target, head, next)
  return target
}

/** Returns 'root' without the position at 'segments', or NOT_APPLIED. */
const dropAt = (root: unknown, segments: readonly string[], index: number, inPlace: boolean): unknown => {
  const head = segments[index] as string
  const last = index === segments.length - 1

  if (Array.isArray(root)) {
    const position = Number(head)
    if (!Number.isInteger(position) || position < 0 || position >= root.length) return NOT_APPLIED
    const target = inPlace ? root : root.slice()
    if (last) {
      target.splice(position, 1)
      return target
    }
    const next = dropAt(root[position], segments, index + 1, inPlace)
    if (next === NOT_APPLIED) return NOT_APPLIED
    target[position] = next
    return target
  }

  if (typeof root !== 'object' || root === null || !Object.hasOwn(root, head)) return NOT_APPLIED
  const obj = root as Record<string, unknown>
  if (last) {
    const target = inPlace ? obj : { ...obj }
    delete target[head]
    return target
  }
  const next = dropAt(obj[head], segments, index + 1, inPlace)
  if (next === NOT_APPLIED) return NOT_APPLIED
  const target = inPlace ? obj : { ...obj }
  setOwn(target, head, next)
  return target
}

/**
 * Orders removals so that each one leaves the positions of the rest intact:
 * the later index in an array first, and a deeper position before the
 * container holding it.
 */
const compareDrops = (a: readonly string[], b: readonly string[]): number => {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    const x = a[i] as string
    const y = b[i] as string
    if (x === y) continue
    if (isIndexSegment(x) && isIndexSegment(y)) return Number(y) - Number(x)
    return x < y ? 1 : -1
  }
  return b.length - a.length
}

/**
 * The position one error is asking to have repaired, or 'null' when the error
 * is not about a position a value can be put at.
 *
 * A 'required' error is reported against the *object* that is missing the key,
 * and names the key in 'params.missingProperty', so the position to fill is one
 * segment deeper. 'minItems' is handled separately, because it is satisfied by
 * adding several values rather than by replacing one.
 */
const repairTarget = (error: ValidationError, base: string): string[] | null => {
  if (error.path.slice(0, base.length) !== base) return null
  const segments = pointerSegments(error.path.slice(base.length))
  if (error.keyword === 'required') {
    const missing = error.params['missingProperty']
    if (typeof missing !== 'string') return null
    segments.push(missing)
  }
  return segments
}

/** The value at a pointer, or 'undefined' when the path does not lead anywhere. */
const valueAt = (root: unknown, segments: readonly string[]): unknown => {
  let node = root
  for (const segment of segments) node = childAt(node, segment)
  return node
}

/**
 * Grows a short array to the length 'minItems' asks for, or NOT_APPLIED.
 *
 * One 'minItems' error is satisfied by *several* values, so the shortfall is
 * filled at once rather than an element per round, which would run out of
 * rounds on a 'minItems: 50'. Every element is a separate call to the thunk.
 */
const padToMinItems = (
  root: unknown,
  error: ValidationError,
  base: string,
  lookup: RepairLookup,
  done: Set<string>,
  inPlace: boolean,
): unknown => {
  const segments = repairTarget(error, base)
  if (segments === null) return NOT_APPLIED
  const array = valueAt(root, segments)
  const limit = error.params['limit']
  if (!Array.isArray(array) || typeof limit !== 'number' || array.length >= limit) return NOT_APPLIED

  // Keyed apart from a position repair at the same path: replacing the whole
  // array and padding it are different repairs.
  const key = segments.join('/') + '#minItems'
  if (done.has(key)) return NOT_APPLIED

  const element = lookup(segments.concat(String(array.length)), 0, root)
  if (typeof element !== 'function') return NOT_APPLIED

  const padded = inPlace ? array : array.slice()
  while (padded.length < limit) padded.push(element(0))
  done.add(key)
  return inPlace ? root : writeAt(root, segments, 0, padded, false)
}

/**
 * Applies one round of repairs: every error the schema offers a value for is
 * repaired, and the rest are handed back untouched.
 *
 * 'done' carries the positions already repaired on an earlier round. A position
 * that failed again after being repaired is not repaired a second time — the
 * value the schema offered did not satisfy the schema, which is a fact about the
 * schema, and trying again would only produce the same value.
 *
 * Removals wait for the end of the round. Removing an array element moves every
 * element after it, so taking one out while later errors still name the old
 * indices would repair the wrong positions.
 */
export const applyRepairs = (
  value: unknown,
  errors: readonly ValidationError[],
  lookup: RepairLookup,
  done: Set<string>,
  inPlace = false,
  base = '',
): { value: unknown; repaired: ValidationError[] } => {
  const repaired: ValidationError[] = []
  const drops: { segments: string[]; error: ValidationError }[] = []
  let next = value

  for (const error of errors) {
    if (error.keyword === 'minItems') {
      const padded = padToMinItems(next, error, base, lookup, done, inPlace)
      if (padded === NOT_APPLIED) continue
      next = padded
      repaired.push(error)
      continue
    }

    const target = repairTarget(error, base)
    if (target === null) continue
    const key = target.join('/')
    if (done.has(key)) continue
    const answer = lookup(target, 0, next)
    if (answer === null) continue

    if (answer === REPAIR_DROP) {
      // The root has no container to be removed from.
      if (target.length === 0) continue
      done.add(key)
      drops.push({ segments: target, error })
      continue
    }

    const updated = writeAt(next, target, 0, answer(0), inPlace)
    // An unreachable position leaves the document exactly as it was. Not
    // counting it as repaired is what lets the parent's own error report.
    if (updated === NOT_APPLIED) continue
    done.add(key)
    next = updated
    repaired.push(error)
  }

  drops.sort((a, b) => compareDrops(a.segments, b.segments))
  for (const drop of drops) {
    const updated = dropAt(next, drop.segments, 0, inPlace)
    if (updated === NOT_APPLIED) continue
    next = updated
    repaired.push(drop.error)
    // Removing an element moves every element after it, so a position repaired
    // under that array on this or an earlier round may now hold another value.
    if (Array.isArray(valueAt(next, drop.segments.slice(0, -1)))) {
      const prefix = drop.segments.slice(0, -1).join('/') + '/'
      for (const key of done) if (key.startsWith(prefix)) done.delete(key)
    }
  }

  return { value: next, repaired }
}

/**
 * The options only the walk reads. The loop refuses them rather than quietly
 * ignoring a guard the caller is relying on — 'plainObjects' to strip an own
 * '__proto__', 'maxWork' to bound a hostile document.
 */
const WALK_ONLY_OPTIONS = ['skipRefs', 'onRef', 'maxDepth', 'maxWork', 'memo', 'finite', 'plainObjects'] as const

/**
 * Writes what a copy-on-write pass changed back into the value it copied from,
 * and answers the value to carry on with: 'target' itself, unless the root was
 * replaced outright. Unchanged subtrees are shared between the two, so only the
 * containers the copy rebuilt are visited.
 */
const adopt = (target: unknown, source: unknown, depth = 0): unknown => {
  if (source === target) return target
  if (depth > DEFAULT_MAX_DEPTH) return source
  if (Array.isArray(target) && Array.isArray(source)) {
    target.length = source.length
    for (let i = 0; i < source.length; i++) target[i] = adopt(target[i], source[i], depth + 1)
    return target
  }
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  if (isRecord(target) && isRecord(source)) {
    for (const key of Object.keys(source)) setOwn(target, key, adopt(target[key], source[key], depth + 1))
    return target
  }
  return source
}

/**
 * The validate-repair-revalidate loop behind a generated 'repairX' for any
 * schema the single-pass walk does not cover.
 *
 * Coercion runs first, so anything that was only written in the wrong type is
 * already right and never counts as a repair. What is left is judged by
 * 'validateX', and *its errors* are what drive the repair: each one names a
 * position, the lookup answers with a value for it, and the error the repair
 * came from is what gets reported. Re-validating after a round catches what one
 * pass cannot see; a position is repaired at most once, so the loop terminates
 * on progress rather than on the pass cap.
 */
export const runRepairLoop = <T>(
  input: unknown,
  options: RepairOptions | string | undefined,
  validate: (value: unknown, path: string) => ValidationResult,
  lookup: RepairLookup,
  coerce: (value: unknown) => unknown,
): RepairResult<T> => {
  const settings: RepairOptions = typeof options === 'string' ? { path: options } : (options ?? {})
  for (const name of WALK_ONLY_OPTIONS) {
    const option = settings[name]
    if (option !== undefined && option !== false) {
      throw new TypeError(
        "repairX: '" + name + "' needs the single-pass repair walk, and this schema uses a keyword the walk does " +
          'not repair, so it is repaired by the validate-and-repair loop instead. Leave the option out, or remove ' +
          'the keyword.',
      )
    }
  }
  const base = settings.path ?? ''
  const inPlace = settings.inPlace === true
  let value = input
  if (settings.coerce !== false) {
    const coerced = coerce(input)
    // Coercion copies what it changes. In place, the changes are written back
    // into the input, so the caller's document is the one that gets repaired.
    value = inPlace ? adopt(input, coerced) : coerced
  }
  const repairs: ValidationError[] = []
  const done = new Set<string>()

  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    const result = validate(value, base)
    if (result === true) return { valid: true, value: value as T, repairs }

    const applied = applyRepairs(value, result.errors, lookup, done, inPlace, base)
    // Nothing moved, so nothing on a further pass would either.
    if (applied.repaired.length === 0) return { valid: false, value, errors: result.errors, repairs }
    value = applied.value
    for (const repair of applied.repaired) repairs.push(repair)
  }

  const final = validate(value, base)
  return final === true
    ? { valid: true, value: value as T, repairs }
    : { valid: false, value, errors: final.errors, repairs }
}

/**
 * One position's walk: checks the value against its schema, repairs what it
 * can, and answers the value the position should hold — the input itself when
 * nothing changed, a replacement, or REPAIR_DROP when the parent should remove
 * the position.
 */
export type RepairWalk = (value: unknown, run: RepairRun) => unknown

/** A '$ref' target waiting to be walked under the type of the position that named it. */
type RefTask = { readonly ref: string; readonly walk: RepairWalk; readonly typeId: string }

/**
 * Everything one walk shares: the options, the errors and repairs it collects,
 * and where it is.
 *
 * 'path' is the stack of segments down to the position being walked. Nothing
 * turns it into a string until a position is reported, so a valid document
 * builds no path at all. 'errors' and 'repairs' are the arrays handed back in
 * the result; every position pushes straight into them.
 */
export type RepairRun = {
  readonly base: string
  path: (string | number)[]
  /** Path length of the position the current walk started at, which has no container to be removed from. */
  anchor: number
  readonly errors: ValidationError[]
  readonly repairs: ValidationError[]
  readonly inPlace: boolean
  readonly coerce: boolean
  readonly finite: boolean
  readonly plain: boolean
  readonly maxDepth: number
  readonly maxWork: number
  work: number
  /** Above zero while a value the walk built itself is checked: report, never repair. */
  verify: number
  /** How many positions this run has changed, coercions included. */
  changed: number
  halted: boolean
  /** The document '$ref's resolve against: the input, then the repaired value. */
  root: unknown
  readonly refs: boolean
  readonly skipRefs: readonly string[]
  readonly onRef: RepairOptions['onRef']
  readonly refQueue: RefTask[]
  /**
   * The lookups of the positions whose branches are being walked, with the
   * path length of each. A branch that requires a key only its parent declares
   * fills it through the parent's lookup.
   */
  readonly scopeDepth: number[]
  readonly scopeLookup: RepairLookup[]
  /** The targets queued so far, by the type they are queued under. */
  readonly refQueued: Map<string, Set<string>>
  /**
   * In the check after a repair, the targets the repair itself queued: the check
   * walks those and no others, so a '$ref' 'onRef' declined stays declined.
   */
  readonly refAllowed: Map<string, Set<string>> | null
  readonly refWalked: Map<object, Set<string>>
  readonly refResolvable: Map<string, boolean>
  readonly memo: Map<object, Map<RepairWalk, unknown>> | null
}

/** The JSON Pointer of the position being walked, with one more segment when given. */
export const walkPath = (run: RepairRun, extra?: string): string => {
  let out = run.base
  const path = run.path
  for (let i = 0; i < path.length; i++) {
    const segment = path[i]
    out += '/' + (typeof segment === 'number' ? String(segment) : escapePointer(segment as string))
  }
  return extra === undefined ? out : out + '/' + escapePointer(extra)
}

/** One error at the position being walked. Only ever called once something is wrong. */
export const walkError = (
  run: RepairRun,
  keyword: string,
  message: string,
  params: Record<string, unknown>,
  segment?: string,
): ValidationError => ({ message, path: walkPath(run, segment), keyword, params })

/**
 * Repairs the position being walked, which failed the checks that produced
 * 'found'.
 *
 * Coercion comes first, and a value it fixes is no repair at all. Then the
 * lookup answers: a value is taken when it passes the position's own checks,
 * and a removal when the position has a container to be removed from. Anything
 * else leaves the value as it was and reports 'found' as errors.
 */
export const walkRepair = (
  run: RepairRun,
  value: unknown,
  found: readonly ValidationError[],
  lookup: RepairLookup | null,
  ok: (value: unknown, run: RepairRun) => boolean,
  types: readonly string[] | null,
): unknown => {
  if (run.verify === 0) {
    if (run.coerce && types !== null) {
      const coerced = types.length === 1 ? coerceScalar(value, types[0] as string) : coerceUnion(value, types)
      if (coerced !== value && ok(coerced, run)) {
        run.changed++
        return coerced
      }
    }
    const answer = lookup === null ? null : lookup(NO_SEGMENTS, 0, value)
    if (answer === REPAIR_DROP && run.path.length > run.anchor) {
      for (const error of found) run.repairs.push(error)
      run.changed++
      return REPAIR_DROP
    }
    if (typeof answer === 'function') {
      const next = answer(0)
      if (ok(next, run)) {
        for (const error of found) run.repairs.push(error)
        run.changed++
        return next
      }
    }
  }
  for (const error of found) run.errors.push(error)
  return value
}

/**
 * Walks a value the walk just built or coerced, reporting rather than repairing
 * what is still wrong with it. A replacement is built from the schema, so this
 * normally finds nothing; when it does, the schema could not describe a valid
 * value, and saying so beats repairing the repair.
 */
export const walkVerified = (run: RepairRun, value: unknown, walk: RepairWalk): unknown => {
  run.verify++
  const out = walk(value, run)
  run.verify--
  return out
}

/** Writes a walked child back: in place, or into the parent's copy, made on first write. */
export const walkSet = (
  run: RepairRun,
  target: Record<string, unknown>,
  owned: boolean,
  key: string,
  next: unknown,
): Record<string, unknown> => {
  const out = owned || run.inPlace ? target : { ...target }
  if (next === REPAIR_DROP) delete out[key]
  else setOwn(out, key, next)
  return out
}

/**
 * Writes a walked element back. A removal is marked in place and taken out by
 * 'walkCompact' once the loop is done, so the indices the rest of the loop
 * reports stay the document's own.
 */
export const walkSetItem = (run: RepairRun, target: unknown[], owned: boolean, index: number, next: unknown): unknown[] => {
  const out = owned || run.inPlace ? target : target.slice()
  out[index] = next
  return out
}

/** Takes the elements marked for removal out of an array the walk owns. */
export const walkCompact = (target: unknown[]): unknown[] => {
  let kept = 0
  for (let i = 0; i < target.length; i++) {
    const item = target[i]
    if (item !== REPAIR_DROP) target[kept++] = item
  }
  target.length = kept
  return target
}

/**
 * A required key that is not there. It is filled through the declaring node's
 * lookup, so a missing object arrives with its own required children already
 * in it, and the new value is checked under its schema before it is kept.
 */
export const walkMissing = (
  run: RepairRun,
  target: Record<string, unknown>,
  owned: boolean,
  key: string,
  lookup: RepairLookup | null,
  walk: RepairWalk | null,
): Record<string, unknown> => {
  const error: ValidationError = {
    message: "must have required property '" + key + "'",
    path: walkPath(run),
    keyword: 'required',
    params: { missingProperty: key },
  }
  if (run.verify === 0) {
    let answer = lookup === null ? null : lookup([key], 0, target)
    // A key a branch requires and only its parent declares: ask the parent.
    for (let i = run.scopeDepth.length - 1; typeof answer !== 'function' && i >= 0; i--) {
      if (run.scopeDepth[i] !== run.path.length) break
      answer = (run.scopeLookup[i] as RepairLookup)([key], 0, target)
    }
    if (typeof answer === 'function') {
      const value = answer(0)
      if (value !== undefined) {
        if (walk !== null) {
          run.path.push(key)
          walkVerified(run, value, walk)
          run.path.pop()
        }
        run.repairs.push(error)
        run.changed++
        const out = owned || run.inPlace ? target : { ...target }
        setOwn(out, key, value)
        return out
      }
    }
  }
  run.errors.push(error)
  return target
}

/** Puts a position's lookup in scope while its branches walk it. */
export const walkScope = (run: RepairRun, lookup: RepairLookup): void => {
  run.scopeDepth.push(run.path.length)
  run.scopeLookup.push(lookup)
}

/** Takes it out of scope again, answering the value the position holds. */
export const walkUnscope = (run: RepairRun, value: unknown): unknown => {
  run.scopeDepth.pop()
  run.scopeLookup.pop()
  return value
}

/** A key 'additionalProperties: false' does not allow: reported, and removed. */
export const walkExtra = (
  run: RepairRun,
  target: Record<string, unknown>,
  owned: boolean,
  key: string,
): Record<string, unknown> => {
  const error = walkError(
    run,
    'additionalProperties',
    'must NOT have additional properties',
    { additionalProperty: key },
    key,
  )
  if (run.verify > 0) {
    run.errors.push(error)
    return target
  }
  run.repairs.push(error)
  run.changed++
  return walkSet(run, target, owned, key, REPAIR_DROP)
}

/** True for an object a JSON parser could have produced. */
export const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** An own '__proto__' key, under 'plainObjects': reported, and removed. */
export const walkProto = (run: RepairRun, target: Record<string, unknown>, owned: boolean): Record<string, unknown> => {
  if (!Object.hasOwn(target, '__proto__')) return target
  const error = walkError(run, 'plainObject', "must NOT have an own '__proto__' property", {}, '__proto__')
  if (run.verify > 0) {
    run.errors.push(error)
    return target
  }
  run.repairs.push(error)
  run.changed++
  return walkSet(run, target, owned, '__proto__', REPAIR_DROP)
}

/**
 * The position is past 'maxDepth', or the walk is past 'maxWork'. Either way it
 * is reported and left as it is. The work budget is reported once: everything
 * after it is unwalked rather than wrong.
 */
export const walkHalt = (run: RepairRun, value: unknown): unknown => {
  if (run.work > run.maxWork) {
    if (!run.halted) {
      run.halted = true
      run.errors.push(
        walkError(run, 'maxWork', 'exceeds the work budget of ' + run.maxWork + ' containers', { limit: run.maxWork }),
      )
    }
  } else {
    run.errors.push(walkError(run, 'maxDepth', 'exceeds the maximum depth of ' + run.maxDepth, { limit: run.maxDepth }))
  }
  return value
}

/**
 * Walks an object at most once per schema under 'memo', handing back the first
 * walk's result every other time. The entry is written before the walk, so a
 * cycle meets itself and stops.
 */
export const walkMemo = (run: RepairRun, value: unknown, body: RepairWalk): unknown => {
  const memo = run.memo
  if (memo === null || typeof value !== 'object' || value === null) return body(value, run)
  let walked = memo.get(value)
  if (walked === undefined) {
    walked = new Map()
    memo.set(value, walked)
  }
  if (walked.has(body)) return walked.get(body)
  walked.set(body, value)
  const out = body(value, run)
  walked.set(body, out)
  return out
}

/** What 'resolveSegments' answers for a pointer that leads nowhere. */
const UNRESOLVED: unique symbol = Symbol('mjst.repair.unresolved')

/** Decodes one reference token: percent-escapes (it is a URI fragment), then RFC 6901. */
const decodeToken = (token: string): string => {
  let decoded = token
  if (decoded.indexOf('%') !== -1) {
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      // A malformed escape is a literal '%' in a key, not an error.
    }
  }
  return unescapeSegment(decoded)
}

/** The segments of a local '$ref' ('#/a/b'), or 'null' for one that is not a JSON Pointer. */
const refSegments = (ref: string): string[] | null => {
  if (ref.length === 1) return []
  if (ref.charCodeAt(1) !== 47) return null
  const tokens = ref.slice(2).split('/')
  for (let i = 0; i < tokens.length; i++) tokens[i] = decodeToken(tokens[i] as string)
  return tokens
}

/** Follows segments through own properties and in-range indices only. */
const resolveSegments = (root: unknown, segments: readonly string[]): unknown => {
  let node = root
  for (const segment of segments) {
    if (Array.isArray(node)) {
      if (!isIndexSegment(segment) || Number(segment) >= node.length) return UNRESOLVED
      node = node[Number(segment)]
    } else if (typeof node === 'object' && node !== null && Object.hasOwn(node, segment)) {
      node = (node as Record<string, unknown>)[segment]
    } else {
      return UNRESOLVED
    }
  }
  return node
}

/**
 * A Reference object at a position that opted in: its target is resolved
 * against the document and queued to be walked under the position's type.
 *
 * Targets wait in a queue rather than being walked here, so a chain of
 * references or a cycle between them is a loop over the queue rather than a
 * recursion, and each target is walked once per type. A target that does not
 * resolve is reported at the '$ref' that named it and never created: inventing
 * the definition would hide the mistake.
 */
export const walkRef = (run: RepairRun, value: unknown, walk: RepairWalk, typeId: string): void => {
  if (!run.refs || typeof value !== 'object' || value === null || Array.isArray(value)) return
  const holder = value as Record<string, unknown>
  if (!Object.hasOwn(holder, '$ref')) return
  const ref = holder['$ref']
  // Only a local pointer resolves inside the document; anything else is the
  // bundler's business.
  if (typeof ref !== 'string' || ref.charCodeAt(0) !== 35) return
  if (run.onRef !== undefined && run.onRef(holder, walkPath(run), typeId) === false) return
  if (run.refAllowed !== null && run.refAllowed.get(typeId)?.has(ref) !== true) return

  let resolvable = run.refResolvable.get(ref)
  if (resolvable === undefined) {
    const segments = refSegments(ref)
    resolvable = segments !== null && resolveSegments(run.root, segments) !== UNRESOLVED
    run.refResolvable.set(ref, resolvable)
  }
  if (!resolvable) {
    run.errors.push(walkError(run, 'unresolvedRef', "can't resolve reference " + ref, { ref }, '$ref'))
    return
  }

  for (const prefix of run.skipRefs) if (ref.startsWith(prefix)) return
  // Keyed by type first, so a site whose target is already queued costs two
  // lookups and builds nothing.
  let queued = run.refQueued.get(typeId)
  if (queued === undefined) {
    queued = new Set()
    run.refQueued.set(typeId, queued)
  }
  if (queued.has(ref)) return
  queued.add(ref)
  run.refQueue.push({ ref, walk, typeId })
}

/** Walks every queued '$ref' target, including the ones walking them queues. */
const walkRefTargets = (run: RepairRun): void => {
  for (let next = 0; next < run.refQueue.length && !run.halted; next++) {
    const task = run.refQueue[next] as RefTask
    const segments = refSegments(task.ref)
    if (segments === null) continue
    const target = resolveSegments(run.root, segments)
    // It resolved where it was named; a repair since then removed it.
    if (target === UNRESOLVED) continue
    if (typeof target === 'object' && target !== null) {
      let types = run.refWalked.get(target)
      if (types === undefined) {
        types = new Set()
        run.refWalked.set(target, types)
      }
      if (types.has(task.typeId)) continue
      types.add(task.typeId)
    }
    run.path = segments
    run.anchor = segments.length
    const out = task.walk(target, run)
    if (out !== target && out !== REPAIR_DROP) {
      const updated = writeAt(run.root, segments, 0, out, run.inPlace)
      if (updated !== NOT_APPLIED) run.root = updated
    }
  }
}

/** A run over 'root' with the given settings; 'verify' 1 is a check that repairs nothing. */
const createRun = (
  settings: RepairOptions,
  root: unknown,
  verify: number,
  refAllowed: Map<string, Set<string>> | null = null,
): RepairRun => ({
  base: settings.path ?? '',
  path: [],
  anchor: 0,
  errors: [],
  repairs: [],
  inPlace: settings.inPlace === true,
  coerce: settings.coerce !== false,
  finite: settings.finite === true,
  plain: settings.plainObjects === true,
  maxDepth: settings.maxDepth ?? DEFAULT_MAX_DEPTH,
  maxWork: settings.maxWork ?? DEFAULT_MAX_WORK,
  work: 0,
  verify,
  changed: 0,
  halted: false,
  root,
  refs: settings.refs !== false,
  skipRefs: settings.skipRefs ?? [],
  onRef: verify === 0 ? settings.onRef : undefined,
  refQueue: [],
  scopeDepth: [],
  scopeLookup: [],
  refQueued: new Map(),
  refAllowed,
  refWalked: new Map(),
  refResolvable: new Map(),
  memo: settings.memo === true ? new Map() : null,
})

/**
 * The single-pass repair behind a generated 'repairX' whose schema the walk
 * covers: one walk over the document that checks every position and repairs
 * the ones that fail, then one walk over each opted-in '$ref' target.
 *
 * A valid document is walked and handed back untouched: nothing is copied, no
 * path is built and no error object exists, so the only allocation is the run
 * itself.
 *
 * When anything was changed, the result is walked once more, checking only.
 * Every replacement was already checked where it was made, but a position can
 * answer to several subschemas at once — 'allOf' entries, overlapping patterns,
 * a '$ref' beside its siblings — and a repair made for one could break another.
 * 'valid: true' is a promise about the value handed back, so it is checked
 * rather than assumed; whatever that finds is reported, not repaired again.
 */
export const runRepairWalk = <T>(
  input: unknown,
  options: RepairOptions | string | undefined,
  walk: RepairWalk,
): RepairResult<T> => {
  const settings: RepairOptions = typeof options === 'string' ? { path: options } : (options ?? {})
  const run = createRun(settings, input, 0)

  const out = walk(input, run)
  run.root = out === REPAIR_DROP ? input : out
  walkRefTargets(run)
  const value = run.root
  const errors = run.errors

  if (run.changed > 0 && !run.halted) {
    const check = createRun(settings, value, 1, run.refQueued)
    walk(value, check)
    walkRefTargets(check)
    if (check.errors.length > 0) {
      const known = new Set<string>()
      for (const error of errors) known.add(error.keyword + ' ' + error.path)
      for (const error of check.errors) if (!known.has(error.keyword + ' ' + error.path)) errors.push(error)
    }
  }

  return errors.length === 0
    ? { valid: true, value: value as T, repairs: run.repairs }
    : { valid: false, value, errors, repairs: run.repairs }
}
`
