import { describe, expect, it } from 'vitest'
import { assert } from '@/assert'
import { hasUnsafeRegex, isValidationLimitError } from '@/interpreter/limits'
import { validate } from '@/validate'
import { validateGuard } from '@/validate-guard'

/**
 * Builds a value nested `depth` arrays deep, bottoming out at `[]` so every
 * level is an array — valid against `{ type: 'array', items: { $ref: '#' } }`
 * (a value that bottoms out at a non-array would be legitimately invalid).
 */
const nest = (depth: number): unknown => {
  let value: unknown = []
  for (let i = 0; i < depth; i++) value = [value]
  return value
}

/** Builds an `anyOf` tree nested `depth` deep — `2^depth` branch evaluations against one value. */
const nestedAnyOf = (depth: number): unknown => {
  let schema: unknown = { type: 'string' }
  for (let i = 0; i < depth; i++) schema = { anyOf: [schema, schema] }
  return schema
}

/** Wraps `leaf` in `depth` levels of `{ not: … }` — a schema deep enough to overflow a recursive walk. */
const nestedSchema = (depth: number, leaf: unknown = { type: 'string' }): unknown => {
  let schema = leaf
  for (let i = 0; i < depth; i++) schema = { not: schema }
  return schema
}

describe('limits', () => {
  it('flags nested unbounded quantifiers as unsafe and leaves ordinary patterns alone', () => {
    for (const unsafe of ['(a+)+', '(a*)*', '(a+)*', '(\\d+)+$', '([a-z]+)+', '((a+))+']) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    for (const safe of ['a+', '[a-z]+', '(abc)+', '^\\d{1,3}$', '(a|b)+', 'a+b+c+', '\\w+@\\w+', '.*']) {
      expect(hasUnsafeRegex(safe), safe).toBe(false)
    }
  })

  it('refuses to build a validator from a schema with a catastrophic pattern', () => {
    expect(() => validate({ type: 'string', pattern: '(a+)+$' })).toThrow(/catastrophic backtracking|ReDoS/i)
    expect(() => validateGuard({ type: 'object', patternProperties: { '(a+)+': { type: 'string' } } })).toThrow(
      /ReDoS|backtracking/i,
    )
    // Nested inside a subschema is still found.
    expect(() => validate({ properties: { name: { pattern: '(x*)*' } } })).toThrow()
  })

  it('screens the patterns in a registered document too', () => {
    // A document the caller loaded from elsewhere is a schema this validator will
    // really run, so it gets the same up-front screen as the one under validation.
    expect(() =>
      validate(
        { $ref: 'https://example.com/lib.json' },
        { schemas: { 'https://example.com/lib.json': { pattern: '(a+)+$' } } },
      ),
    ).toThrow(/catastrophic backtracking|ReDoS/i)
  })

  it('lets an unsafe pattern through when explicitly opted in', () => {
    const validator = validate({ type: 'string', pattern: '(a+)+$' }, { limits: { allowUnsafePatterns: true } })
    expect(validator('aaaa')).toBe(true)
  })

  it('flags an ambiguous alternation repeated by an unbounded quantifier', () => {
    // Star height 1, so the nested-quantifier rule misses these entirely — yet
    // `/^(a|a)+$/.test('a'.repeat(28) + '!')` takes well over a second, doubling
    // with each added character. Two branches that provably match the same single
    // character give an n-character input 2^n parses.
    for (const unsafe of ['^(a|a)+$', '(a|[a-z])+', '(x|\\w)*', '(\\.|.)+', '(ab|ab)+', '(5|\\d){1,}']) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    // A bounded quantifier caps the blow-up (2^10 parses), so it is not flagged.
    expect(hasUnsafeRegex('(a|a){1,10}')).toBe(false)
    // Documenting the gap, not endorsing it: the screen only proves ambiguity when
    // one branch is a single literal character, so two overlapping *classes* get
    // through even though they are genuinely exponential. See the module comment.
    expect(hasUnsafeRegex('([0-9]|\\d)+')).toBe(false)
  })

  it('leaves unambiguous alternations alone, including ones sharing a first character', () => {
    // `(ab|ac)+` shares a first character but is linear — the branches diverge
    // before the group can repeat — so a first-character overlap test would be a
    // false positive here. We only flag provable single-character ambiguity.
    for (const safe of [
      '^(ab|ac)+$',
      '^(https?|ftp)://',
      '^(GET|POST|PUT|DELETE)$',
      '^(\\+|-)?\\d+(\\.\\d+)?$',
      '^(a|b|c)+$',
      '(foo|bar)*',
    ]) {
      expect(hasUnsafeRegex(safe), safe).toBe(false)
    }
  })

  it('admits a separator-anchored repetition, whose split no input can vary', () => {
    // Star height 2, and linear anyway: every repetition has to begin (or end)
    // with a character the body cannot otherwise produce, so the positions of
    // that character are the word boundaries and there is no second way to
    // split the input. The first two are the AsyncAPI meta-schemas' own; both
    // had to be hand-rewritten before the screen would load them.
    for (const safe of [
      '^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$',
      '^\\$message\\.(header|payload)#(\\/(([^\\/~])|(~[01]))*)*',
      '(\\.a*)*',
      '(/[^/]*)*',
      '(-\\w+)*',
      '(:\\d+)*',
      '(\\.a*)+',
      '(\\.a*){2,}',
      // The separator-last spelling of the same idea.
      '^(\\w+\\.)*\\w+$',
      '^([a-z0-9]+-)*[a-z0-9]+$',
    ]) {
      expect(hasUnsafeRegex(safe), safe).toBe(false)
    }
  })

  it('keeps flagging a repetition whose body can produce its own separator', () => {
    // The exemption above turns entirely on "no other atom can make that
    // character". Each of these puts the separator back within the body's reach
    // — `\W`, `.` and `[^a]` all match a dot; the second dot in `\.a*\.b*` is
    // literal — so the split stops being forced and the pattern goes back to
    // being read as nested repetition.
    for (const unsafe of ['(\\.\\W*)*', '(\\..*)*', '(\\.[^a]*)*', '(\\.a*\\.b*)*', '^(\\w+a)*\\w+$']) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    // A separator that is optional, repeatable, or not at a boundary marks no
    // boundary at all: `(a*\.a*)*` puts exactly one dot in every word and still
    // splits `a.aa.a` three ways, because the run of `a`s around a dot can go to
    // either neighbour.
    for (const unsafe of ['(\\.?a*)*', '(\\.+a*)*', '(a*\\.a*)*', '((\\.a*)*)*']) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
  })

  it('keeps flagging an anchored repetition whose body derives one word two ways', () => {
    // A forced split is *not* sufficient, which is the trap in the whole idea: a
    // backtracking engine explores derivations, not splits, so a body that can
    // match its own substring k ways costs k^n over n repetitions even with
    // every boundary pinned. `^(\.((\w[a-z]?|b\w+)?|(a*[a-z0-9]?)?))*$` is
    // anchored by `.` and takes 94 ms on 22 characters where its body alone
    // takes none — every iteration matches the empty tail two ways.
    for (const unsafe of [
      '^(\\.((\\w[a-z]?|b\\w+)?|(a*[a-z0-9]?)?))*$',
      '^(\\.(a?(b?|[a-z])?)+)*$',
      '^(\\.(\\w?a*a*)?)*$',
      '^(\\.[a-z]*(([a-z]?a?)?(\\d\\w{1,})?)?)*$',
      // Two branches of different lengths starting alike: `.aaa` parses three ways.
      '(\\.(a|aa)*)*',
      // Adjacent repetitions over the same characters: `.aa` parses three ways.
      '(\\.a*a*)*',
    ]) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
  })

  it('reads a zero-minimum quantifier as nullable however it is spelled', () => {
    // `{0,}` is `*` written out, and the collision walk has to see through it.
    // Deciding nullability by testing the source character for `*` made
    // `(\.a*b{0,}a*)*` look like it had a mandatory unit in the middle, so the
    // walk stopped there and never compared the two `a*` runs — 11.6 seconds on
    // 55 characters, admitted. Every one of these is the same pattern as the
    // `*`-spelled version directly above it.
    for (const unsafe of [
      '^(\\.a*b{0,}a*)*$',
      '^(\\.\\w*-{0,}\\w*)*$',
      '^(/\\w*\\.{0,}\\w*)*$',
      '^(\\w*-{0,}\\w*\\.)*$',
      '^(\\.a{0,}a{0,})*$',
    ]) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    // Still admitted, because the runs really are disjoint — the fix is about
    // reading `{0,}` correctly, not about refusing it.
    expect(hasUnsafeRegex('^(\\.a{0,}b{0,}c*)*$')).toBe(false)
  })

  it('never reads a lookaround as a unit that consumes something', () => {
    // A lookaround matches the empty string, so an alternation branch that is
    // one is nullable — the exact hazard the grammar refuses. `groupInnerStart`
    // steps over `(?!` like any other group prefix, so unwrapping a branch
    // turned `(?!a)` into a bare `a` and the `(`-rejecting guard never saw it:
    // `((?!a)|b)+` scored as deterministic, and the first three below were
    // admitted at 1.1 seconds on 49 characters. The last one is the same lie
    // told about a pattern that happens not to blow up, and must go too.
    for (const unsafe of [
      '^(\\.((?!a)|b)+)*$',
      '^(\\.((?<!a)|b)+)*$',
      '^(\\/((?!~)|[01])+)*$',
      '^(\\.((?=a)|b)+)*$',
      '^(\\.((?<=a)|b)+)*$',
      '^(\\.a*(?=b))*$',
    ]) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    // A non-capturing or named wrapper is not a lookaround and still unwraps —
    // this is how the AsyncAPI pointer pattern's `([^\/~])` branches are read.
    expect(hasUnsafeRegex('(\\/((?:[^\\/~])|(~[01]))*)*')).toBe(false)
  })

  it('reads an empty character class the way ECMAScript does, not the way POSIX does', () => {
    // `[]` is the *empty* class and `[^]` is *any character* — the `]` closes the
    // class in both. Honouring the POSIX "a leading `]` is a literal member" rule
    // made the scan run on to the next `]` anywhere in the pattern, swallowing
    // everything between into one bogus atom: `^[^]*(a+)+$` hid a textbook
    // `(a+)+` and was admitted, at 4 seconds on 28 characters.
    for (const unsafe of ['^[^]*(a+)+$', '^([^]+x)+$', '^abc[^]def(x+)+$', '^[]*(a+)+$']) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    // The twin the screen could always see, for comparison.
    expect(hasUnsafeRegex('^[^a]*(a+)+$')).toBe(true)
    // A `]` immediately after the class is an ordinary literal, not part of it.
    expect(hasUnsafeRegex('^[a]]*$')).toBe(false)
  })

  it('reads a braced escape as one atom, so its quantifier is not lost', () => {
    // `\u{61}`, `\p{L}` and `\P{L}` carry a braced payload. Advancing two code
    // units past the `\` left `{61}` looking like a bounded quantifier, and
    // `readQuantifier` then swallowed the real `+` after it as a possessive
    // marker — so `^(\u{61}+)+$`, which *is* `^(a+)+$`, lost a level of star
    // height and was admitted while its ASCII twin was refused.
    for (const unsafe of ['^(\\u{61}+)+$', '^(\\u{61}*)*$', '^(\\p{L}+)+$', '^(\\P{L}+)+$']) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    expect(hasUnsafeRegex('^(a+)+$')).toBe(true)
    // An unclosed brace escape must not send the scan off the end of the source.
    expect(typeof hasUnsafeRegex(`^(\\u{${'6'.repeat(500)}+)+$`)).toBe('boolean')
  })

  it('only treats a braced escape as one atom when the payload could really be one', () => {
    // A span the escape cannot legally carry is not an escape under either
    // compile mode. `\p{(a+)+}` is a SyntaxError with `u`, so the runtime falls
    // back to a non-Unicode compile where `\p` is an identity escape, the braces
    // are literals, and `(a+)+` between them is live syntax. Skipping to the
    // first `}` regardless swallowed it whole: admitted, and 448 ms on 28
    // characters against 114 seconds on 36.
    for (const unsafe of ['^\\p{(a+)+}$', '^\\u{(a+)+}$', '^\\P{(a+)+}$', '^\\p{(a|a)+}$', '^\\p{(a*)*}$']) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    // Its twin spelled without the escape, which was always visible.
    expect(hasUnsafeRegex('^p\\{(a+)+\\}$')).toBe(true)

    // A length cap was the first attempt at bounding the payload scan, and it
    // reopened the very bug it was meant to bound: one character past the cap
    // the scan gave up and fell back to two code units, so this — which under
    // `u` is exactly `^(a+)+$` — lost its quantifier again. Scanning only while
    // the payload stays well-formed has no such edge.
    expect(hasUnsafeRegex(`^(\\u{${'0'.repeat(62)}61}+)+$`)).toBe(true)
    expect(hasUnsafeRegex(`^(\\u{${'0'.repeat(200)}61}+)+$`)).toBe(true)

    // Well-formed payloads keep reading as one atom, quantifier and all.
    for (const safe of [
      '^\\u{61}+$',
      '^\\p{L}+$',
      '^\\p{Script=Latin}+$',
      '^\\p{Script_Extensions=Greek}$',
      '^\\u{1F600}$',
      '^[\\u{61}-\\u{7A}]+$',
    ]) {
      expect(hasUnsafeRegex(safe), safe).toBe(false)
    }
  })

  it('refuses a body carrying a surrogate, which it reads a code unit at a time', () => {
    // The screen's tokenizers advance one UTF-16 code unit per atom, but the
    // runtime compiles with `u`, where a surrogate pair is a single atom and the
    // quantifier binds to the pair. Under the code-unit reading `<emoji>*` looks
    // like a mandatory high surrogate followed by a repeated low one, so
    // `(\.<emoji>*<emoji>*<emoji>*)*` presented as runs separated by mandatory
    // units and was admitted — while the compiled regex is three ambiguous runs
    // in a row, 1.2 seconds on 51 code units.
    const emoji = '\u{1F600}'
    for (const unsafe of [
      `^(\\.${emoji}*${emoji}*${emoji}*)*$`,
      `^(${emoji}*${emoji}*${emoji}*\\.)*$`,
      `^(\\.${emoji}*${emoji}*)*$`,
    ]) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    // Its ASCII twin is the pattern the screen thought it was looking at, and it
    // was already refused — the two must not disagree.
    expect(hasUnsafeRegex('^(\\.a*a*a*)*$')).toBe(true)
    // An astral character the body cannot repeat is no threat, but the guard is
    // deliberately blunt: any surrogate in the body forfeits the exemption.
    expect(hasUnsafeRegex(`^(\\.${emoji}\\w*)*$`)).toBe(true)
  })

  it('decides a character class under both compiles the runtime might choose', () => {
    // `compilePattern` tries the `u` flag and falls back to a non-Unicode compile
    // when the whole source is invalid under it, so a class means whatever that
    // fallback decided — not what it means read on its own. `[\u{61}]` is `{a}`
    // under `u` and `{u, {, 6, 1, }}` without, and the `\-` elsewhere in this
    // source is what forces the second reading; probing only under `u` proved
    // `u*` and `[\u{61}]*` disjoint and handed out an exemption worth 9.9
    // seconds on 56 characters.
    expect(hasUnsafeRegex('^\\-(\\.u*[\\u{61}]*)*$')).toBe(true)
    // The same body without the escape hatch is genuinely disjoint either way.
    expect(hasUnsafeRegex('^\\-(\\.u*[a]*)*$')).toBe(false)
  })

  it('screens a pattern that is only reachable through a $ref into an unfamiliar container', () => {
    // OpenAPI parks its subschemas under `components/schemas` and reaches them by
    // `$ref`. A screen that walks a fixed list of subschema keywords never sees
    // them, so this pattern used to be compiled and run unscreened — 30 characters
    // of input then burned over a second of CPU.
    expect(() =>
      validateGuard({
        $ref: '#/components/schemas/A',
        components: { schemas: { A: { type: 'string', pattern: '^(a+)+$' } } },
      }),
    ).toThrow(/backtracking|ReDoS/i)

    // Same for a container we have never heard of at all.
    expect(() => validate({ 'x-vendor-bag': { anything: { pattern: '(a*)*' } } })).toThrow(/backtracking|ReDoS/i)
  })

  it('does not mistake a regex-shaped string in const/enum data for a pattern', () => {
    // `(a+)+` here is a data constant, not a `pattern` keyword — must not be screened.
    expect(validate({ const: '(a+)+' })('(a+)+')).toBe(true)
    expect(validate({ enum: ['(a*)*', 'ok'] })('ok')).toBe(true)
    // The walk is otherwise unrestricted, so the data keywords are what keep an
    // object *value* carrying a `pattern` property from being screened as one.
    expect(validate({ const: { pattern: '(a+)+' } })({ pattern: '(a+)+' })).toBe(true)
    expect(validate({ enum: [{ pattern: '(a*)*' }] })({ pattern: '(a*)*' })).toBe(true)
    expect(validate({ type: 'object', default: { pattern: '(a+)+' } })({})).toBe(true)
  })

  it('rejects a pattern whose groups nest past the native stack limit, as a limit error', () => {
    // The screen recurses per `(`, on the native stack, and the pattern is
    // untrusted — so a deeply nested one used to surface as a `RangeError` that
    // `isValidationLimitError` does not recognize. It has to fail the same loud,
    // catchable way every other rejected pattern does.
    const nestedGroups = `${'('.repeat(30_000)}a${')'.repeat(30_000)}`
    let thrown: unknown
    try {
      validate({ type: 'string', pattern: nestedGroups })
    } catch (error) {
      thrown = error
    }
    expect(isValidationLimitError(thrown)).toBe(true)
    expect((thrown as Error).message).toMatch(/nests groups too deeply/i)
    expect(hasUnsafeRegex(nestedGroups)).toBe(true)
  })

  it('admits nothing that actually backtracks, measured rather than asserted', () => {
    // The booleans above encode today's answers; this encodes the property they
    // are supposed to stand for, for the specific patterns that have mattered.
    // It is a *fixed* corpus, so on its own it only catches a regression that
    // lands on one of these — the `{0,}` hole below sat live and undetected
    // while this test was green. The generated sweep in the next test is what
    // covers the shapes nobody thought to list.
    //
    // Every entry is a pattern paired with an input built to make a backtracking
    // engine work: a long run the body can chew on, then one character that
    // fails the match, which is what forces every alternative to be explored.
    // The rule is one-sided — a *flagged* pattern may be as slow as it likes,
    // an *admitted* one may not — so loosening the screen onto any of the
    // exponential entries fails here.
    //
    // 28 characters keeps the cost of a genuine regression near two seconds
    // rather than the nine a 30-character input costs on the dotted-identifier
    // chain, and the admitted patterns all finish in under a millisecond, so the
    // separation is four orders of magnitude wide and needs no tight threshold.
    const run = 'a'.repeat(28)
    const corpus: readonly (readonly [string, string])[] = [
      // Anchored repetitions the screen now admits.
      ['^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$', `${run}-`],
      ['^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$', `${'a.'.repeat(14)}-`],
      ['^\\$message\\.(header|payload)#(\\/(([^\\/~])|(~[01]))*)*$', `$message.header#${'/a'.repeat(14)}~`],
      ['^(\\.a*)*$', `${'.a'.repeat(14)}!`],
      ['^(\\.a*b*)*$', `.${run}!`],
      ['^(\\w+\\.)*\\w+$', `${'a.'.repeat(14)}!`],
      ['^([a-z0-9]+-)*[a-z0-9]+$', `${'a-'.repeat(14)}!`],
      ['^(/[^/]*)*$', `${'/a'.repeat(14)}~`],
      // Genuinely exponential: these must stay flagged, and the clock says why.
      ['^([A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*)*$', `${run}-`],
      ['^(\\.((\\w[a-z]?|b\\w+)?|(a*[a-z0-9]?)?))*$', `${'.'.repeat(28)}!`],
      ['^(\\.(a?(b?|[a-z])?)+)*$', `${'.a'.repeat(14)}!`],
      ['^(\\.(a|aa)*)*$', `.${run}!`],
      ['^(a+)+$', `${run}!`],
      ['^(a|a)+$', `${run}!`],
      // Both of these were admitted once, and both are 3^(n/3): a zero-minimum
      // quantifier read as mandatory, and a class probed under `u` that the
      // runtime compiles without it.
      ['^(\\.a*b{0,}a*)*$', `${'.aa'.repeat(13)}!`],
      ['^\\-(\\.u*[\\u{61}]*)*$', `-${'.uu'.repeat(13)}!`],
      // A lookaround branch, unwrapped into a fake consuming atom.
      ['^(\\.((?!a)|b)+)*$', `${'.b'.repeat(20)}!`],
      ['^(\\/((?!~)|[01])+)*$', `${'/0'.repeat(20)}!`],
    ]

    for (const [source, input] of corpus) {
      if (hasUnsafeRegex(source)) continue
      const regex = new RegExp(source)
      // The first call compiles, and timing that reports the compiler.
      regex.test('warmup')
      const started = performance.now()
      regex.test(input)
      const elapsed = performance.now() - started
      expect(
        elapsed,
        `${source} was admitted but took ${elapsed.toFixed(0)}ms on ${input.length} characters`,
      ).toBeLessThan(300)
    }
  })

  it('admits nothing that backtracks across a generated corpus, not only a listed one', () => {
    // The property the fixed corpus above cannot carry: *whatever* the screen
    // admits must be fast, including shapes nobody wrote down. Every hole found
    // in this exemption so far — `{0,}` read as mandatory, a `u`-only class
    // probe, a lookaround branch unwrapped into a consuming atom — was a shape
    // absent from the hand-written list, so the alphabet below deliberately
    // includes the pieces they were built from.
    //
    // Deterministic by construction: a fixed seed, a fixed alphabet, a fixed
    // number of draws. No wall-clock or RNG dependence, so a failure here is
    // always reproducible.
    //
    // It is a search, not a proof — it re-finds the `{0,}` hole unaided, but the
    // lookaround and `u`-flag holes need constructions too specific to stumble
    // on, which is what the named tests above are for. The two are complements:
    // this one covers shapes nobody listed, those pin the ones we have paid for.
    let state = 0x9e3779b9
    const next = (bound: number): number => {
      state = (state + 0x9e3779b9) >>> 0
      let z = state
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
      return ((z ^ (z >>> 15)) >>> 0) % bound
    }
    const pick = <T>(xs: readonly T[]): T => xs[next(xs.length)] as T

    // Each atom is paired with a character it matches, so the attack inputs can
    // be built from the alphabet the generated pattern actually uses. Fixed
    // strings do not work here: a body over `b` and `[01]` is never made to
    // backtrack by a run of `a`s, and an earlier version of this sweep missed
    // every collision it generated for exactly that reason.
    const separators: readonly (readonly [string, string])[] = [
      ['\\.', '.'],
      ['\\/', '/'],
      ['-', '-'],
      [':', ':'],
      ['@', '@'],
    ]
    const atoms: readonly (readonly [string, string])[] = [
      ['a', 'a'],
      ['b', 'b'],
      ['\\w', 'w'],
      ['\\d', '5'],
      ['\\s', ' '],
      ['\\W', '!'],
      ['.', 'x'],
      ['[a-y]', 'm'],
      ['[^/]', 'z'],
      ['[^~]', 'q'],
      ['[01]', '0'],
      ['[\\u{61}]', 'a'],
      ['u', 'u'],
      // Two UTF-16 code units, one atom under `u` — the reading mismatch that
      // let `(\.<emoji>*<emoji>*<emoji>*)*` through.
      ['\u{1F600}', '\u{1F600}'],
    ]
    // Unbounded only, and every body gets at least one. That is what makes the
    // sweep a test of *this* exemption: without it the body has star height >= 1,
    // so the outer `*` reaches 2 and the pattern can only be admitted by the
    // exemption granting it. Bounded quantifiers are deliberately absent — they
    // keep a body at height 0, where the baseline rule admits without ever
    // consulting the exemption, and a nullable body under one
    // (`^((?:a){0,3}[^/]{0,3}\.)*$`, 251 seconds on 49 characters) is a
    // pre-existing gap of the screen, not something this rule is answerable for.
    const repeats = ['*', '+', '{0,}', '{1,}', '{2,}']
    const quantifiers = [...repeats, '']
    const groups: readonly (readonly [string, string])[] = [
      ['(?!a)', ''],
      ['(?=a)', ''],
      ['(?:a)', 'a'],
      ['(a|aa)', 'a'],
      ['(a|bc)', 'a'],
      ['([^~]|~[01])', 'q'],
    ]
    /** A body, plus the characters its units can produce. */
    const body = (): { source: string; alphabet: string[] } => {
      // Draw the units from a *two-atom* pool rather than the whole alphabet, so
      // the same atom recurs often. Collisions between two repeated units are
      // the shape that breaks the exemption — `a*b{0,}a*` needs the outer two to
      // match the same character — and picking freely from thirteen atoms makes
      // that rare enough that the sweep would miss it.
      const pool = [pick(atoms), pick(atoms)]
      let source = ''
      const alphabet: string[] = []
      for (let i = 0, n = 2 + next(3); i < n; i++) {
        // The first unit always repeats, so the body always reaches height 1.
        const quantifier = i === 0 ? pick(repeats) : pick(quantifiers)
        const [unit, sample] = next(6) === 0 ? pick(groups) : pick(pool)
        source += `${unit}${quantifier}`
        if (sample !== '') alphabet.push(sample)
      }
      return { source, alphabet }
    }

    /**
     * Words the pattern very nearly matches, then one character that fails —
     * which is what makes a backtracking engine explore every alternative.
     * Measured short first: anything violent enough to hang the suite trips at
     * the 24-character length and never reaches 48, while a subtler regression
     * shows up at 48, where the `{0,}` hole ran 1.3 s.
     */
    const attacksFor = (separator: string, alphabet: readonly string[]): string[] => {
      const inputs: string[] = []
      for (const total of [24, 48]) {
        for (const run of [1, 2, 3]) {
          for (const filler of alphabet) {
            const unit = separator + filler.repeat(run)
            inputs.push(unit.repeat(Math.ceil(total / unit.length)).slice(0, total))
          }
        }
        for (const filler of alphabet) inputs.push(filler.repeat(total))
      }
      // `~` ends every input: it is outside every atom's sample alphabet, so the
      // match always fails and the engine always has to exhaust its options.
      return inputs.map((input) => `${input}~`)
    }

    let admitted = 0
    for (let i = 0; i < 1_500; i++) {
      const [separator, separatorChar] = pick(separators)
      const inner = body()
      const source = next(2) === 0 ? `^(${separator}${inner.source})*$` : `^(${inner.source}${separator})*$`
      // Compile the way the interpreter does — `u`, falling back — so the test
      // measures the regex the validator would really run.
      let regex: RegExp
      try {
        regex = new RegExp(source, 'u')
      } catch {
        try {
          regex = new RegExp(source)
        } catch {
          continue
        }
      }
      if (hasUnsafeRegex(source)) continue
      admitted++
      regex.test('warmup')
      for (const input of attacksFor(separatorChar, inner.alphabet)) {
        const started = performance.now()
        regex.test(input)
        const elapsed = performance.now() - started
        expect(
          elapsed,
          `${source} was admitted but took ${elapsed.toFixed(0)}ms on ${input.length} characters`,
        ).toBeLessThan(300)
      }
    }
    // Guards the guard: if the generator ever stopped producing patterns the
    // screen admits, every assertion above would pass vacuously.
    expect(admitted).toBeGreaterThan(20)
  })

  it('screens an anchored body against a wide alternation in bounded time', () => {
    // Rule 1's exemption compares each repeated atom against the first character
    // of every branch that follows it, and each comparison can compile a
    // `RegExp`. Charging the shared budget once per *follower* rather than once
    // per *comparison* undercounted that by the branch count: distinct literals
    // in front of a 2,600-branch alternation forced ~300,000 compiles for 20,000
    // budget, and screening this one pattern took 294 ms — against 0.27 ms
    // before the exemption existed. Now the budget stops it, at about 15 ms.
    //
    // Measured as a *ratio* against the same shape with 26x fewer branches, not
    // as a wall-clock bound. A bound has to sit below the bug to guard anything
    // — an initial 2,000 ms left the exact 294 ms regression green — but once it
    // is that tight it starts failing under the CPU contention of the full suite,
    // which runs a dozen vitest instances at once. The ratio has neither problem:
    // if the budget holds, cost is capped and barely moves with branch count
    // (measured 1.3x); if the charge is per follower again, cost tracks the
    // branch count (measured 23.2x, against 26.4x more branches). Contention
    // scales both measurements together and cancels out.
    const literals = Array.from({ length: 120 }, (_, i) => `${String.fromCharCode(0x100 + i)}*`).join('')
    const shape = (count: number): string => {
      const branches = Array.from({ length: count }, (_, i) => `[${String.fromCharCode(0x3000 + i)}]`).join('|')
      return `^(\\.${literals}(${branches}))*$`
    }
    const median = (source: string): number => {
      const timings: number[] = []
      for (let run = 0; run < 5; run++) {
        const started = performance.now()
        // Genuinely unsafe — the point is only that answering costs bounded work.
        expect(hasUnsafeRegex(source)).toBe(true)
        timings.push(performance.now() - started)
      }
      return timings.sort((a, b) => a - b)[2] as number
    }

    const control = shape(100)
    const attack = shape(2_643)
    // Prime both: the first screen of each pays for JIT warm-up.
    median(control)
    median(attack)
    const ratio = median(attack) / median(control)
    expect(ratio, `26x the branches cost ${ratio.toFixed(1)}x the screening`).toBeLessThan(6)
  })

  it('screens a very wide alternation in bounded time', () => {
    // Rule 2's pairwise scan is quadratic in the branch count, so a couple of
    // kilobytes of `(a|b|c|…)+` used to pin a CPU inside the very screen that
    // exists to stop a pattern pinning a CPU. The shared comparison budget caps
    // it; ordinary alternations are far too small to notice.
    const wide = Array.from({ length: 20_000 }, (_, i) => `[\\u${(0x0400 + i).toString(16).padStart(4, '0')}]`).join(
      '|',
    )
    const started = performance.now()
    // Distinct branches, so nothing here is genuinely ambiguous — the point is
    // only that answering takes bounded work.
    expect(hasUnsafeRegex(`(${wide})+`)).toBe(false)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('rejects a schema nested far past the native stack limit without a RangeError', () => {
    // The pattern screen and the anchor search both run before `maxDepth` applies,
    // so a recursive walk there surfaced as an uncatchable `RangeError` —
    // `isValidationLimitError` returned false and a consumer's limit handler fell
    // through to a 500. Building must succeed; the depth cap then does its job.
    const guard = validateGuard(nestedSchema(20_000))
    let thrown: unknown
    try {
      guard('x')
    } catch (error) {
      thrown = error
    }
    expect(isValidationLimitError(thrown)).toBe(true)
    expect((thrown as Error).message).toMatch(/maximum depth/i)
  })

  it('finds an $anchor buried below the native stack limit', () => {
    // The anchor search walks the whole document, so it faces the same depth as
    // the pattern screen and must survive it.
    const schema = { $ref: '#deep', $defs: { buried: nestedSchema(20_000, { $anchor: 'deep', type: 'string' }) } }
    expect(validateGuard(schema)('hello')).toBe(true)
    expect(validateGuard(schema)(42)).toBe(false)
  })

  it('rejects deeply nested data against a recursive schema instead of overflowing the stack', () => {
    const guard = validateGuard({ type: 'array', items: { $ref: '#' } })
    let thrown: unknown
    try {
      guard(nest(20_000))
    } catch (error) {
      thrown = error
    }
    expect(isValidationLimitError(thrown)).toBe(true)
    expect((thrown as Error).message).toMatch(/maximum depth/i)
  })

  it('still validates realistically nested data under the depth cap', () => {
    const guard = validateGuard({ type: 'array', items: { $ref: '#' } })
    expect(guard(nest(100))).toBe(true)
  })

  it('honors a custom maxDepth', () => {
    const guard = validateGuard({ type: 'array', items: { $ref: '#' } }, { limits: { maxDepth: 10 } })
    expect(guard(nest(3))).toBe(true)
    expect(() => guard(nest(50))).toThrow(/maximum depth/i)
  })

  it('stops an exponential anyOf/oneOf blow-up via the step budget', () => {
    // 2^40 branch evaluations against one value — must trip the budget in well
    // under a second rather than hang. A small maxSteps keeps the test snappy.
    const validator = validate(nestedAnyOf(40), { limits: { maxSteps: 50_000 } })
    let thrown: unknown
    try {
      validator(123)
    } catch (error) {
      thrown = error
    }
    expect(isValidationLimitError(thrown)).toBe(true)
    expect((thrown as Error).message).toMatch(/step budget/i)
  })

  it('trips the default step budget on an exponential schema', () => {
    // No custom limit: the default budget must still stop it (and quickly).
    expect(() => validate(nestedAnyOf(40))(123)).toThrow(/step budget/i)
  })

  it('validates a large array of distinct objects with uniqueItems in ~linear time', () => {
    const items = Array.from({ length: 20_000 }, (_, i) => ({ id: i, tag: `t${i}` }))
    // The old O(n²) pairwise scan would be ~4×10⁸ comparisons; the hash-bucketed
    // path settles distinct objects in ~O(n) and must not trip the step budget.
    expect(validate({ type: 'array', uniqueItems: true })(items)).toBe(true)
  })

  it('still detects duplicate objects, order-independently, under uniqueItems', () => {
    const dup = validate({ type: 'array', uniqueItems: true })
    expect(dup([{ a: 1 }, { a: 2 }, { a: 1 }])).not.toBe(true)
    // Key order must not matter — deepEqual semantics preserved by the hash path.
    expect(
      dup([
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ]),
    ).not.toBe(true)
    expect(dup([{ a: 1 }, { a: 2 }])).toBe(true)
    // NaN equals itself (SameValueZero), so two NaN elements are duplicates.
    expect(dup([Number.NaN, Number.NaN])).not.toBe(true)
  })

  it('surfaces a limit breach through assert as a throw', () => {
    expect(() => assert(nestedAnyOf(40), 123, { limits: { maxSteps: 50_000 } })).toThrow(/step budget/i)
  })
})
