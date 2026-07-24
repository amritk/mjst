import { bindChecked, bindSelect, bindValue } from '../bind'
import { onCleanup } from '../on-cleanup'
import type { ReadonlySignal, Signal } from '../signals'
import { batch, computed, effect, signal } from '../signals'
import { type FormErrors, schemaToValidator } from './schema-to-validator'

/** A single field's value. Text inputs give strings; checkboxes give booleans; number inputs give numbers. */
export type FieldValue = string | number | boolean

/**
 * A form's values, keyed by field. A field's type is whatever its
 * `initialValues` entry is — `''` for a text field, `false` for a checkbox, `0`
 * for a number input — and `bind` wires the matching DOM binding by inspecting
 * the element.
 */
export type FieldValues = Record<string, FieldValue>

/**
 * How a form validates. Either a plain function from values to errors, or a
 * JSON Schema object run through `@amritk/runtime-validators`. The two are told
 * apart at runtime by `typeof`: a function is the predicate, anything else is a
 * schema.
 */
export type FormValidate<V extends FieldValues> = ((values: V) => FormErrors) | object

/** Configuration for {@link createForm}. */
export type FormConfig<V extends FieldValues> = {
  /** Starting values; also the target `reset` returns to. Its keys define the form's fields. */
  initialValues: V
  /** Optional validation — a `(values) => errors` function or a JSON Schema. */
  validate?: FormValidate<V>
  /** Runs on a valid submit. May be async; `isSubmitting` tracks its lifetime. */
  onSubmit?: (values: V) => void | Promise<void>
}

/** The reactive state and helpers for one field. */
export type Field<T extends FieldValue = FieldValue> = {
  /** The field's value signal — the same one `bind` wires to the input. */
  value: Signal<T>
  /**
   * The message to display, or `undefined`. Gated on interaction: an error is
   * withheld until the field has been blurred or the form submitted, so a
   * pristine form does not shout at the user.
   */
  error: ReadonlySignal<string | undefined>
  /** Whether the field has been blurred (or the form submitted). */
  touched: ReadonlySignal<boolean>
  /** Whether the value differs from its initial value. */
  dirty: ReadonlySignal<boolean>
  /** Marks the field touched (defaults to `true`). */
  setTouched: (value?: boolean) => void
}

