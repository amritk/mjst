// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

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
})
