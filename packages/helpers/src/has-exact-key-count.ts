/**
 * Returns true if `value` is a plain object (prototype `Object.prototype`) with
 * exactly `count` own enumerable string keys — the no-undeclared-keys test a
 * generated fast path runs once every declared property has been proven present.
 *
 * Equivalent to `Object.getPrototypeOf(value) === Object.prototype &&
 * Object.keys(value).length === count`, which is what generated code used to
 * emit inline. `Object.keys` allocates an array on every call to avoid
 * allocating the small result object the fast path exists to skip, so it cost
 * strictly more than the work it saved; counting with `for..in` and bailing at
 * the first key past the budget allocates nothing and stops early on a
 * carries-extras input.
 *
 * The prototype check is what makes the two forms agree: `for..in` walks
 * inherited enumerable keys as well as own ones, and only a plain object is
 * guaranteed to have none (`Object.prototype`'s own members are all
 * non-enumerable). It is load-bearing for the callers too — a crafted prototype
 * can satisfy a fast path's typed property checks through inherited values while
 * the own-key count still matches, so non-plain inputs must take the slow path.
 *
 * Examples:
 *   hasExactKeyCount({ a: 1, b: 2 }, 2)                 // true
 *   hasExactKeyCount({ a: 1, b: 2, c: 3 }, 2)           // false (extra key)
 *   hasExactKeyCount({ a: 1 }, 2)                       // false (missing key)
 *   hasExactKeyCount(Object.create(null), 0)            // false (not plain)
 */
export const hasExactKeyCount = (value: object, count: number): boolean => {
  if (Object.getPrototypeOf(value) !== Object.prototype) return false
  let seen = 0
  for (const _key in value) if (++seen > count) return false
  return seen === count
}