/** A live form: reactive state plus the handlers a view wires up. */
export type Form<V extends FieldValues> = {
  /** All current values as one reactive record. */
  values: ReadonlySignal<V>
  /**
   * Every current error, keyed by field, regardless of touched state — the
   * validator's output with any {@link Form.setError} messages layered on top
   * (a manual error wins over the computed one for that field).
   */
  errors: ReadonlySignal<FormErrors>
  /** Whether there are no errors. */
  isValid: ReadonlySignal<boolean>
  /** Whether any field differs from its initial value. */
  isDirty: ReadonlySignal<boolean>
  /** Whether an async `onSubmit` is in flight. */
  isSubmitting: ReadonlySignal<boolean>
  /** Whether a submit has been attempted (drives error visibility). */
  submitted: ReadonlySignal<boolean>
  /**
   * A form-level error message, or `undefined`. Set when an async `onSubmit`
   * rejects (the rejection's message), so a failed save surfaces without the
   * caller wiring their own `try/catch`; cleared on the next submit and on
   * `reset`.
   */
  submitError: ReadonlySignal<string | undefined>
  /** The reactive state and helpers for one field. Stable across calls. */
  field: <K extends keyof V & string>(name: K) => Field<V[K]>
  /**
   * A `ref` callback that two-way-binds a control to a field and tracks blur —
   * `ref={form.bind('email')}`. The binding matches the control: `checkbox`/
   * `radio` bind `.checked`, `number`/`range` bind a coerced number, `<select>`
   * binds on `change`, everything else binds `.value`. Cleaned up with the
   * enclosing scope.
   */
  bind: (name: keyof V & string) => (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => void
  /** Sets a field's value imperatively. */
  setValue: <K extends keyof V & string>(name: K, value: V[K]) => void
  /**
   * Sets or clears a manual error for a field — the hook for server-side
   * validation (`setError('email', 'Already taken')`). It layers over the
   * validator's output and shows as soon as the field is touched or the form
   * submitted, exactly like a computed error. Pass `undefined` to clear it; the
   * error also clears when the field's value next changes, so a corrected field
   * stops showing a stale server message.
   */
  setError: (name: keyof V & string, message: string | undefined) => void
  /** Restores initial values and clears touched/submitted/error/submitting state. */
  reset: () => void
  /** Marks everything touched, validates, and runs `onSubmit` when valid. Use as a `<form>`'s `onSubmit`. */
  handleSubmit: (event?: { preventDefault: () => void }) => Promise<void>
}

/**
 * Creates a form: field values, dirty/touched/error state, and submit handling,
 * all as signals. It is the dashboards' form layer, built entirely on core
 * primitives — values are signals, the aggregate state is `computed`, and
 * inputs wire up through the existing `bindValue` — so it adds nothing to the
 * widget's `.` bundle.
 *
 * Errors recompute reactively on every keystroke, but each field withholds its
 * message until it has been blurred or the form submitted, so validation feels
 * live without nagging a form the user has not touched yet.
 */
export const createForm = <V extends FieldValues>(config: FormConfig<V>): Form<V> => {
  const keys = Object.keys(config.initialValues) as (keyof V & string)[]
  const runValidate = toValidator(config.validate)

  // Every key came from `initialValues`, so its value is always present; the
  // cast only satisfies `noUncheckedIndexedAccess`, which widens the lookup to
  // include `undefined` for the generic index signature.
  const initialOf = <K extends keyof V & string>(key: K): V[K] => config.initialValues[key] as V[K]

  // Signals are stored uniformly as `Signal<FieldValue>` so the reset/snapshot
  // loops can write any key without hitting the "union of setters" problem;
  // `field`/`setValue` re-narrow to the concrete field type at the boundary.
  const valueSignals = {} as Record<keyof V & string, Signal<FieldValue>>
  const touchedSignals = {} as Record<keyof V & string, Signal<boolean>>
  for (const key of keys) {
    valueSignals[key] = signal<FieldValue>(initialOf(key))
    touchedSignals[key] = signal(false)
  }

  const submitted = signal(false)
  const isSubmitting = signal(false)
  const submitError = signal<string | undefined>(undefined)

  // Manual (e.g. server-side) errors, layered over the validator's output. A
  // field's entry is cleared when its value next changes so a corrected field
  // does not keep showing a stale message.
  const manualErrors = signal<FormErrors>({})

  const values = computed(() => {
    const snapshot = {} as V
    for (const key of keys) snapshot[key] = valueSignals[key]() as V[typeof key]
    return snapshot
  })
  const errors = computed(() => ({ ...runValidate(values()), ...manualErrors() }))
  const isValid = computed(() => Object.keys(errors()).length === 0)
  const isDirty = computed(() => keys.some((key) => valueSignals[key]() !== initialOf(key)))

  // Field objects are memoised so repeated `field(name)` calls (a view may read
  // one in several places) share the same signals rather than re-deriving them.
  const fields = new Map<string, unknown>()
  const field = <K extends keyof V & string>(name: K): Field<V[K]> => {
    const existing = fields.get(name)
    if (existing) return existing as Field<V[K]>
    const built: Field<V[K]> = {
      value: valueSignals[name] as unknown as Signal<V[K]>,
      error: computed(() => (touchedSignals[name]() || submitted() ? errors()[name] : undefined)),
      touched: () => touchedSignals[name](),
      dirty: computed(() => valueSignals[name]() !== initialOf(name)),
      setTouched: (value = true) => touchedSignals[name](value),
    }
    fields.set(name, built)
    return built
  }

  const bind =
    (name: keyof V & string) =>
    (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void => {
      const model = valueSignals[name]
      // The control decides the binding: a checkbox/radio is a boolean, a
      // number/range input is a coerced number, a <select> binds on `change`,
      // and everything else is a string on `input`.
      const dispose =
        element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')
          ? bindChecked(element, model as unknown as Signal<boolean>)
          : element instanceof HTMLInputElement && (element.type === 'number' || element.type === 'range')
            ? bindNumber(element, model as unknown as Signal<number>)
            : element instanceof HTMLSelectElement
              ? bindSelect(element, model as unknown as Signal<string>)
              : bindValue(element, model as unknown as Signal<string>)
      const onBlur = (): void => touchedSignals[name](true)
      // Editing a field clears any manual (server-side) error on it, so a
      // corrected value stops showing a stale message.
      const onEdit = (): void => clearManualError(name)
      element.addEventListener('blur', onBlur)
      element.addEventListener('input', onEdit)
      element.addEventListener('change', onEdit)
      // Tear both down with the enclosing scope so a re-bound / re-mounted input
      // does not leave the value effect and blur listener behind.
      onCleanup(() => {
        dispose()
        element.removeEventListener('blur', onBlur)
        element.removeEventListener('input', onEdit)
        element.removeEventListener('change', onEdit)
      })
    }

  const setValue = <K extends keyof V & string>(name: K, value: V[K]): void => {
    valueSignals[name](value)
    clearManualError(name)
  }

  const clearManualError = (name: keyof V & string): void => {
    if (manualErrors()[name] === undefined) return
    const { [name]: _cleared, ...rest } = manualErrors()
    manualErrors(rest)
  }

  const setError = (name: keyof V & string, message: string | undefined): void => {
    if (message === undefined) {
      clearManualError(name)
      return
    }
    manualErrors({ ...manualErrors(), [name]: message })
  }

  const reset = (): void =>
    batch(() => {
      for (const key of keys) {
        valueSignals[key](initialOf(key))
        touchedSignals[key](false)
      }
      submitted(false)
      isSubmitting(false)
      submitError(undefined)
      manualErrors({})
    })

  const handleSubmit = async (event?: { preventDefault: () => void }): Promise<void> => {
    event?.preventDefault()
    batch(() => {
      submitted(true)
      submitError(undefined)
      for (const key of keys) touchedSignals[key](true)
    })
    if (!isValid() || !config.onSubmit) return
    isSubmitting(true)
    try {
      await config.onSubmit(values())
    } catch (error) {
      // Surface the failure through `submitError` rather than rejecting — wired
      // as `<form onSubmit={form.handleSubmit}>` a rejection would become an
      // unhandled rejection with nowhere to go.
      submitError(error instanceof Error ? error.message : String(error))
    } finally {
      isSubmitting(false)
    }
  }

  return {
    values,
    errors,
    isValid,
    isDirty,
    isSubmitting,
    submitted,
    submitError,
    field,
    bind,
    setValue,
    setError,
    reset,
    handleSubmit,
  }
}

/**
 * Resolves the configured validation into a single `(values) => errors`
 * function. A missing validator is always-valid; a function is used as-is; a
 * schema object is compiled through {@link schemaToValidator}.
 */
const toValidator = <V extends FieldValues>(validate?: FormValidate<V>): ((values: V) => FormErrors) => {
  if (!validate) return () => ({})
  // The predicate and schema arms overlap structurally (a function is also an
  // object), so TypeScript cannot narrow the union on `typeof` alone — the cast
  // records what the `typeof` check has already proven.
  if (typeof validate === 'function') return validate as (values: V) => FormErrors
  return schemaToValidator(validate)
}

/**
 * Two-way binds a number/range input to a numeric signal — the numeric sibling
 * of the core `bindValue`. The element shows the number as text and writes back
 * `element.valueAsNumber` on input. An empty or unparseable entry is `NaN`, and
 * `NaN` renders as an empty field rather than `0`, so a user can actually clear
 * the input and a `required`/`minimum` check can tell empty apart from zero
 * (`Number.isNaN(values.age)` is the "left blank" test). Kept here rather than
 * in core because only forms coerce input types.
 */
const bindNumber = (element: HTMLInputElement, model: Signal<number>): (() => void) => {
  const stop = effect(() => {
    const value = model()
    // An empty field is `NaN`, not `'NaN'` — never write the model back into an
    // already-empty input, which would otherwise snap a cleared field to `0`.
    const next = Number.isNaN(value) ? '' : String(value)
    if (element.value !== next) element.value = next
  })
  const onInput = (): void => model(element.valueAsNumber)
  element.addEventListener('input', onInput)
  return () => {
    stop()
    element.removeEventListener('input', onInput)
  }
}
