/**
 * A schema keyword's value, treating an inherited name as absent.
 *
 * Schemas arrive at runtime, so a bare `s['additionalProperties']` answers from
 * `Object.prototype` when a dependency has polluted it — turning a keyword on
 * for every schema in the process, so `additionalProperties: false` rejected
 * every object and `propertyNames` rejected every key. Each keyword was found
 * and fixed one at a time across several reviews; `prototype-pollution.test.ts`
 * now enumerates the whole surface, and this is the single read it relies on.
 *
 * Spelled out rather than importing `@amritk/helpers`' `readKey`: this package
 * takes no `@amritk/*` dependency by design, so the runtime stays slim.
 */
export const own = (schema: Record<string, unknown>, keyword: string): unknown =>
  Object.hasOwn(schema, keyword) ? schema[keyword] : undefined
