// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { effectScope } from '../signals'
import { createForm } from './create-form'

describe('create-form', () => {
  it('exposes field values as signals seeded from initialValues', () => {
    const form = createForm({ initialValues: { name: 'Ada', email: '' } })
    expect(form.values()).toEqual({ name: 'Ada', email: '' })
    form.field('name').value('Grace')
    expect(form.values().name).toBe('Grace')
  })

  it('tracks dirty state per field and for the form', () => {
    const form = createForm({ initialValues: { name: 'Ada' } })
    expect(form.isDirty()).toBe(false)
    expect(form.field('name').dirty()).toBe(false)
    form.setValue('name', 'Grace')
    expect(form.field('name').dirty()).toBe(true)
    expect(form.isDirty()).toBe(true)
    form.setValue('name', 'Ada')
    expect(form.isDirty()).toBe(false)
  })

  it('withholds a field error until the field is touched', () => {
    const form = createForm({
      initialValues: { name: '' },
      validate: (values) => (values.name ? {} : { name: 'Required' }),
    })
    // Error exists in the aggregate immediately, but the field hides it while pristine.
    expect(form.errors()).toEqual({ name: 'Required' })
    expect(form.field('name').error()).toBeUndefined()
    form.field('name').setTouched()
    expect(form.field('name').error()).toBe('Required')
  })

  it('recomputes validity reactively as values change', () => {
    const form = createForm({
      initialValues: { name: '' },
      validate: (values) => (values.name ? {} : { name: 'Required' }),
    })
    expect(form.isValid()).toBe(false)
    form.setValue('name', 'Ada')
    expect(form.isValid()).toBe(true)
  })

  it('validates through a JSON Schema and blocks submit until valid', async () => {
    const submitted: Array<Record<string, string>> = []
    const form = createForm({
      initialValues: { email: '' },
      validate: {
        type: 'object',
        properties: { email: { type: 'string', minLength: 1 } },
        required: ['email'],
      },
      onSubmit: (values) => {
        submitted.push(values)
      },
    })
    await form.handleSubmit()
    // Invalid: onSubmit must not run, and a submit attempt reveals the error.
    expect(submitted).toHaveLength(0)
    expect(form.field('email').error()).toBeDefined()
    form.setValue('email', 'a@b.com')
    await form.handleSubmit()
    expect(submitted).toEqual([{ email: 'a@b.com' }])
  })

  it('marks every field touched on submit', async () => {
    const form = createForm({
      initialValues: { a: '', b: '' },
      validate: () => ({ a: 'bad' }),
    })
    expect(form.field('a').touched()).toBe(false)
    await form.handleSubmit()
    expect(form.field('a').touched()).toBe(true)
    expect(form.field('b').touched()).toBe(true)
    expect(form.submitted()).toBe(true)
  })

  it('tracks isSubmitting across an async submit', async () => {
    let resolveSubmit: (() => void) | undefined
    const form = createForm({
      initialValues: { name: 'Ada' },
      onSubmit: () => new Promise<void>((resolve) => (resolveSubmit = resolve)),
    })
    const pending = form.handleSubmit()
    expect(form.isSubmitting()).toBe(true)
    resolveSubmit?.()
    await pending
    expect(form.isSubmitting()).toBe(false)
  })

  it('resets values and interaction state', () => {
    const form = createForm({ initialValues: { name: 'Ada' } })
    form.setValue('name', 'Grace')
    form.field('name').setTouched()
    form.reset()
    expect(form.values().name).toBe('Ada')
    expect(form.field('name').touched()).toBe(false)
    expect(form.isDirty()).toBe(false)
  })

  it('two-way binds an input through bind and tracks blur', () => {
    const form = createForm({ initialValues: { name: 'Ada' } })
    const input = document.createElement('input')
    form.bind('name')(input)
    // Signal → element on creation.
    expect(input.value).toBe('Ada')
    // Element → signal on input.
    input.value = 'Grace'
    input.dispatchEvent(new Event('input'))
    expect(form.values().name).toBe('Grace')
    // Blur marks the field touched.
    input.dispatchEvent(new Event('blur'))
    expect(form.field('name').touched()).toBe(true)
  })

  it('returns the same field object on repeated calls', () => {
    const form = createForm({ initialValues: { name: 'Ada' } })
    expect(form.field('name')).toBe(form.field('name'))
  })

  it('binds a checkbox field as a boolean', () => {
    const form = createForm({ initialValues: { agree: false } })
    const input = document.createElement('input')
    input.type = 'checkbox'
    form.bind('agree')(input)
    // Signal → box on creation.
    expect(input.checked).toBe(false)
    // Box → signal on change.
    input.checked = true
    input.dispatchEvent(new Event('change'))
    expect(form.values().agree).toBe(true)
  })

  it('binds a number field as a coerced number', () => {
    const form = createForm({ initialValues: { qty: 1 } })
    const input = document.createElement('input')
    input.type = 'number'
    form.bind('qty')(input)
    expect(input.value).toBe('1')
    input.value = '42'
    input.dispatchEvent(new Event('input'))
    expect(form.values().qty).toBe(42)
    // A field validator sees the real number type.
    expect(typeof form.values().qty).toBe('number')
  })

  it('lets a number field be cleared instead of snapping to zero', () => {
    const form = createForm({ initialValues: { qty: 5 } })
    const input = document.createElement('input')
    input.type = 'number'
    form.bind('qty')(input)
    // Clearing the field must leave it empty and report NaN, not force a "0" —
    // so a required/minimum check can tell "left blank" apart from "typed zero".
    input.value = ''
    input.dispatchEvent(new Event('input'))
    expect(input.value).toBe('')
    expect(Number.isNaN(form.values().qty)).toBe(true)
  })

  it('layers a manual error over validation and clears it on edit', () => {
    const form = createForm({ initialValues: { email: 'taken@x.com' } })
    const input = document.createElement('input')
    form.bind('email')(input)
    form.field('email').setTouched()
    form.setError('email', 'Already taken')
    expect(form.field('email').error()).toBe('Already taken')
    expect(form.isValid()).toBe(false)
    // Editing the field clears the server-side message.
    input.value = 'new@x.com'
    input.dispatchEvent(new Event('input'))
    expect(form.field('email').error()).toBeUndefined()
  })

  it('captures a rejected submit in submitError without rejecting', async () => {
    const form = createForm({
      initialValues: { name: 'Ada' },
      onSubmit: async () => {
        throw new Error('server down')
      },
    })
    // handleSubmit must resolve (not reject) so a form onSubmit never leaks an
    // unhandled rejection; the message surfaces through submitError.
    await form.handleSubmit()
    expect(form.submitError()).toBe('server down')
    expect(form.isSubmitting()).toBe(false)
  })

  it('reset clears submitting, submit error, and manual errors', () => {
    const form = createForm({ initialValues: { name: 'Ada' } })
    form.setError('name', 'nope')
    expect(form.field('name').error() !== undefined || form.errors()['name'] === 'nope').toBe(true)
    form.reset()
    expect(form.errors()['name']).toBeUndefined()
    expect(form.submitError()).toBeUndefined()
    expect(form.isSubmitting()).toBe(false)
  })

  it('tears down a bound input when its scope is disposed', () => {
    const form = createForm({ initialValues: { name: 'Ada' } })
    const input = document.createElement('input')
    const dispose = effectScope(() => {
      form.bind('name')(input)
    })
    dispose()
    // After disposal the value binding is gone: signal writes no longer reach
    // the element, and blur no longer marks the field touched.
    form.setValue('name', 'Grace')
    expect(input.value).toBe('Ada')
    input.dispatchEvent(new Event('blur'))
    expect(form.field('name').touched()).toBe(false)
  })
})
