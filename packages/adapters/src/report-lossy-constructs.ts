/**
 * Emits mjst's batched, branded notice for source constructs that could not be
 * fully represented in JSON Schema and were therefore widened during conversion
 * — an unsupported schema type degrades to an open ("accept anything") schema,
 * and an unsupported refinement is dropped, so in both cases the result accepts
 * more than the source did.
 *
 * The Zod and Valibot adapters both funnel their collected constructs through
 * here so the two behave identically, instead of each inventing its own wording
 * (or, in Valibot's case, delegating the reporting to a third-party converter
 * that logs one line per construct).
 *
 * - Best-effort (the default): a single `console.warn` listing every widened
 *   construct, so the loss is visible in one line instead of silent or scattered.
 * - Strict: throws instead, refusing to hand back a type that is wider than the
 *   source schema.
 *
 * Does nothing when no constructs were widened, so callers can invoke it
 * unconditionally after a conversion.
 */
export const reportLossyConstructs = (
  adapter: 'Zod' | 'Valibot',
  constructs: ReadonlySet<string>,
  strict: boolean | undefined,
): void => {
  if (constructs.size === 0) return

  const list = [...constructs].sort().join(', ')
  const plural = constructs.size !== 1
  const detail =
    `${list} ${plural ? 'have' : 'has'} no full JSON Schema representation and ${plural ? 'were' : 'was'} ` +
    `widened. The generated type will be wider than the ${adapter} schema.`

  if (strict) {
    throw new Error(
      `[mjst] ${adapter} adapter (strict mode): ${detail} ` +
        'Remove the unsupported construct(s) from the schema, or disable strict mode to widen and warn instead.',
    )
  }

  console.warn(`[mjst] ${adapter} adapter: ${detail}`)
}
