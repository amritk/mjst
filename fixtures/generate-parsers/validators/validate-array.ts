/** Parses the items of an array with a parser function */
export const validateArray = (input: unknown, parser: (input: unknown) => unknown) => {
  if (!Array.isArray(input)) {
    return []
  }

  // Pre-allocate the result array for better performance than push()
  const len = input.length
  const result = new Array(len)
  for (let i = 0; i < len; i++) {
    result[i] = parser(input[i])
  }

  return result
}
