/**
 * Own-property reads and writes for maps keyed by names the ruleset or the
 * linted document supplies.
 *
 * Those names are author-chosen, so `constructor`, `toString` and `__proto__`
 * are all names someone may legitimately use — and a bare index answers them
 * from `Object.prototype` while a bare assignment on `__proto__` sets the map's
 * prototype instead of adding a key. Neither is ever what the caller meant.
 *
 * `@amritk/helpers` carries the same pair, but `@amritk/lint` depends on
 * nothing beyond `@amritk/runtime-validators` and `@amritk/yaml` by design (see
 * `.claude/architecture.md`), so it keeps its own. One copy inside the package,
 * not one per call site.
 */

/** The value at `key`, or `undefined` when the map does not own that name. */
export const ownKey = <T>(source: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(source, key) ? source[key] : undefined

/** Assigns `value` under `key` as an own data property, `__proto__` included. */
export const setOwnKey = <T>(target: Record<string, T>, key: string, value: NoInfer<T>): void => {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
  } else {
    target[key] = value
  }
}
