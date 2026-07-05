/**
 * Assigns `value` under `key` on a rebuilt object without letting a `__proto__`
 * key hit the prototype setter. Ref resolution rebuilds every object node of a
 * document — including remote/external content — so a plain `target[key] = value`
 * would let a `{ "__proto__": … }` node corrupt the rebuilt object's prototype.
 * Defining it as an own data property preserves the key verbatim instead.
 */
export const assignKey = (target: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
  } else {
    target[key] = value
  }
}
