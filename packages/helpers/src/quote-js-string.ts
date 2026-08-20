// Characters that force the JSON.stringify escaping path below: quote,
// backslash, C0 controls, the JS line separators, and an *unpaired* surrogate.
// Anything else sits verbatim inside a double-quoted literal.
//
// A lone surrogate is a legal JSON string (`"\ud800"`), so it is a legal
// property name, pattern, and enum member — but it has no UTF-8 encoding, and
// writing the generated file replaces it with U+FFFD. The literal that reached
// disk was then a *different string* than the schema declared, so the emitted
// check rejected the value the document says is valid. `JSON.stringify` escapes
// exactly these to `\ud800`, which does survive. A well-formed pair is fine
// verbatim and stays on the fast path, which is what the lookahead/lookbehind
// are for — emoji in a property name are common enough to care.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the C0 range is exactly the set that must never appear raw in a generated string literal
const UNESCAPABLE_RAW = /["\\\u0000-\u001f\u2028\u2029]/
/** A high surrogate with no low after it, or a low with no high before it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const NEEDS_ESCAPING = new RegExp(`${UNESCAPABLE_RAW.source}|${LONE_SURROGATE.source}`)

/**
 * Emits `text` as a double-quoted JS string literal for generated code.
 *
 * This is the one escape-or-quote decision for schema-controlled text
 * (property names, patterns, enum values) embedded in generated source — a key
 * like `it's` or a pattern with a quote or newline must never break out of the
 * literal or inject code, so anything carrying such a character goes through
 * `JSON.stringify`. The common all-plain string skips the full escaper: code
 * generators emit one literal per assertion/message, and the stringify calls
 * were a measurable slice of generation time. Centralized so the next
 * generator wanting the fast path cannot get the security-sensitive regex
 * subtly wrong.
 */
export const quoteJsString = (text: string): string => (NEEDS_ESCAPING.test(text) ? JSON.stringify(text) : `"${text}"`)
