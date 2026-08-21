import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateMarkdownFiles } from '#reference/generate-markdown-files'
import type { GeneratedFile } from '#types/doc'

const FIXTURES = resolve(import.meta.dirname, '../../fixtures')

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(FIXTURES, `${name}.schema.json`), 'utf-8')) as unknown

const golden = (name: string, file: string): string => readFileSync(resolve(FIXTURES, 'expected', name, file), 'utf-8')

/** Every markdown file checked in under `fixtures/expected/<name>`. */
const goldenFiles = (name: string): readonly string[] =>
  readdirSync(resolve(FIXTURES, 'expected', name), { recursive: true, encoding: 'utf-8' })
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.split('\\').join('/'))
    .sort()

const only = (files: readonly GeneratedFile[]): string => {
  expect(files).toHaveLength(1)
  return files[0]?.content ?? ''
}

describe('generate-markdown-files', () => {
  it('renders a single page named index.md by default', () => {
    const files = generateMarkdownFiles({ title: 'Config', properties: { a: { type: 'string' } } })
    expect(files.map((file) => file.filename)).toEqual(['index.md'])
    expect(files[0]?.content).toBe('# Config\n\n## a\n\n**Type:** `string`\n')
  })

  it('takes the page title and prose from the schema', () => {
    const content = only(
      generateMarkdownFiles({ title: 'Configuration', description: 'One object to configure it all.' }),
    )
    expect(content).toBe('# Configuration\n\nOne object to configure it all.\n')
  })

  it('lets the caller override the file, title and language', () => {
    const files = generateMarkdownFiles(
      { title: 'From the schema', properties: { a: { type: 'string', default: 'x' } } },
      { file: 'docs/reference.md', title: 'From the caller', language: 'javascript' },
    )
    expect(files[0]?.filename).toBe('docs/reference.md')
    expect(files[0]?.content).toContain('# From the caller')
    expect(files[0]?.content).toContain("**Default:** `'x'`")
  })

  it('starts at the heading level the caller asks for', () => {
    const content = only(
      generateMarkdownFiles({ title: 'Config', properties: { a: { type: 'string' } } }, { headingLevel: 2 }),
    )
    expect(content).toContain('## Config')
    expect(content).toContain('### a')
  })

  it('renders the type, description, default and derived example of a property', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          darkMode: {
            type: 'boolean',
            default: false,
            description: 'Whether dark mode is on initially.',
            examples: [true],
          },
        },
        'x-doc': { language: 'javascript' },
      }),
    )
    expect(content).toBe(
      [
        '## darkMode',
        '',
        '**Type:** `boolean`',
        '',
        'Whether dark mode is on initially.',
        '',
        '**Default:** `false`',
        '',
        '```javascript',
        '{',
        '  darkMode: true',
        '}',
        '```',
        '',
      ].join('\n'),
    )
  })

  it('marks required properties', () => {
    const content = only(generateMarkdownFiles({ required: ['a'], properties: { a: { type: 'string' } } }))
    expect(content).toContain('**Required**')
  })

  it('marks a deprecated property before anything else', () => {
    const content = only(generateMarkdownFiles({ properties: { spec: { type: 'object', deprecated: true } } }))
    expect(content).toContain('## spec\n\n> **Deprecated**\n\n**Type:** `object`')
  })

  it('renders an enum as a literal union without repeating it as allowed values', () => {
    const content = only(
      generateMarkdownFiles({ properties: { mode: { enum: ['json', 'yaml'] } }, 'x-doc': { language: 'javascript' } }),
    )
    expect(content).toContain("**Type:** `'json' | 'yaml'`")
    expect(content).not.toContain('**Allowed values:**')
  })

  it('lists allowed values when x-doc.type replaced the label', () => {
    const content = only(
      generateMarkdownFiles({ properties: { mode: { enum: ['json', 'yaml'], 'x-doc': { type: 'Format' } } } }),
    )
    expect(content).toContain('**Type:** `Format`')
    expect(content).toContain('**Allowed values:** `"json"`, `"yaml"`')
  })

  it('lists the examples the derived block did not use', () => {
    const content = only(generateMarkdownFiles({ properties: { name: { type: 'string', examples: ['a', 'b', 'c'] } } }))
    expect(content).toContain('**Examples:** `"b"`, `"c"`')
    expect(content).toContain('"name": "a"')
  })

  it('lists every example when the property brings its own code block', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { name: { type: 'string', examples: ['a', 'b'], 'x-doc': { example: 'name = "a"' } } },
      }),
    )
    expect(content).toContain('**Examples:** `"a"`, `"b"`')
    expect(content).toContain('```json\nname = "a"\n```')
  })

  it('renders constraints the type label cannot carry', () => {
    const content = only(
      generateMarkdownFiles({ properties: { key: { type: 'string', pattern: '^[a-z]$', minLength: 1 } } }),
    )
    expect(content).toContain('**Constraints:** `pattern: ^[a-z]$`, `minLength: 1`')
  })

  it('renders notes as blockquotes above the example and footers below it', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          a: { type: 'string', 'x-doc': { note: 'Read this first.', example: 'a = 1', footer: 'And this after.' } },
        },
      }),
    )
    expect(content).toBe(
      [
        '## a',
        '',
        '**Type:** `string`',
        '',
        '> Read this first.',
        '',
        '```json',
        'a = 1',
        '```',
        '',
        'And this after.',
        '',
      ].join('\n'),
    )
  })

  it('renders an example given as a value in the page language', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { type: 'string', 'x-doc': { example: { caption: 'Like so:', value: { a: 'b' } } } } },
        'x-doc': { language: 'javascript' },
      }),
    )
    expect(content).toContain("Like so:\n\n```javascript\n{\n  a: 'b'\n}\n```")
  })

  it('honours a per-example language override', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { type: 'string', 'x-doc': { example: { language: 'bash', code: 'acme --help' } } } },
      }),
    )
    expect(content).toContain('```bash\nacme --help\n```')
  })

  // An example that itself contains a fence would otherwise close the block
  // early and spill the rest of the sample onto the page.
  it('widens the fence when the example contains one', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { type: 'string', 'x-doc': { example: '```js\nconst a = 1\n```' } } },
      }),
    )
    expect(content).toContain('````json\n```js\nconst a = 1\n```\n````')
  })

  it('leaves hidden properties out entirely', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { shown: { type: 'string' }, secret: { type: 'string', 'x-doc': { hidden: true } } },
      }),
    )
    expect(content).toContain('## shown')
    expect(content).not.toContain('secret')
  })

  it('nests children as deeper headings by default', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          server: { type: 'object', properties: { host: { type: 'string', description: 'Hostname to bind.' } } },
        },
      }),
    )
    expect(content).toContain('## server')
    expect(content).toContain('### host')
  })

  it('renders children as a table when the property asks for one', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          server: {
            type: 'object',
            'x-doc': { layout: 'table' },
            properties: { host: { type: 'string', description: 'Hostname to bind.' } },
          },
        },
      }),
    )
    expect(content).toContain('| `host` | `string` | Hostname to bind. |')
    expect(content).not.toContain('### host')
  })

  it('renders no children at all when the description covers them', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          server: { type: 'object', 'x-doc': { layout: 'none' }, properties: { host: { type: 'string' } } },
        },
      }),
    )
    expect(content).not.toContain('host')
  })

  it('takes the default layout from the schema', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: { server: { type: 'object', properties: { host: { type: 'string' } } } },
      }),
    )
    expect(content).toContain('| `host` | `string` |  |')
  })

  it('drops the heading and shape markers when the property is the page', () => {
    const files = generateMarkdownFiles({
      'x-doc': { pages: [{ id: 'ts', file: 'ts.md', title: 'TypeScript' }] },
      properties: {
        typescript: {
          type: 'object',
          'x-doc': { page: 'ts', heading: false },
          properties: { packageName: { type: 'string', description: 'Package name.' } },
        },
      },
    })
    const page = files.find((file) => file.filename === 'ts.md')?.content ?? ''
    expect(page).toBe('# TypeScript\n\n## packageName\n\n**Type:** `string`\n\nPackage name.\n')
  })

  it('groups properties under the sections the schema declares', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'Config',
        'x-doc': {
          sections: [{ id: 'props', title: 'Properties', description: 'The options.' }],
        },
        properties: { loose: { type: 'string' }, grouped: { type: 'string', 'x-doc': { section: 'props' } } },
      }),
    )
    // Properties that never named a section belong to the page as a whole, so
    // they read before the groupings start.
    expect(content).toBe(
      [
        '# Config',
        '',
        '## loose',
        '',
        '**Type:** `string`',
        '',
        '## Properties',
        '',
        'The options.',
        '',
        '### grouped',
        '',
        '**Type:** `string`',
        '',
      ].join('\n'),
    )
  })

  it('renders a prose-only section with its example', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': {
          sections: [
            { id: 'intro', title: 'Minimal config', description: 'Start here.', example: { value: { a: 1 } } },
          ],
        },
      }),
    )
    expect(content).toBe('## Minimal config\n\nStart here.\n\n```json\n{\n  "a": 1\n}\n```\n')
  })

  it('sorts a section alphabetically when it asks for it', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { sections: [{ id: 's', title: 'S', sort: 'alphabetical' }] },
        properties: {
          zebra: { type: 'string', 'x-doc': { section: 's' } },
          apple: { type: 'string', 'x-doc': { section: 's' } },
        },
      }),
    )
    expect(content.indexOf('### apple')).toBeLessThan(content.indexOf('### zebra'))
  })

  it('splits a nested property into its own page', () => {
    const files = generateMarkdownFiles({
      title: 'Configuration',
      'x-doc': {
        file: 'configuration.md',
        layout: 'table',
        pages: [{ id: 'ts', file: 'configuration/typescript.md', title: 'TypeScript' }],
      },
      properties: {
        targets: {
          type: 'object',
          properties: {
            typescript: {
              type: 'object',
              description: 'TypeScript target.',
              'x-doc': { page: 'ts', heading: false },
              properties: { packageName: { type: 'string' } },
            },
            go: { type: 'object', description: 'Go target.' },
          },
        },
      },
    })
    expect(files.map((file) => file.filename)).toEqual(['configuration.md', 'configuration/typescript.md'])
    // The index keeps a row for the moved property, linked across to its page.
    expect(files[0]?.content).toContain(
      '| [`typescript`](configuration/typescript.md) | `object` | TypeScript target. |',
    )
    expect(files[0]?.content).not.toContain('packageName')
    expect(files[1]?.content).toContain('# TypeScript')
    expect(files[1]?.content).toContain('packageName')
  })

  it('keeps a moved property out of the parent when children are headings', () => {
    const files = generateMarkdownFiles({
      'x-doc': { pages: [{ id: 'ts', file: 'ts.md' }] },
      properties: {
        targets: {
          type: 'object',
          properties: {
            typescript: { type: 'object', 'x-doc': { page: 'ts' } },
            go: { type: 'object', description: 'Go target.' },
          },
        },
      },
    })
    expect(files[0]?.content).toContain('### go')
    expect(files[0]?.content).not.toContain('typescript')
    expect(files[1]?.content).toContain('# typescript'.replace('# ', '## '))
  })

  it('keeps a property with its own section out of the parent listing', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { sections: [{ id: 'emitter', title: 'Emitter Options' }] },
        properties: {
          target: {
            type: 'object',
            properties: {
              options: { type: 'object', 'x-doc': { section: 'emitter' }, properties: { a: { type: 'string' } } },
            },
          },
        },
      }),
    )
    expect(content.indexOf('## Emitter Options')).toBeLessThan(content.indexOf('### options'))
    // `options` renders once, in its section — not a second time under `target`.
    expect(content.split('### options')).toHaveLength(2)
  })

  it('inlines $refs before rendering, with the ref site winning on description', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          server: { $ref: '#/$defs/host', description: 'The API server.' },
          fallback: { $ref: '#/$defs/host' },
        },
        $defs: { host: { type: 'string', description: 'A hostname.', examples: ['example.com'] } },
      }),
    )
    expect(content).toContain('## server\n\n**Type:** `string`\n\nThe API server.')
    expect(content).toContain('## fallback\n\n**Type:** `string`\n\nA hostname.')
  })

  it('documents the item shape of an array of objects', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          pagination: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string', examples: ['cursor'] } },
            },
          },
        },
      }),
    )
    expect(content).toContain('**Type:** `object[]`')
    expect(content).toContain('### name')
    // The example is wrapped back into the array it lives in.
    expect(content).toContain('"pagination": [\n    {\n      "name": "cursor"\n    }\n  ]')
  })

  // "Switch it on, or configure it" is how a config schema spells an option with
  // defaults, and the shape lives in the object branch.
  it('documents the object branch of a boolean-or-object property', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          publish: {
            anyOf: [
              { type: 'boolean' },
              { type: 'object', properties: { authMethod: { type: 'string', description: 'How to authenticate.' } } },
            ],
          },
        },
      }),
    )
    expect(content).toContain('**Type:** `boolean | object`')
    expect(content).toContain('### authMethod')
  })

  // The definition documents what is true wherever it is used; the ref site adds
  // where this use is documented. Replacing the whole `x-doc` dropped the first.
  it('merges the x-doc of a $ref site with the definition it points at', () => {
    const files = generateMarkdownFiles({
      'x-doc': { pages: [{ id: 'ts', file: 'ts.md', title: 'TypeScript' }] },
      properties: {
        typescript: { $ref: '#/$defs/target', 'x-doc': { page: 'ts' } },
      },
      $defs: {
        target: {
          type: 'object',
          'x-doc': { heading: false, layout: 'table', example: 'targets.typescript = {}' },
          properties: { packageName: { type: 'string', description: 'Package name.' } },
        },
      },
    })
    const page = files.find((file) => file.filename === 'ts.md')?.content ?? ''
    // `page` came from the ref site, `example` and `layout` from the definition.
    expect(page).toContain('# TypeScript')
    expect(page).toContain('```json\ntargets.typescript = {}\n```')
    expect(page).toContain('| `packageName` | `string` | Package name. |')
  })

  it('lets a $ref site override one x-doc member without losing the rest', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#/$defs/thing', 'x-doc': { title: 'Renamed' } } },
        $defs: { thing: { type: 'string', 'x-doc': { type: 'Thing', note: 'Careful.' } } },
      }),
    )
    expect(content).toContain('## Renamed')
    expect(content).toContain('**Type:** `Thing`')
    expect(content).toContain('> Careful.')
  })

  it('documents the value shape of a map-like object', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          resources: {
            type: 'object',
            additionalProperties: { type: 'object', properties: { path: { type: 'string' } } },
          },
        },
      }),
    )
    expect(content).toContain('### path')
  })

  // Dereferencing collapses the cycle to a stub, so the walk has to end.
  it('terminates on a recursive definition', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { resource: { $ref: '#/$defs/resource' } },
        $defs: {
          resource: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              children: { type: 'object', additionalProperties: { $ref: '#/$defs/resource' } },
            },
          },
        },
      }),
    )
    expect(content).toContain('## resource')
    expect(content).toContain('### children')
  })

  // A property four levels down on a page whose title is `#` would ask for
  // `#######`, which renders as literal hashes rather than a heading.
  it('clamps headings past the deepest one markdown has', () => {
    const deep = (depth: number): Record<string, unknown> =>
      depth === 0 ? { type: 'string' } : { type: 'object', properties: { [`level${depth}`]: deep(depth - 1) } }
    const content = only(generateMarkdownFiles({ title: 'Config', properties: { root: deep(8) } }))
    expect(content).toContain('###### level1')
    expect(content).not.toContain('####### ')
  })

  it('renders nothing but an empty document for a schema that is not an object', () => {
    expect(only(generateMarkdownFiles(null))).toBe('\n')
    expect(only(generateMarkdownFiles('nope'))).toBe('\n')
  })

  it('refuses a property assigned to a page the schema never declared', () => {
    expect(() => generateMarkdownFiles({ properties: { a: { 'x-doc': { page: 'ghost' } } } })).toThrow(/ghost/)
  })

  it('matches the checked-in docs for the API reference fixture', () => {
    const files = generateMarkdownFiles(fixture('api-reference-config'))
    expect(files.map((file) => file.filename)).toEqual(['configuration.md'])
    expect(files[0]?.content).toBe(golden('api-reference-config', 'configuration.md'))
  })

  it('matches the checked-in docs for the multi-file SDK fixture', () => {
    const files = generateMarkdownFiles(fixture('sdk-config'))
    expect(files.map((file) => file.filename)).toEqual([
      'configuration.md',
      'configuration/typescript.md',
      'configuration/python.md',
    ])
    for (const file of files) {
      expect(file.content, file.filename).toBe(golden('sdk-config', file.filename))
    }
  })

  // A golden left behind by a page that no longer exists would otherwise sit
  // there looking like documentation somebody still generates.
  it('generates every golden page that is checked in', () => {
    for (const name of ['api-reference-config', 'sdk-config'] as const) {
      const generated = generateMarkdownFiles(fixture(name))
        .map((file) => file.filename)
        .sort()
      expect(generated, name).toEqual(goldenFiles(name))
    }
  })
})
