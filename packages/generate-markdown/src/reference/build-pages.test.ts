import { describe, expect, it } from 'vitest'
import { buildPages } from '#reference/build-pages'
import { readDocConfig } from '#reference/read-doc-config'
import type { ConfigSchema } from '#types/schema'

/** Builds the page model the way `generateMarkdownFiles` does, minus rendering. */
const build = (schema: ConfigSchema) => buildPages(schema, readDocConfig(schema))

const pageNames = (schema: ConfigSchema) =>
  build(schema).map((model) => ({
    file: model.page.file,
    entries: model.entries.map((entry) => entry.name),
    sections: model.sections.map((section) => ({
      id: section.section.id,
      entries: section.entries.map((entry) => entry.name),
    })),
  }))

describe('build-pages', () => {
  it('puts everything on an index page when the schema declares none', () => {
    expect(pageNames({ properties: { a: { type: 'string' } } })).toEqual([
      { file: 'index.md', entries: ['a'], sections: [] },
    ])
  })

  it('keeps declared pages in their declared order, index first', () => {
    const schema = {
      'x-doc': {
        file: 'configuration.md',
        pages: [
          { id: 'python', file: 'python.md' },
          { id: 'typescript', file: 'typescript.md' },
        ],
      },
      properties: {},
    }
    expect(build(schema).map((model) => model.page.file)).toEqual(['configuration.md', 'python.md', 'typescript.md'])
  })

  // This is the split that matters: one nested property moves to its own file
  // while its siblings stay where they are.
  it('moves a nested property to the page it names', () => {
    const schema = {
      'x-doc': { pages: [{ id: 'ts', file: 'ts.md' }] },
      properties: {
        targets: {
          type: 'object',
          properties: {
            typescript: { type: 'object', 'x-doc': { page: 'ts' }, properties: { a: { type: 'string' } } },
            go: { type: 'object' },
          },
        },
      },
    }
    expect(pageNames(schema)).toEqual([
      { file: 'index.md', entries: ['targets'], sections: [] },
      { file: 'ts.md', entries: ['typescript'], sections: [] },
    ])
  })

  it('follows a page assignment down into a deeper property', () => {
    const schema = {
      'x-doc': { pages: [{ id: 'deep', file: 'deep.md' }] },
      properties: {
        a: {
          type: 'object',
          properties: {
            b: { type: 'object', properties: { c: { type: 'string', 'x-doc': { page: 'deep' } } } },
          },
        },
      },
    }
    expect(pageNames(schema)).toEqual([
      { file: 'index.md', entries: ['a'], sections: [] },
      { file: 'deep.md', entries: ['c'], sections: [] },
    ])
  })

  it('groups properties into the sections they name', () => {
    const schema = {
      'x-doc': {
        sections: [
          { id: 'one', title: 'One' },
          { id: 'two', title: 'Two' },
        ],
      },
      properties: {
        a: { type: 'string', 'x-doc': { section: 'two' } },
        b: { type: 'string', 'x-doc': { section: 'one' } },
        c: { type: 'string' },
      },
    }
    expect(pageNames(schema)).toEqual([
      {
        file: 'index.md',
        entries: ['c'],
        sections: [
          { id: 'one', entries: ['b'] },
          { id: 'two', entries: ['a'] },
        ],
      },
    ])
  })

  // A prose-only section is how an intro ("Minimal config", with an example)
  // moves into the schema instead of living in a hand-edited file.
  it('keeps a section that no property joins', () => {
    const schema = { 'x-doc': { sections: [{ id: 'intro', title: 'Intro' }] }, properties: {} }
    expect(pageNames(schema)[0]?.sections).toEqual([{ id: 'intro', entries: [] }])
  })

  it('pulls a nested property up into the section it names', () => {
    const schema = {
      'x-doc': { sections: [{ id: 'emitter', title: 'Emitter' }] },
      properties: {
        target: {
          type: 'object',
          properties: { options: { type: 'object', 'x-doc': { section: 'emitter' } } },
        },
      },
    }
    expect(pageNames(schema)).toEqual([
      { file: 'index.md', entries: ['target'], sections: [{ id: 'emitter', entries: ['options'] }] },
    ])
  })

  it('renders a section on the page it declares', () => {
    const schema = {
      'x-doc': {
        pages: [{ id: 'ts', file: 'ts.md' }],
        sections: [{ id: 'emitter', title: 'Emitter', page: 'ts' }],
      },
      properties: { options: { type: 'object', 'x-doc': { section: 'emitter' } } },
    }
    expect(pageNames(schema)).toEqual([
      { file: 'index.md', entries: [], sections: [] },
      { file: 'ts.md', entries: [], sections: [{ id: 'emitter', entries: ['options'] }] },
    ])
  })

  it('leaves hidden properties out of every page', () => {
    const schema = { properties: { a: { type: 'string', 'x-doc': { hidden: true } }, b: { type: 'string' } } }
    expect(pageNames(schema)[0]?.entries).toEqual(['b'])
  })

  it('sorts a section by its own rule, not the page default', () => {
    const schema = {
      'x-doc': { sort: 'schema', sections: [{ id: 'sorted', title: 'Sorted', sort: 'alphabetical' }] },
      properties: {
        b: { type: 'string', 'x-doc': { section: 'sorted' } },
        a: { type: 'string', 'x-doc': { section: 'sorted' } },
      },
    }
    expect(pageNames(schema)[0]?.sections).toEqual([{ id: 'sorted', entries: ['a', 'b'] }])
  })

  // A typo in a page or section id would otherwise drop the property out of the
  // docs silently — the one failure mode where nothing about the output looks
  // wrong.
  it('refuses a property assigned to an undeclared page', () => {
    const schema = { properties: { a: { type: 'string', 'x-doc': { page: 'nope' } } } }
    expect(() => build(schema)).toThrow(/page "nope"/)
  })

  it('refuses a property assigned to an undeclared section', () => {
    const schema = { properties: { a: { type: 'string', 'x-doc': { section: 'nope' } } } }
    expect(() => build(schema)).toThrow(/section "nope"/)
  })

  it('refuses a section that renders on an undeclared page', () => {
    const schema = { 'x-doc': { sections: [{ id: 'one', page: 'nope' }] }, properties: {} }
    expect(() => build(schema)).toThrow(/page "nope"/)
  })

  it('refuses a property whose page and section disagree', () => {
    const schema = {
      'x-doc': { pages: [{ id: 'ts', file: 'ts.md' }], sections: [{ id: 'one', title: 'One' }] },
      properties: { a: { type: 'string', 'x-doc': { page: 'ts', section: 'one' } } },
    }
    expect(() => build(schema)).toThrow(/Move the section or drop the page/)
  })

  it('refuses two pages that would overwrite the same file', () => {
    const schema = {
      'x-doc': {
        file: 'configuration.md',
        pages: [
          { id: 'a', file: 'same.md' },
          { id: 'b', file: 'same.md' },
        ],
      },
      properties: {},
    }
    expect(() => build(schema)).toThrow(/Two pages are both written to "same.md"/)
  })
})
