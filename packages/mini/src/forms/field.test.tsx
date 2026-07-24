// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { mount } from '../mount'
import { createForm } from './create-form'
import { Field } from './field'

describe('field', () => {
  it('renders a label and an input wired to the field', () => {
    const form = createForm({ initialValues: { email: 'a@b.com' } })
    const host = document.createElement('div')
    mount(host, () => Field({ form, name: 'email', label: 'Email', type: 'email' }))
    const label = host.querySelector('label')
    const input = host.querySelector('input') as HTMLInputElement
    expect(label?.textContent).toBe('Email')
    expect(label?.getAttribute('for')).toBe('email')
    expect(input.id).toBe('email')
    expect(input.type).toBe('email')
    // The input reflects the field value and writes back on input.
    expect(input.value).toBe('a@b.com')
    input.value = 'c@d.com'
    input.dispatchEvent(new Event('input'))
    expect(form.values().email).toBe('c@d.com')
  })

  it('shows the validation error only after the field is touched', () => {
    const form = createForm({
      initialValues: { email: '' },
      validate: (v) => (v.email.includes('@') ? {} : { email: 'Invalid email' }),
    })
    const host = document.createElement('div')
    mount(host, () => Field({ form, name: 'email' }))
    const error = host.querySelector('span') as HTMLElement
    // Pristine: the message is withheld and the node is hidden.
    expect(error.textContent).toBe('')
    expect(error.style.display).toBe('none')
    // Blur touches the field; the error appears.
    const input = host.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new Event('blur'))
    expect(error.textContent).toBe('Invalid email')
    expect(error.style.display).not.toBe('none')
  })

  it('renders a select with its options and binds the choice', () => {
    const form = createForm({ initialValues: { role: 'user' } })
    const host = document.createElement('div')
    mount(host, () =>
      Field({
        form,
        name: 'role',
        as: 'select',
        children: [jsxOption('user', 'User'), jsxOption('admin', 'Admin')],
      }),
    )
    const select = host.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('user')
    select.value = 'admin'
    select.dispatchEvent(new Event('change'))
    expect(form.values().role).toBe('admin')
  })

  it('applies the class props to their respective parts', () => {
    const form = createForm({ initialValues: { name: '' } })
    const host = document.createElement('div')
    mount(host, () =>
      Field({
        form,
        name: 'name',
        label: 'Name',
        class: 'wrap',
        labelClass: 'lbl',
        inputClass: 'inp',
        errorClass: 'err',
      }),
    )
    expect((host.firstElementChild as HTMLElement).className).toBe('wrap')
    expect(host.querySelector('label')?.className).toBe('lbl')
    expect(host.querySelector('input')?.className).toBe('inp')
    expect(host.querySelector('span')?.className).toBe('err')
  })
})

/** Small helper: build an `<option>` without JSX runtime wiring in the test. */
const jsxOption = (value: string, text: string): HTMLElement => {
  const option = document.createElement('option')
  option.value = value
  option.textContent = text
  return option
}
