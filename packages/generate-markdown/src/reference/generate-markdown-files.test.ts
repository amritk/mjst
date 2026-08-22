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
        '# darkMode',
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
    expect(content).toContain('# spec\n\n> **Deprecated**\n\n**Type:** `object`')
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
        '# a',
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
    expect(content).toContain('# shown')
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
    expect(content).toContain('# server')
    expect(content).toContain('## host')
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
    expect(content).toBe('# Minimal config\n\nStart here.\n\n```json\n{\n  "a": 1\n}\n```\n')
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
    expect(content.indexOf('## apple')).toBeLessThan(content.indexOf('## zebra'))
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
    expect(files[0]?.content).toContain('## go')
    expect(files[0]?.content).not.toContain('typescript')
    // The page declares no title of its own, so the property it holds is the
    // page's top-level heading.
    expect(files[1]?.content).toContain('# typescript')
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
    expect(content.indexOf('# Emitter Options')).toBeLessThan(content.indexOf('## options'))
    // `options` renders once, in its section — not a second time under `target`.
    expect(content.split('## options')).toHaveLength(2)
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
    expect(content).toContain('# server\n\n**Type:** `string`\n\nThe API server.')
    expect(content).toContain('# fallback\n\n**Type:** `string`\n\nA hostname.')
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
    expect(content).toContain('## name')
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
    expect(content).toContain('## authMethod')
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
    expect(content).toContain('# Renamed')
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
    expect(content).toContain('## path')
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
    expect(content).toContain('# resource')
    expect(content).toContain('## children')
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

  // Schema text reaches the metadata labels, and a backtick in it closed the
  // code span — the rest of the value then rendered as live markdown, links and
  // all.
  it('contains a backtick in a default, an enum and a constraint', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          a: { type: 'string', default: 'x`y [pwn](http://evil) **bold**', pattern: 'a`b' },
          b: { enum: ['a`b', 'c'] },
        },
      }),
    )
    expect(content).toContain('**Default:** ``"x`y [pwn](http://evil) **bold**"``')
    expect(content).toContain('**Constraints:** ``pattern: a`b``')
    expect(content).toContain('**Type:** ``"a`b" | "c"``')
  })

  // A line ending in a value ends the paragraph, so the label's code span never
  // forms and the remainder of the value becomes page structure.
  it('collapses a multi-line value into its one-line label', () => {
    const content = only(
      generateMarkdownFiles({ properties: { a: { type: 'string', pattern: 'a\n\n## Injected\n\nb' } } }),
    )
    expect(content).toContain('**Constraints:** `pattern: a ## Injected b`')
    expect(content).not.toContain('\n## Injected')
  })

  // Page and section titles are schema text too, and a heading is one line.
  it('collapses a line ending in a page or section title', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { title: 'My Title\n\n## Injected', sections: [{ id: 's', title: 'Sec\n# ROGUE' }] },
        properties: {},
      }),
    )
    expect(content).toContain('# My Title ## Injected')
    expect(content).toContain('## Sec # ROGUE')
    expect(content.split('\n').filter((line) => line.startsWith('#'))).toHaveLength(2)
  })

  // The info string is schema-controlled: a line ending in it closed the fence
  // on the next line and spilled the sample onto the page.
  it('sanitises the fence language', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { 'x-doc': { example: { language: 'json\n```\n## Injected', code: 'x' } } } },
      }),
    )
    expect(content).toContain('```json\nx\n```')
    expect(content).not.toContain('## Injected')
  })

  it('escapes a backtick and a pipe in a table cell', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          outer: {
            type: 'object',
            properties: { 'a`b': { type: 'string', description: 'x' }, 'c|d': { type: 'string', description: 'y' } },
          },
        },
      }),
    )
    expect(content).toContain('| ``a`b`` | `string` | x |')
    expect(content).toContain('| `c\\|d` | `string` | y |')
  })

  // An author writes `\|` for a literal pipe; escaping the pipe without escaping
  // the backslash first turned it into a real column break, and the rest of the
  // cell fell off the end of the table.
  it('keeps an escaped pipe inside a description in its own cell', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          outer: { type: 'object', properties: { a: { type: 'string', description: 'either a\\|b or c' } } },
        },
      }),
    )
    expect(content).toContain('| `a` | `string` | either a\\\\\\|b or c |')
  })

  // A destination with a space stopped being a link at all; one with a `)`
  // closed the destination early and everything after it became a second link.
  it('percent-encodes a cross-page link destination', () => {
    const files = generateMarkdownFiles({
      'x-doc': { layout: 'table', pages: [{ id: 'other', file: 'my docs (v2).md', title: 'O' }] },
      properties: { outer: { type: 'object', properties: { a: { type: 'string', 'x-doc': { page: 'other' } } } } },
    })
    expect(files[0]?.content).toContain('[`a`](my%20docs%20%28v2%29.md)')
  })

  it('marks a deprecated property that renders without a heading', () => {
    const content = only(
      generateMarkdownFiles({ properties: { a: { type: 'object', deprecated: true, 'x-doc': { heading: false } } } }),
    )
    expect(content).toContain('> **Deprecated**')
  })

  // Without a heading there is no **Type:** label, so the enum has nowhere else
  // to appear.
  it('lists allowed values for a property that renders without a heading', () => {
    const content = only(
      generateMarkdownFiles({ properties: { a: { enum: ['json', 'yaml'], 'x-doc': { heading: false } } } }),
    )
    expect(content).toContain('**Allowed values:** `"json"`, `"yaml"`')
  })

  // `allOf` branches all apply at once — taking only the first dropped whichever
  // half the author wrote second, which is the OpenAPI inheritance idiom.
  it('merges every allOf branch into the child list', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          server: {
            allOf: [
              { properties: { host: { type: 'string' } }, required: ['host'] },
              { properties: { port: { type: 'number' } } },
            ],
          },
        },
      }),
    )
    expect(content).toContain('## host')
    expect(content).toContain('## port')
    expect(content).toContain('**Required**')
  })

  it('documents an alternative branch without marking its fields required', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          auth: {
            anyOf: [
              { properties: { token: { type: 'string' } }, required: ['token'] },
              { properties: { user: { type: 'string' } }, required: ['user'] },
            ],
          },
        },
      }),
    )
    expect(content).toContain('## token')
    expect(content).toContain('## user')
    expect(content).not.toContain('**Required**')
  })

  it('documents properties a conditional or a dependent schema adds', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          a: {
            type: 'object',
            properties: { kind: { enum: ['x'] } },
            then: { properties: { onlyForX: { type: 'string', description: 'Conditional.' } } },
            dependentSchemas: { kind: { properties: { alsoNeeded: { type: 'string' } } } },
          },
        },
      }),
    )
    expect(content).toContain('## onlyForX')
    expect(content).toContain('## alsoNeeded')
  })

  it('looks through a union under additionalProperties', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          routes: {
            type: 'object',
            additionalProperties: { anyOf: [{ type: 'object', properties: { path: { type: 'string' } } }] },
          },
        },
      }),
    )
    expect(content).toContain('## path')
  })

  it('documents every position of a tuple', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'object', properties: { b: {} } }] },
        },
      }),
    )
    expect(content).toContain('## b')
  })

  // A table row can say a child is an object; it cannot say what is in it.
  it('renders a table for a grandchild that a row cannot describe', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          a: {
            type: 'object',
            properties: {
              b: { type: 'object', description: 'B.', properties: { c: { type: 'string', description: 'C.' } } },
            },
          },
        },
      }),
    )
    expect(content).toContain('| `b` | `object` | B. |')
    expect(content).toContain('| `c` | `string` | C. |')
  })

  it('wraps a map value example in a placeholder key', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          envs: {
            type: 'object',
            additionalProperties: { type: 'object', properties: { url: { type: 'string', examples: ['https://x'] } } },
          },
        },
      }),
    )
    expect(content).toContain('"envs": {\n    "<name>": {\n      "url": "https://x"\n    }\n  }')
  })

  it('documents a map-like root, which has no named properties at all', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'M',
        type: 'object',
        additionalProperties: { type: 'object', properties: { a: { type: 'string', description: 'the a' } } },
      }),
    )
    expect(content).toContain('## a')
    expect(content).toContain('the a')
  })

  // The definition describes the definition; a ref site describing *this* use
  // must win, or two properties sharing a definition print the same sentence.
  it('lets a ref site description beat the definition x-doc description', () => {
    const content = only(
      generateMarkdownFiles({
        $defs: { server: { type: 'string', 'x-doc': { description: 'Shared prose.' } } },
        properties: {
          primary: { $ref: '#/$defs/server', description: 'The primary server.' },
          fallback: { $ref: '#/$defs/server' },
        },
      }),
    )
    expect(content).toContain('The primary server.')
    expect(content).toContain('Shared prose.')
  })

  // The ref site says where *this* use is documented, so it wins the keys it sets.
  it('lets the ref site win the x-doc keys it sets', () => {
    const files = generateMarkdownFiles({
      'x-doc': { pages: [{ id: 'ts', file: 'ts.md' }] },
      $defs: { target: { type: 'object', 'x-doc': { page: 'index', title: 'DefTitle' } } },
      properties: { a: { $ref: '#/$defs/target', 'x-doc': { page: 'ts' } } },
    })
    expect(files.find((file) => file.filename === 'ts.md')?.content).toContain('DefTitle')
    expect(files[0]?.content).not.toContain('DefTitle')
  })

  it('merges the properties a $ref site adds with the definition own', () => {
    const content = only(
      generateMarkdownFiles({
        $defs: { base: { properties: { bar: { type: 'string', description: 'from base' } } } },
        properties: { a: { $ref: '#/$defs/base', properties: { foo: { type: 'string' } } } },
      }),
    )
    expect(content).toContain('## bar')
    expect(content).toContain('## foo')
  })

  // Flattening has to happen after inlining, or a root that reaches its branches
  // through a $ref has nothing to flatten and renders as a bare title.
  it('flattens a root branch that is behind a $ref', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'R',
        anyOf: [{ $ref: '#/$defs/branch' }],
        $defs: { branch: { properties: { a: { type: 'string', description: 'A.' } } } },
      }),
    )
    expect(content).toContain('## a')
  })

  it('refuses two pages whose files differ only by a . segment', () => {
    expect(() =>
      generateMarkdownFiles({
        'x-doc': {
          pages: [
            { id: 'i', file: 'a.md' },
            { id: 'p2', file: './a.md' },
          ],
        },
        properties: {},
      }),
    ).toThrow(/Two pages are both written to "a.md"/)
  })

  it('refuses two pages that share an id', () => {
    expect(() =>
      generateMarkdownFiles({
        'x-doc': {
          pages: [
            { id: 'x', file: 'a.md' },
            { id: 'x', file: 'b.md' },
          ],
        },
        properties: {},
      }),
    ).toThrow(/share the id "x"/)
  })

  // Declaring the index page to give it a file or a title must not discard the
  // examples the root already carried.
  it('keeps the root example when the index page is declared', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'R',
        'x-doc': { example: { value: { a: 1 } }, pages: [{ id: 'index', file: 'index.md', title: 'C' }] },
        properties: { a: { type: 'number' } },
      }),
    )
    expect(content).toContain('```json')
  })

  // An untitled page has no `#` for its properties to sit under.
  it('starts an untitled page at the top heading level', () => {
    expect(only(generateMarkdownFiles({ properties: { a: { type: 'string' } } }))).toBe('# a\n\n**Type:** `string`\n')
  })

  // A property nested past the scan cap used to vanish from every file with no
  // error — the silent omission the placement errors exist to prevent.
  it('documents a page assignment nested far below the root', () => {
    const nest = (depth: number): Record<string, unknown> =>
      depth === 0
        ? { type: 'string', 'x-doc': { page: 'other' }, description: 'THE LEAF' }
        : { type: 'object', properties: { level: nest(depth - 1) } }
    const files = generateMarkdownFiles({
      'x-doc': { pages: [{ id: 'other', file: 'other.md', title: 'Other' }] },
      properties: { root: nest(40) },
    })
    expect(files.some((file) => file.content.includes('THE LEAF'))).toBe(true)
  })

  // A ref-free schema is bounded by depth, not by the node budget, and used to
  // die with a bare RangeError naming nothing.
  it('refuses a schema nested past what can be read as documentation', () => {
    const deep = (levels: number): Record<string, unknown> =>
      levels === 0 ? { type: 'string' } : { type: 'object', properties: { child: deep(levels - 1) } }
    expect(() => generateMarkdownFiles({ properties: { root: deep(2000) } })).toThrow(/nests more than/)
  })

  // The check is `page !== context.page`, not "has a page": a property naming
  // the page it already sits on still belongs under its parent, and dropping
  // the comparison made it vanish from every file.
  it('inlines a child that names the page it is already on', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'C',
        properties: {
          theme: {
            type: 'object',
            properties: { color: { type: 'string', description: 'The colour.', 'x-doc': { page: 'index' } } },
          },
        },
      }),
    )
    expect(content).toContain('### color')
    expect(content).toContain('The colour.')
  })

  // RFC 6901: `~1` is a `/` in a definition name, `~0` a `~`.
  it('resolves a pointer through an escaped definition name', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#/$defs/a~1b' } },
        $defs: { 'a/b': { type: 'string', description: 'Escaped name.' } },
      }),
    )
    expect(content).toContain('Escaped name.')
  })

  // OpenAPI 3.0 spells it `example`; a $ref-shaped value under it is a documented
  // value, not a reference to follow.
  it('leaves a ref-shaped value under example alone', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { type: 'object', 'x-doc': { example: { value: { $ref: '#/components/schemas/User' } } } } },
        $defs: { anything: { type: 'string' } },
      }),
    )
    expect(content).toContain('"$ref": "#/components/schemas/User"')
  })

  it('refuses a pointer segment that is not an array index', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#/$defs/t/anyOf/1.0' } },
        $defs: { t: { anyOf: [{ type: 'string' }, { type: 'number', description: 'WRONG BRANCH' }] } },
      }),
    )
    expect(content).not.toContain('WRONG BRANCH')
  })

  // The merge exists to carry the definition's documentation through; a
  // malformed x-doc at the ref site must not be able to erase it.
  it('ignores a malformed x-doc at the ref site', () => {
    const content = only(
      generateMarkdownFiles({
        $defs: { s: { type: 'string', 'x-doc': { example: 'FROM THE DEFINITION' } } },
        properties: { a: { $ref: '#/$defs/s', 'x-doc': [] } },
      }),
    )
    expect(content).toContain('FROM THE DEFINITION')
  })

  // The documented block order, at the one boundary no other test pins.
  it('puts constraints above the notes', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { type: 'string', minLength: 1, 'x-doc': { note: 'A note.' } } },
      }),
    )
    expect(content.indexOf('**Constraints:**')).toBeLessThan(content.indexOf('> A note.'))
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
