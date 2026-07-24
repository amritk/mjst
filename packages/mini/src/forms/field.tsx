import { type ClassValue, jsx, type MaybeReactive, type MiniChildren, type MiniElementProps } from '../jsx-runtime'
import type { FieldValues, Form } from './create-form'

/** Which control `<Field>` renders. Defaults to `input`. */
export type FieldControl = 'input' | 'textarea' | 'select'

/** Props for {@link Field}, parameterised by the form's value shape `V`. */
export type FieldProps<V extends FieldValues> = {
  /** The form this field belongs to — `form={form}` (prop-drilled, mini's charter). */
  form: Form<V>
  /** The field name; must be a key of the form's `initialValues`. */
  name: keyof V & string
  /** The control to render. `input` (default), `textarea`, or `select`. */
  as?: FieldControl
  /** `input`'s `type` (`email`, `password`, `checkbox`, `number`, …). Ignored for textarea/select. */
  type?: string
  /** Optional label text, rendered in a `<label for={name}>` above the control. */
  label?: string
  /** Placeholder for the control. */
  placeholder?: string
  /** `<select>` options (or any extra control children) — `<option>`s go here. */
  children?: MiniChildren
  /** Class for the wrapper element. */
  class?: MaybeReactive<ClassValue>
  /** Class for the `<label>`. */
  labelClass?: MaybeReactive<ClassValue>
  /** Class for the control. */
  inputClass?: MaybeReactive<ClassValue>
  /** Class for the error message element. */
  errorClass?: MaybeReactive<ClassValue>
  /** Wrapper tag. Defaults to `div`. */
  wrapper?: string
}

/**
 * A form field wired end to end — label, control, and live error message — over
 * a {@link Form} from {@link createForm}. It is the ergonomic layer the raw
 * primitives leave to the caller: `form.bind` two-way-binds the value and tracks
 * blur, `form.field(name).error` already gates the message on touched/submitted,
 * and this component just renders all three into one element so a view reads
 * `<Field form={form} name="email" label="Email" type="email" />` instead of
 * hand-wiring a `ref`, a `<label>`, and a conditional error `<span>`.
 *
 * It stays unopinionated about styling: every piece takes its own `class` prop
 * (`class` wrapper, `labelClass`, `inputClass`, `errorClass`) and the error node
 * is present only while there is a message to show. Being part of `/forms` it
 * adds nothing to the core `.` bundle.
 *
 * @example
 * ```tsx
 * const form = createForm({
 *   initialValues: { email: '' },
 *   validate: (v) => (v.email.includes('@') ? {} : { email: 'Enter a valid email' }),
 * })
 * const view = (
 *   <form onSubmit={form.handleSubmit}>
 *     <Field form={form} name="email" label="Email" type="email" />
 *     <button type="submit">Save</button>
 *   </form>
 * )
 * ```
 */
export const Field = <V extends FieldValues>(props: FieldProps<V>): HTMLElement => {
  const { form, name } = props
  const field = form.field(name)
  const tag = props.as ?? 'input'

  const controlProps: Record<string, unknown> = {
    id: name,
    name,
    ref: form.bind(name),
  }
  if (tag === 'input' && props.type !== undefined) controlProps['type'] = props.type
  if (props.placeholder !== undefined) controlProps['placeholder'] = props.placeholder
  if (props.inputClass !== undefined) controlProps['class'] = props.inputClass
  if (props.children !== undefined) controlProps['children'] = props.children

  const children: MiniChildren = [
    props.label === undefined ? null : jsx('label', labelProps(name, props.labelClass, props.label)),
    jsx(tag, controlProps as MiniElementProps),
    // A reactive text node that empties when there is no error to show. `error`
    // is already withheld until the field is touched or the form submitted, so
    // this stays quiet on a pristine form and appears the moment a message does.
    jsx('span', {
      ...(props.errorClass === undefined ? {} : { class: props.errorClass }),
      // Hide the node entirely (not just empty) so an error-only style — border,
      // spacing — does not paint on a valid field.
      show: () => field.error() !== undefined,
      children: () => field.error() ?? '',
    } as MiniElementProps),
  ]

  return jsx(props.wrapper ?? 'div', {
    ...(props.class === undefined ? {} : { class: props.class }),
    children,
  } as MiniElementProps)
}

/** Builds the `<label for>` props, forwarding `class` only when supplied. */
const labelProps = (name: string, labelClass: MaybeReactive<ClassValue> | undefined, text: string): MiniElementProps =>
  ({
    for: name,
    ...(labelClass === undefined ? {} : { class: labelClass }),
    children: text,
  }) as MiniElementProps
