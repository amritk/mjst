/**
 * Generates an enum validation check expression.
 * Returns a string that checks if the value is in the allowed enum values.
 */
export const generateEnumCheck = (accessor: string, enumValues: readonly unknown[]): string => {
  const serializedEnum = JSON.stringify(enumValues)
  return `${serializedEnum}.includes(${accessor} as never)`
}
