// Characters that force the JSON.stringify escaping path below: quote,
// backslash, C0 controls, and the JS line separators. Anything else sits
// verbatim inside a double-quoted literal.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the C0 range is exactly the set that must never appear raw in a generated string literal
const NEEDS_ESCAPING = /["\\\u0000-\u001f\u2028\u2029]/

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
