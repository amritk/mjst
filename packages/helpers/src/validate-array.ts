/**
 * Parses the items of an array with a parser function.
 *
 * When every element parses to the very same reference — the parser found it
 * already valid and handed it back, as the generated item sub-parsers do for
 * clean values — the input array itself is returned and nothing is allocated.
 * The result array is only materialized (lazily, on the first element the
 * parser actually replaced) when something was coerced or stripped, so the
 * common all-clean parse costs no allocation at all. Callers already share
 * element references either way; sharing the container mirrors the generated
 * fast paths, which return the input array by reference too.
 */
export const validateArray = (input: unknown, parser: (input: unknown) => unknown) => {
  if (!Array.isArray(input)) {
    return []
  }

  const len = input.length
  let result: unknown[] | null = null
  for (let i = 0; i < len; i++) {
    const parsed = parser(input[i])
    if (result !== null) {
      result[i] = parsed
    } else if (parsed !== input[i]) {
      // First replaced element: materialize the copy and backfill the prefix.
      result = new Array(len)
      for (let j = 0; j < i; j++) result[j] = input[j]
      result[i] = parsed
    }
  }

  return result ?? input
}
