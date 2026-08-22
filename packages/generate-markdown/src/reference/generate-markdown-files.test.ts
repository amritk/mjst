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

/**
 * One property's block: from its heading to the next heading at the same level
 * or above.
 *
 * Slicing to the end of the document instead is how three assertions ended up
 * proving nothing — a `**Required**` marker belonging to a later sibling
 * satisfied every one of them.
 */
const section = (content: string, heading: string): string => {
  const start = content.indexOf(heading)
  expect(start, `no heading ${heading}`).toBeGreaterThanOrEqual(0)
  const level = (/^#+/.exec(heading) ?? [''])[0].length
  const rest = content.slice(start + heading.length)
  const next = new RegExp(`^#{1,${level}} `, 'm').exec(rest)
  return heading + (next === null ? rest : rest.slice(0, next.index))
}

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
    // The page declares no title of its own, so the property it holds is the
    // page's top-level heading.
    expect(files[1]?.content).toContain('## typescript')
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
    expect(content).toContain('| `a` | `string` | either a\\|b or c |')
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
    expect(content).toContain('### host')
    expect(content).toContain('### port')
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
    expect(content).toContain('### token')
    expect(content).toContain('### user')
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
    expect(content).toContain('### onlyForX')
    expect(content).toContain('### alsoNeeded')
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
    expect(content).toContain('### path')
  })

  it('documents every position of a tuple', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'object', properties: { b: {} } }] },
        },
      }),
    )
    expect(content).toContain('### b')
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
    expect(content).toContain('### bar')
    expect(content).toContain('### foo')
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

  // A page holds one top-level heading: its title. Promoting properties when a
  // schema declares no title gave a twelve-option config twelve `#` headings,
  // which every linter counts as an error and a docs site reads as twelve
  // pages. A schema that wants that heading gives itself a `title`.
  it('keeps one top-level heading per page, titled or not', () => {
    expect(only(generateMarkdownFiles({ properties: { a: { type: 'string' } } }))).toBe('## a\n\n**Type:** `string`\n')
    const titled = only(generateMarkdownFiles({ title: 'C', properties: { a: { type: 'string' }, b: {} } }))
    expect(titled.split('\n').filter((line) => /^# /.test(line))).toHaveLength(1)
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

  // Composition nests: an `allOf` of `anyOf`s, a $ref'd base that itself
  // composes. Following it only one level down loses everything below.
  it('follows composition nested several levels deep', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          a: {
            allOf: [
              { allOf: [{ properties: { deep: { type: 'string', description: 'Two levels down.' } } }] },
              { anyOf: [{ allOf: [{ properties: { deeper: { type: 'string' } } }] }] },
            ],
          },
        },
      }),
    )
    expect(content).toContain('### deep')
    expect(content).toContain('### deeper')
  })

  // The container keyword can sit inside the union rather than on the node.
  it('finds a container that only a union branch declares', () => {
    const items = only(
      generateMarkdownFiles({
        properties: {
          list: {
            anyOf: [{ type: 'string' }, { type: 'array', items: { properties: { inner: { type: 'string' } } } }],
          },
        },
      }),
    )
    expect(items).toContain('### inner')

    const map = only(
      generateMarkdownFiles({
        properties: {
          bag: {
            anyOf: [
              { type: 'boolean' },
              { type: 'object', additionalProperties: { properties: { v: { type: 'string' } } } },
            ],
          },
        },
      }),
    )
    expect(map).toContain('### v')
  })

  it('reads a pattern-keyed map value shape', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          env: { type: 'object', patternProperties: { '^[A-Z]+$': { properties: { value: { type: 'string' } } } } },
        },
      }),
    )
    expect(content).toContain('### value')
  })

  // Two of three alternatives requiring a field does not make it required.
  it('requires a field only when all three alternatives require it', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          a: {
            anyOf: [
              { properties: { all: {}, most: {} }, required: ['all', 'most'] },
              { properties: { all: {}, most: {} }, required: ['all', 'most'] },
              { properties: { all: {}, most: {} }, required: ['all'] },
            ],
          },
        },
      }),
    )
    expect(section(content, '### all')).toContain('**Required**')
    expect(section(content, '### most')).not.toContain('**Required**')
  })

  // A single alternative is not an alternative: its requirements stand.
  it('keeps the requirements of a lone anyOf branch', () => {
    const content = only(
      generateMarkdownFiles({ properties: { a: { anyOf: [{ properties: { x: {} }, required: ['x'] }] } } }),
    )
    expect(content).toContain('**Required**')
  })

  // Both halves of the applicator merge are load-bearing.
  it('keeps the definition required list when the ref site adds its own', () => {
    const content = only(
      generateMarkdownFiles({
        $defs: { base: { properties: { fromBase: {} }, required: ['fromBase'] } },
        properties: {
          a: { $ref: '#/$defs/base', properties: { fromSite: {} }, required: ['fromSite'] },
        },
      }),
    )
    expect(content.match(/\*\*Required\*\*/g)).toHaveLength(2)
  })

  it('lets the ref site win a property the definition also declares', () => {
    const content = only(
      generateMarkdownFiles({
        $defs: { base: { properties: { shared: { type: 'string', description: 'FROM THE DEFINITION' } } } },
        properties: {
          a: { $ref: '#/$defs/base', properties: { shared: { type: 'string', description: 'FROM THE REF SITE' } } },
        },
      }),
    )
    expect(content).toContain('FROM THE REF SITE')
    expect(content).not.toContain('FROM THE DEFINITION')
  })

  // A node that declares both named properties and a container documents both,
  // its own names first — and the named ones must not gain the container's
  // map-key hop in their derived examples.
  it('lists a node own properties before its container ones', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          a: {
            type: 'object',
            properties: { named: { type: 'string', examples: ['v'] } },
            additionalProperties: { properties: { extra: { type: 'string' } } },
          },
        },
      }),
    )
    expect(content.indexOf('### named')).toBeLessThan(content.indexOf('### extra'))
    expect(content).toContain('"a": {\n    "named": "v"\n  }')
  })

  // Two sources describing one name are describing one field, and the node's
  // own declaration is the one that wins.
  it('documents a name two sources share once, from the first of them', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          a: {
            type: 'object',
            properties: { shared: { type: 'string', description: 'FROM THE NODE' } },
            additionalProperties: { properties: { shared: { type: 'string', description: 'FROM THE MAP' } } },
          },
        },
      }),
    )
    expect(content.match(/### shared/g)).toHaveLength(1)
    expect(content).toContain('FROM THE NODE')
    expect(content).not.toContain('FROM THE MAP')
  })

  // RFC 6901 array indices have no leading zeros, so `01` addresses nothing.
  it('refuses a non-canonical array index in a pointer', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#/$defs/t/anyOf/01' } },
        $defs: { t: { anyOf: [{ type: 'string' }, { type: 'number', description: 'WRONG BRANCH' }] } },
      }),
    )
    expect(content).not.toContain('WRONG BRANCH')
  })

  // A code span's content is literal, so escaping a backslash would show it.
  it('leaves a backslash alone inside a table code cell', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          outer: { type: 'object', properties: { a: { type: 'string', default: 'C:\\path' } } },
        },
      }),
    )
    expect(content).toContain('`"C:\\\\path"`')
    expect(content).not.toContain('\\\\\\\\path')
  })

  // A description cell is parsed as inline markdown, so `\*` is how an author
  // writes a literal asterisk. Escaping the backslash turned the asterisks into
  // emphasis and showed the reader a stray backslash.
  it('leaves an author markdown escape intact in a table cell', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          s: { type: 'object', properties: { pat: { type: 'string', description: 'Literal \\*stars\\* here.' } } },
        },
      }),
    )
    expect(content).toContain('| `pat` | `string` | Literal \\*stars\\* here. |')
  })

  // `string | { … }` is the other half of the union idiom: the scalar branch
  // declares nothing, and letting its empty requirement set into the
  // intersection stripped the markers off every field of the object form.
  it('keeps the requirements of the object form of a scalar-or-object union', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          logo: {
            anyOf: [
              { type: 'string' },
              { type: 'object', properties: { darkMode: {}, lightMode: {} }, required: ['darkMode', 'lightMode'] },
            ],
          },
        },
      }),
    )
    expect(content.match(/\*\*Required\*\*/g)).toHaveLength(2)
  })

  // Every position of a tuple is a different shape.
  it('documents every position of a tuple, not just the first', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          pair: {
            type: 'array',
            prefixItems: [
              { type: 'object', properties: { first: { type: 'string' } } },
              { type: 'object', properties: { second: { type: 'string' } } },
            ],
          },
        },
      }),
    )
    expect(content).toContain('### first')
    expect(content).toContain('### second')
  })

  it('documents known fields and the shape of the custom ones', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          theme: {
            type: 'object',
            properties: { known: { type: 'string' } },
            additionalProperties: { type: 'object', properties: { custom: { type: 'string' } } },
          },
        },
      }),
    )
    expect(content).toContain('### known')
    expect(content).toContain('### custom')
  })

  it('documents the value shape of every pattern a map is keyed by', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          env: {
            type: 'object',
            patternProperties: { '^A$': { properties: { fromA: {} } }, '^B$': { properties: { fromB: {} } } },
          },
        },
      }),
    )
    expect(content).toContain('### fromA')
    expect(content).toContain('### fromB')
  })

  // CommonMark counts a bare CR as a line ending, so a note holding one escaped
  // its blockquote and the rest became page structure.
  it('keeps a note with a bare carriage return inside its blockquote', () => {
    const content = only(
      generateMarkdownFiles({ properties: { a: { type: 'string', 'x-doc': { note: 'safe\r## INJECTED' } } } }),
    )
    expect(content).toContain('> safe\n> ## INJECTED')
    expect(content).not.toContain('\r')
  })

  it('collapses a line ending in an example caption', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { type: 'string', 'x-doc': { example: { code: 'x', caption: 'cap\n## INJECTED' } } } },
      }),
    )
    expect(content).toContain('cap ## INJECTED')
    expect(content).not.toContain('\n## INJECTED')
  })

  // A property that keeps its name and loses its type, its prose and its whole
  // subtree looks documented and is not.
  it('resolves a reference to an $anchor', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#node' } },
        $defs: {
          node: {
            $anchor: 'node',
            type: 'object',
            description: 'the node',
            properties: { anchored: { type: 'string' } },
          },
        },
      }),
    )
    expect(content).toContain('the node')
    expect(content).toContain('### anchored')
  })

  it('refuses a page that climbs out of the output directory and back in', () => {
    expect(() =>
      generateMarkdownFiles({
        'x-doc': {
          file: 'index.md',
          pages: [
            { id: 'one', file: 'a.md' },
            { id: 'two', file: '../out/a.md' },
          ],
        },
        properties: {},
      }),
    ).toThrow(/outside the output directory/)
  })

  it('refuses a page whose path names no file', () => {
    expect(() => generateMarkdownFiles({ 'x-doc': { pages: [{ id: 'p', file: '.' }] }, properties: {} })).toThrow(
      /no file to be written to/,
    )
  })

  it('refuses two sections that share an id', () => {
    expect(() =>
      generateMarkdownFiles({
        'x-doc': {
          sections: [
            { id: 's', title: 'One' },
            { id: 's', title: 'Two' },
          ],
        },
        properties: { a: { type: 'string', 'x-doc': { section: 's' } } },
      }),
    ).toThrow(/Two sections share the id "s"/)
  })

  // The row above states the type, the requiredness and the default; the block
  // below adds only what a row cannot hold.
  it('does not repeat a table row in the block beneath it', () => {
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
    expect(content.match(/B\./g)).toHaveLength(1)
    expect(content).toContain('| `c` | `string` | C. |')
  })

  // The row above carries the shape; everything a row cannot hold still has to
  // be here, or a table layout quietly loses half of what the schema says.
  it('keeps everything a table row cannot hold in the block beneath it', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          outer: {
            type: 'object',
            properties: {
              child: {
                type: 'object',
                deprecated: true,
                default: { a: 1 },
                enum: [{ a: 1 }, { a: 2 }],
                minProperties: 1,
                pattern: '^x$',
                'x-doc': { type: 'ChildShape', note: 'A note.', example: 'child = {}', footer: 'Afterwards.' },
                properties: { leaf: { type: 'string', description: 'Leaf.' } },
              },
            },
          },
        },
      }),
    )
    // In the row, not repeated below it.
    expect(content).toContain('| `child` | `ChildShape` | `{"a": 1}` |')
    expect(content.match(/\*\*Default:\*\*/g)).toBeNull()
    // Below the row, because no row could carry them.
    expect(content).toContain('> **Deprecated**')
    expect(content).toContain('**Allowed values:**')
    expect(content).toContain('**Constraints:** `pattern: ^x$`')
    expect(content).toContain('> A note.')
    expect(content).toContain('```json\nchild = {}\n```')
    expect(content).toContain('Afterwards.')
    expect(content).toContain('| `leaf` | `string` | Leaf. |')
  })

  // `$anchor` is most often declared inside a composition branch, which is an
  // array — a walk that only stepped into objects never found it.
  it('resolves an $anchor declared inside a composition branch', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#inner' } },
        $defs: {
          wrapper: {
            anyOf: [
              { type: 'null' },
              { $anchor: 'inner', type: 'object', properties: { anchored: { type: 'string' } } },
            ],
          },
        },
      }),
    )
    expect(content).toContain('### anchored')
  })

  it('resolves a $dynamicAnchor by name too', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#node' } },
        $defs: { node: { $dynamicAnchor: 'node', type: 'string', description: 'Dynamic.' } },
      }),
    )
    expect(content).toContain('Dynamic.')
  })

  it('accepts the punctuation an anchor name may hold', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#my.anchor-name_2' } },
        $defs: { node: { $anchor: 'my.anchor-name_2', type: 'string', description: 'Punctuated.' } },
      }),
    )
    expect(content).toContain('Punctuated.')
  })

  // An anchor name never starts with a digit, so `#0` is not one — and treating
  // it as one would resolve it against an unrelated node.
  it('does not read a fragment starting with a digit as an anchor', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#0' } },
        $defs: { node: { $anchor: '0', type: 'string', description: 'WRONG TARGET' } },
      }),
    )
    expect(content).not.toContain('WRONG TARGET')
  })

  it('documents every position of a draft-07 tuple', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          pair: {
            type: 'array',
            items: [
              { type: 'object', properties: { firstItem: { type: 'string' } } },
              { type: 'object', properties: { secondItem: { type: 'string' } } },
            ],
          },
        },
      }),
    )
    expect(content).toContain('### firstItem')
    expect(content).toContain('### secondItem')
  })

  it('finds a container an allOf or a oneOf branch declares', () => {
    const viaAllOf = only(
      generateMarkdownFiles({
        properties: { a: { allOf: [{ type: 'array', items: { properties: { fromAllOf: {} } } }] } },
      }),
    )
    expect(viaAllOf).toContain('### fromAllOf')

    const viaOneOf = only(
      generateMarkdownFiles({
        properties: { a: { oneOf: [{ type: 'object', additionalProperties: { properties: { fromOneOf: {} } } }] } },
      }),
    )
    expect(viaOneOf).toContain('### fromOneOf')
  })

  it('documents the properties an else branch adds', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          a: {
            type: 'object',
            properties: { kind: { enum: ['x'] } },
            else: { properties: { otherwiseNeeded: { type: 'string' } } },
          },
        },
      }),
    )
    expect(content).toContain('### otherwiseNeeded')
  })

  it('refuses an absolute page file and a bare parent segment', () => {
    for (const file of ['/etc/passwd.md', '..']) {
      expect(() => generateMarkdownFiles({ 'x-doc': { pages: [{ id: 'p', file }] }, properties: {} })).toThrow(
        /outside the output directory|no file to be written to/,
      )
    }
  })

  // Every JavaScript markdown renderer treats U+2028 and U+2029 as line
  // terminators, so one in a title left the page with no heading and one in a
  // description dropped the whole table body out of its table.
  it('collapses the line separators only a JavaScript renderer sees', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'Config\u2028Reference',
        'x-doc': { layout: 'table' },
        properties: {
          server: {
            type: 'object',
            properties: {
              host: { type: 'string', description: 'Hostname.\u2029Use 0.0.0.0.' },
              port: { type: 'integer', description: 'Port.' },
            },
          },
        },
      }),
    )
    expect(content).toContain('# Config Reference')
    expect(content).toContain('| `host` | `string` | Hostname. Use 0.0.0.0. |')
    expect(content).not.toContain('\u2028')
    expect(content).not.toContain('\u2029')
  })

  // `#` is the empty JSON pointer — the document itself — and the spelling every
  // self-recursive schema uses. The walk is already inside that document, so the
  // reference collapses the way any repeated one does: the type still says what
  // the entries are, and the fields are documented once, at the top.
  it('reads a bare fragment as a reference to the document', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'Menu',
        type: 'object',
        required: ['label'],
        properties: {
          label: { type: 'string', description: 'Text shown in the menu.' },
          children: { type: 'array', description: 'Nested entries.', items: { $ref: '#' } },
        },
      }),
    )
    expect(content).toContain('**Type:** `object[]`')
    expect(content.match(/## label/g)).toHaveLength(1)
    expect(content).toContain('Text shown in the menu.')
  })

  // The root expanded one extra time, so a property assigned to a page was
  // documented on it twice — same heading, same anchor.
  it('documents a page-assigned property once when the schema references itself', () => {
    const files = generateMarkdownFiles({
      'x-doc': { pages: [{ id: 'extra', file: 'extra.md', title: 'Extra' }] },
      properties: {
        settings: { type: 'object', 'x-doc': { page: 'extra' }, properties: { deep: { type: 'string' } } },
        children: { type: 'array', items: { $ref: '#' } },
      },
    })
    const extra = files.find((file) => file.filename === 'extra.md')?.content ?? ''
    expect(extra.match(/## settings/g)).toHaveLength(1)
  })

  // "A map of strings, or this exact pair" — a document taking the free-form
  // half has none of the other half's fields, so neither is required.
  it('lets a branch with no named fields keep the alternative optional', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          headers: {
            oneOf: [
              { type: 'object', additionalProperties: { type: 'string' } },
              { type: 'object', properties: { name: {}, value: {} }, required: ['name', 'value'] },
            ],
          },
        },
      }),
    )
    expect(content).not.toContain('**Required**')
  })

  // The row holds one paragraph and skips a `null` default, so neither the rest
  // of the prose nor that default is a restatement of it.
  it('keeps the prose and the null default a table row could not hold', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          server: {
            type: 'object',
            properties: {
              tls: {
                type: 'object',
                default: null,
                description: 'TLS settings.\n\nCertificates are read once at start-up.',
                properties: { verify: { type: 'boolean' } },
              },
            },
          },
        },
      }),
    )
    expect(content).toContain('| `tls` | `object` | TLS settings. |')
    expect(content).toContain('Certificates are read once at start-up.')
    expect(content).toContain('**Default:** `null`')
    // The first paragraph is in the row and is not repeated below it.
    expect(content.match(/TLS settings\./g)).toHaveLength(1)
  })

  // The positions before it are other shapes with their own requirements, so a
  // sample of this one alone would not validate.
  it('derives no example for a tuple position past the first', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          window: {
            type: 'array',
            prefixItems: [
              {
                type: 'object',
                required: ['from'],
                properties: { from: { type: 'string', examples: ['2020-01-01'] } },
              },
              { type: 'object', required: ['to'], properties: { to: { type: 'string', examples: ['2020-12-31'] } } },
            ],
          },
        },
      }),
    )
    expect(content).toContain('### from')
    expect(content).toContain('"window": [\n    {\n      "from": "2020-01-01"\n    }\n  ]')
    // Position one still shows its value — inline, where nothing claims it is a
    // config you can paste.
    expect(content).toContain('### to')
    expect(content).toContain('**Examples:** `"2020-12-31"`')
    expect(content.match(/```json/g)).toHaveLength(1)
  })

  // A sample that happens to hold an `$anchor` key is data, not a definition.
  it('does not resolve an $anchor that lives inside sample data', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          presets: { type: 'object', default: { $anchor: 'target', description: 'NOT A SCHEMA' } },
          build: { $ref: '#target', description: 'The build target.' },
        },
        $defs: {
          target: {
            $anchor: 'target',
            type: 'object',
            properties: { name: { type: 'string', description: 'Target name.' } },
          },
        },
      }),
    )
    expect(content).toContain('Target name.')
    // The sample value still renders as the property's default; what must not
    // happen is `build` resolving to it.
    expect(content).toContain('### name')
  })

  // An inheritance hierarchy reaches fourteen levels without trying, and the
  // old cap dropped everything below twelve with no error and no gap.
  it('follows a long allOf chain to its innermost fields', () => {
    const chain: Record<string, unknown> = {}
    for (let level = 0; level < 14; level++) chain[`L${level}`] = { allOf: [{ $ref: `#/$defs/L${level + 1}` }] }
    chain['L14'] = { properties: { deepest: { type: 'string', description: 'The innermost field.' } } }
    const content = only(generateMarkdownFiles({ properties: { thing: { $ref: '#/$defs/L0' } }, $defs: chain }))
    expect(content).toContain('The innermost field.')
  })

  // `..extra.md` lives right where it says it does; only a `..` segment escapes.
  it('allows a page file whose name merely begins with dots', () => {
    const files = generateMarkdownFiles({
      'x-doc': { pages: [{ id: 'extra', file: '..extra.md', title: 'Extra' }] },
      properties: { a: { type: 'string', 'x-doc': { page: 'extra' } } },
    })
    expect(files.map((file) => file.filename)).toContain('..extra.md')
  })

  // A blank line inside a fence is part of the sample, not a paragraph break.
  // Splitting on it took the fence apart: one half was dropped and the other
  // opened a fence that swallowed the rest of the page.
  it('does not cut a fenced block in a description in half', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          s: {
            type: 'object',
            properties: {
              theme: {
                type: 'object',
                description: 'Theme settings.\nExample:\n```json\n{\n  "dark": true,\n\n  "accent": "red"\n}\n```',
                properties: { dark: { type: 'boolean', description: 'Dark.' } },
              },
            },
          },
        },
      }),
    )
    // The whole sample stays in the cell it belongs to. Counting fences proves
    // nothing — cut or uncut there are two runs of backticks; what matters is
    // that neither half leaked out of the row into the page.
    const row = content.split('\n').find((line) => line.startsWith('| `theme`')) ?? ''
    expect(row).toContain('"dark": true')
    expect(row).toContain('"accent": "red"')
    expect(content).toContain('| `dark` | `boolean` | Dark. |')
    expect(content.split('\n').filter((line) => /^\s*```/.test(line))).toHaveLength(0)
  })

  // A leaf option has no children, and everything else it carries had nowhere
  // else to go.
  it('keeps a childless property deprecation, constraints and notes under a table', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          server: {
            type: 'object',
            properties: {
              port: {
                type: 'integer',
                deprecated: true,
                minimum: 1,
                description: 'Port.\n\nUse `listen` instead.',
                'x-doc': { notes: ['Removed in v3.'] },
              },
            },
          },
        },
      }),
    )
    expect(content).toContain('| `port` | `integer` | Port. |')
    expect(content).toContain('> **Deprecated**')
    expect(content).toContain('Use `listen` instead.')
    expect(content).toContain('**Constraints:** `minimum: 1`')
    expect(content).toContain('> Removed in v3.')
  })

  // A derived example is this package's convenience; under a row it would give
  // every leaf in a table a heading and a fence.
  it('does not derive an example for a leaf beneath a table row', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          server: { type: 'object', properties: { host: { type: 'string', examples: ['example.com'] } } },
        },
      }),
    )
    expect(content).not.toContain('```json')

    const authored = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          server: {
            type: 'object',
            properties: { host: { type: 'string', 'x-doc': { example: 'host = "example.com"' } } },
          },
        },
      }),
    )
    expect(authored).toContain('host = "example.com"')
  })

  // A definition named `example` is a definition: the keys of a `$defs` map are
  // author-chosen names, not keywords.
  it('resolves an $anchor on a definition whose name is a data keyword', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { sample: { $ref: '#ex', description: 'The sample.' } },
        $defs: {
          example: { $anchor: 'ex', type: 'object', properties: { id: { type: 'string', description: 'Sample id.' } } },
        },
      }),
    )
    expect(content).toContain('Sample id.')
  })

  it('reads the other spelling of the empty pointer too', () => {
    const files = generateMarkdownFiles({
      title: 'Menu',
      'x-doc': { pages: [{ id: 'extra', file: 'extra.md', title: 'Extra' }] },
      properties: {
        settings: { type: 'object', 'x-doc': { page: 'extra' }, properties: { deep: { type: 'string' } } },
        children: { type: 'array', items: { $ref: '#/' } },
      },
    })
    expect(files[0]?.content).toContain('**Type:** `object[]`')
    // Like `#`, it is a reference to the document the walk is already inside.
    const extra = files.find((file) => file.filename === 'extra.md')?.content ?? ''
    expect(extra.match(/## settings/g)).toHaveLength(1)
  })

  // A `$defs` map whose key is a keyword name is still a map of definitions.
  it('inlines a definition whose name collides with a keyword', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { $ref: '#/$defs/default' } },
        $defs: { default: { type: 'string', description: 'A definition named default.' } },
      }),
    )
    expect(content).toContain('A definition named default.')
  })

  // `const` and `enum` hold documented values, so a $ref-shaped one is data.
  it('leaves a ref-shaped value under const alone', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { const: { $ref: '#/$defs/other' }, description: 'A constant.' } },
        $defs: { other: { type: 'string', description: 'WRONG' } },
      }),
    )
    expect(content).toContain(
      '"$ref": "#/components/schemas/User"'.replace('#/components/schemas/User', '#/$defs/other'),
    )
    expect(content).not.toContain('WRONG')
  })

  it('prints a null default in a row when another row fills the column', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          s: {
            type: 'object',
            properties: { a: { type: 'string', default: null }, b: { type: 'string', default: 'x' } },
          },
        },
      }),
    )
    // The column exists because `b` fills it; `a`'s null belongs below, not in it.
    expect(content).toContain('| `a` | `string` |  |')
    expect(content).toContain('| `b` | `string` | `"x"` |')
    expect(content).toContain('**Default:** `null`')
  })

  it('lets the caller override a file the schema declares', () => {
    const files = generateMarkdownFiles(
      { 'x-doc': { file: 'from-schema.md' }, properties: { a: {} } },
      { file: 'from-caller.md' },
    )
    expect(files[0]?.filename).toBe('from-caller.md')
  })

  it('sorts one property children by its own rule', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          sorted: { type: 'object', 'x-doc': { sort: 'alphabetical' }, properties: { zebra: {}, apple: {} } },
          unsorted: { type: 'object', properties: { zebra: {}, apple: {} } },
        },
      }),
    )
    expect(content.indexOf('### apple')).toBeLessThan(content.indexOf('### zebra'))
    expect(content.lastIndexOf('### zebra')).toBeLessThan(content.lastIndexOf('### apple'))
  })

  it('reads a ref-shaped value under enum as the value it is', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { enum: [{ $ref: '#/$defs/other' }], description: 'One allowed value.' } },
        $defs: { other: { type: 'string', description: 'WRONG' } },
      }),
    )
    expect(content).toContain('#/$defs/other')
    expect(content).not.toContain('WRONG')
  })

  // The keys of these maps are author-chosen names, so a definition or a
  // property called `default` is not the `default` keyword.
  it('steps over every name-keyed map when inlining', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          // Each map is keyed by a name that is also a keyword, which is the
          // whole reason these maps are stepped over rather than walked.
          patterned: { type: 'object', patternProperties: { default: { $ref: '#/$defs/named' } } },
          dependent: { type: 'object', dependentSchemas: { enum: { $ref: '#/$defs/named' } } },
          legacy: { type: 'object', dependencies: { const: { $ref: '#/$defs/named' } } },
          old: { $ref: '#/definitions/example' },
        },
        $defs: { named: { type: 'object', properties: { fromDefs: { type: 'string' } } } },
        definitions: { example: { type: 'string', description: 'From definitions.' } },
      }),
    )
    expect(content.match(/### fromDefs/g)).toHaveLength(3)
    expect(content).toContain('From definitions.')
  })

  it('resolves an $anchor inside a map whose key is a keyword name', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          profiles: { type: 'object', properties: { default: { $anchor: 'profile', type: 'string' } } },
          active: { $ref: '#profile', description: 'The active profile.' },
        },
      }),
    )
    expect(content).toContain('## active')
    expect(content).toContain('**Type:** `string`')
  })

  // A recursive reference keeps what the ref site said about it.
  it('keeps a ref-site sibling on a collapsed recursive reference', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/node' } },
        $defs: {
          node: {
            type: 'object',
            properties: { child: { $ref: '#/$defs/node', description: 'The nested node.' } },
          },
        },
      }),
    )
    expect(content).toContain('The nested node.')
  })

  // A ``` line inside a ```` block is sample text; closing on the character
  // alone tore the block apart and let its second half open a fence that ran to
  // the end of the page.
  it('keeps a nested fence in a description whole', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          s: {
            type: 'object',
            properties: {
              template: {
                type: 'string',
                description: '````md\n```js\nconst a = 1\n\nconst b = 2\n```\n````\n\nUse it verbatim.',
              },
            },
          },
        },
      }),
    )
    expect(content).toContain('Use it verbatim.')
    // The whole outer block, below the row: cut at the blank line, the inner
    // ``` run would have closed the outer ```` one and the rest would spill.
    expect(content).toContain('````md\n```js\nconst a = 1\n\nconst b = 2\n```\n````')
  })

  it('keeps an indented code block in a description indented', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          s: {
            type: 'object',
            properties: {
              template: {
                type: 'string',
                description: 'The template.\n\n    <div>\n      hi\n\n      there\n    </div>\n\nUse it.',
              },
            },
          },
        },
      }),
    )
    expect(content).toContain('    <div>')
    expect(content).toContain('      there')
  })

  // The gate counts the child's own heading, and a child with `heading: false`
  // pushes none — counting one dropped its whole block, table and all.
  it('keeps the sub-block of a child that renders without a heading', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          theme: {
            type: 'object',
            'x-doc': { layout: 'table' },
            properties: {
              widget: {
                type: 'object',
                deprecated: true,
                'x-doc': { heading: false, layout: 'table' },
                properties: { size: { type: 'string', description: 'Size.' } },
              },
            },
          },
        },
      }),
    )
    expect(content).toContain('| `size` | `string` | Size. |')
    expect(content).toContain('> **Deprecated**')
  })

  // Dropping an alternative from the intersection invents requirements as
  // easily as reading it wrongly erases them, so the stub votes with what the
  // definition it truncates requires.
  it('does not invent a requirement from a truncated alternative', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          self: {
            type: 'object',
            properties: {
              child: { anyOf: [{ $ref: '#/$defs/self' }, { type: 'object', properties: { a: {} }, required: ['a'] }] },
            },
          },
        },
      }),
    )
    expect(content).not.toContain('**Required**')
  })

  it('keeps a requirement every alternative makes, one of them truncated', () => {
    const variants = [{ $ref: '#/$defs/group' }, { $ref: '#/$defs/link' }]
    const content = only(
      generateMarkdownFiles({
        properties: { item: { anyOf: variants } },
        $defs: {
          group: {
            type: 'object',
            required: ['kind'],
            properties: { kind: {}, children: { type: 'array', items: { anyOf: variants } } },
          },
          link: { type: 'object', required: ['kind'], properties: { kind: {} } },
        },
      }),
    )
    // Both `kind` headings carry it, and nothing else does.
    const sections = content.split('### ').filter((section) => section.startsWith('kind'))
    expect(sections).toHaveLength(2)
    for (const section of sections) expect(section).toContain('**Required**')
    expect(content.match(/\*\*Required\*\*/g)).toHaveLength(2)
  })

  // The marker spreads with every other key, and a ref site that declares its
  // own fields is a real object however it was reached. The alias has to be
  // reached from inside the recursive definition — from the root it inlines in
  // full and there is no marker to carry.
  it('does not carry the truncation marker onto a branch that declares fields', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          alias: { $ref: '#/$defs/self' },
          self: {
            type: 'object',
            properties: {
              branch: { anyOf: [{ $ref: '#/$defs/alias', type: 'object', properties: { x: {} }, required: ['x'] }] },
            },
          },
        },
      }),
    )
    expect(content).toContain('**Required**')
  })

  // A recursive ref site that writes its own `required` is describing that use.
  // Substituting the definition's list for it makes the two alternatives
  // disagree, and the field they both require loses its marker.
  it('keeps a recursive ref site own required list', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          self: {
            type: 'object',
            required: ['fromDefinition'],
            properties: {
              fromDefinition: {},
              again: {
                anyOf: [
                  // Only `required` here: with `properties` too, the marker is
                  // dropped for a second reason and this proves nothing.
                  { $ref: '#/$defs/self', required: ['shared'] },
                  { type: 'object', properties: { shared: {} }, required: ['shared'] },
                ],
              },
            },
          },
        },
      }),
    )
    expect(section(content, '#### shared')).toContain('**Required**')
  })

  // A collapsed reference keeps what the ref site says it is.
  it('lets a recursive ref site type beat the stub own', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          self: { type: 'object', properties: { again: { $ref: '#/$defs/self', type: 'string' } } },
        },
      }),
    )
    expect(content).toContain('**Type:** `string`')
  })

  // A union with one object alternative can be an object, so it votes.
  it('lets a union that admits an object vote on what an alternative requires', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          auth: { anyOf: [{ $ref: '#/$defs/tok' }, { type: 'object', properties: { user: {} }, required: ['user'] }] },
        },
        $defs: { tok: { anyOf: [{ type: 'object', properties: { t: {} } }, { type: 'string' }] } },
      }),
    )
    expect(content).not.toContain('**Required**')
  })

  // A row suppresses the derived block, and slicing the first example off
  // anyway meant it appeared nowhere at all.
  it('lists every example when a row suppresses the derived one', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          theme: {
            type: 'object',
            properties: { widget: { type: 'string', description: 'Widget mode.', examples: ['compact', 'wide'] } },
          },
        },
      }),
    )
    expect(content).toContain('**Examples:** `"compact"`, `"wide"`')
  })

  // However it is spelled, none of these can be an object.
  it('lets no spelling of a scalar branch vote on what an object requires', () => {
    for (const token of [
      { type: 'string' },
      { allOf: [{ type: 'string' }] },
      { anyOf: [{ type: 'string' }, { type: 'number' }] },
      { oneOf: [{ type: 'string' }] },
    ]) {
      const content = only(
        generateMarkdownFiles({
          properties: {
            auth: {
              anyOf: [{ $ref: '#/$defs/token' }, { type: 'object', properties: { user: {} }, required: ['user'] }],
            },
          },
          $defs: { token },
        }),
      )
      expect(content, JSON.stringify(token)).toContain('**Required**')
    }
  })

  // A definition written as a one-line alias carries nothing of its own, so
  // reading the alias gave the truncation an empty picture of what it stands
  // for — and the alternative beside it lost its marker.
  it('records what an aliased definition requires', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { node: { $ref: '#/$defs/alias' } },
        $defs: {
          alias: { $ref: '#/$defs/real' },
          real: {
            type: 'object',
            required: ['a'],
            properties: {
              a: { type: 'string' },
              child: {
                anyOf: [{ $ref: '#/$defs/alias' }, { type: 'object', required: ['a'], properties: { a: {} } }],
              },
            },
          },
        },
      }),
    )
    expect(section(content, '#### a')).toContain('**Required**')
  })

  it('records what a definition inherits through allOf', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { node: { $ref: '#/$defs/node' } },
        $defs: {
          base: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
          node: {
            type: 'object',
            allOf: [{ $ref: '#/$defs/base' }],
            properties: {
              child: { anyOf: [{ $ref: '#/$defs/node' }, { type: 'object', required: ['a'], properties: { a: {} } }] },
            },
          },
        },
      }),
    )
    expect(section(content, '#### a')).toContain('**Required**')
  })

  // The definition's list is what the collapse threw away; the ref site's own
  // composition is a requirement the collapse never saw.
  it('adds a recursive ref site own composed requirement to the definition one', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { node: { $ref: '#/$defs/node' } },
        $defs: {
          node: {
            type: 'object',
            required: ['a'],
            properties: {
              a: { type: 'string' },
              kid: {
                anyOf: [
                  { $ref: '#/$defs/node', allOf: [{ required: ['z'], properties: { z: { type: 'string' } } }] },
                  { type: 'object', required: ['a', 'z'], properties: { a: {}, z: {} } },
                ],
              },
            },
          },
        },
      }),
    )
    expect(section(content, '#### z')).toContain('**Required**')
  })

  // Alternatives hold only what they *all* ask for. Reading them as "what any
  // of them asks for" invents requirements on the truncation, which is the
  // mirror of the error that made it record them in the first place.
  it('records only what every alternative of a truncated definition requires', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { node: { $ref: '#/$defs/node' } },
        $defs: {
          node: {
            type: 'object',
            anyOf: [{ required: ['a', 'b'] }, { required: ['a'] }, { required: ['b'] }],
            properties: {
              a: {},
              b: {},
              kid: {
                anyOf: [
                  { $ref: '#/$defs/node' },
                  { type: 'object', required: ['a', 'b'], properties: { a: {}, b: {} } },
                ],
              },
            },
          },
        },
      }),
    )
    // No name is asked for by all three, so nothing on the page is required.
    expect(content).not.toContain('**Required**')
  })

  // `oneOf` composes requirements the same way `anyOf` does, and it is the
  // spelling a discriminated union uses — every variant asking for the tag.
  it('records what a definition composes through oneOf', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { node: { $ref: '#/$defs/node' } },
        $defs: {
          node: {
            type: 'object',
            oneOf: [
              { required: ['kind'], properties: { kind: {}, a: {} } },
              { required: ['kind'], properties: { kind: {}, b: {} } },
            ],
            properties: {
              kid: {
                anyOf: [{ $ref: '#/$defs/node' }, { type: 'object', required: ['kind'], properties: { kind: {} } }],
              },
            },
          },
        },
      }),
    )
    expect(section(content, '#### kind')).toContain('**Required**')
  })

  // A recursive ref site writing its own `required` is describing that use, so
  // the definition's list is not substituted for it — nor added to it.
  it('does not record a definition list on a ref site that writes its own required', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          self: {
            type: 'object',
            required: ['fromDefinition'],
            properties: {
              fromDefinition: {},
              again: {
                anyOf: [
                  // Only `required` here, so the marker is suppressed for this
                  // reason alone.
                  { $ref: '#/$defs/self', required: ['own'] },
                  { type: 'object', required: ['fromDefinition', 'own'], properties: { fromDefinition: {}, own: {} } },
                ],
              },
            },
          },
        },
      }),
    )
    // The root's own `fromDefinition`, and `own` under `again`. Not the nested
    // `fromDefinition`: one alternative asks for it and the other does not.
    expect(content.match(/\*\*Required\*\*/g)).toHaveLength(2)
    expect(section(content, '#### own')).toContain('**Required**')
    expect(section(content, '#### fromDefinition')).not.toContain('**Required**')
  })

  it('does not record a definition list on a ref site that writes its own properties', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          self: {
            type: 'object',
            required: ['fromDefinition'],
            properties: {
              fromDefinition: {},
              again: {
                anyOf: [
                  // Only `properties` here, for the same reason.
                  { $ref: '#/$defs/self', properties: { extra: {} } },
                  { type: 'object', required: ['fromDefinition'], properties: { fromDefinition: {}, extra: {} } },
                ],
              },
            },
          },
        },
      }),
    )
    expect(content.match(/\*\*Required\*\*/g)).toHaveLength(1)
    expect(section(content, '### fromDefinition')).toContain('**Required**')
  })

  /**
   * The same two shapes one hop further out: an alias whose *target* collapsed,
   * so the marker arrives by spreading rather than by being written. It has to
   * come back off for either sibling keyword on its own.
   */
  const aliasedTruncation = (site: Record<string, unknown>, alternative: Record<string, unknown>): unknown => ({
    properties: { root: { $ref: '#/$defs/self' } },
    $defs: {
      alias: { $ref: '#/$defs/self' },
      self: {
        type: 'object',
        required: ['fromDefinition'],
        properties: {
          fromDefinition: {},
          branch: { anyOf: [{ $ref: '#/$defs/alias', ...site }, alternative] },
        },
      },
    },
  })

  it('drops the truncation marker from an alias whose ref site writes only a required list', () => {
    const content = only(
      generateMarkdownFiles(
        aliasedTruncation(
          { required: ['x'] },
          { type: 'object', required: ['fromDefinition', 'x'], properties: { fromDefinition: {}, x: {} } },
        ),
      ),
    )
    // The root's own `fromDefinition` and `x` under `branch` — not the nested
    // `fromDefinition`, which only one alternative asks for.
    expect(content.match(/\*\*Required\*\*/g)).toHaveLength(2)
    expect(section(content, '#### x')).toContain('**Required**')
  })

  it('drops the truncation marker from an alias whose ref site writes only properties', () => {
    const content = only(
      generateMarkdownFiles(
        aliasedTruncation(
          { properties: { x: {} } },
          { type: 'object', required: ['fromDefinition'], properties: { fromDefinition: {}, x: {} } },
        ),
      ),
    )
    expect(content.match(/\*\*Required\*\*/g)).toHaveLength(1)
    expect(section(content, '### fromDefinition')).toContain('**Required**')
  })

  // Two properties sharing one definition each print their own sentence: the
  // definition's prose is what the truncation falls back to, never what it
  // overrides the ref site with.
  it('lets a truncated ref site prose beat the definition it stands for', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          self: {
            type: 'object',
            description: 'Definition prose.',
            properties: { again: { $ref: '#/$defs/self', description: 'Ref site prose.' } },
          },
        },
      }),
    )
    expect(section(content, '### again')).toContain('Ref site prose.')
    expect(section(content, '### again')).not.toContain('Definition prose.')
  })

  // `x-doc` is a namespace, not a value: the truncation keeps the definition's
  // documentation and the ref site says where *this* use is documented. Replacing
  // the whole object drops the definition's notes the moment a ref site renames it.
  it('merges a truncated definition doc keyword with the ref site one, key by key', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          self: {
            type: 'object',
            'x-doc': { title: 'Definition title', note: 'Definition note.' },
            properties: { again: { $ref: '#/$defs/self', 'x-doc': { title: 'Ref site title' } } },
          },
        },
      }),
    )
    // The heading proves the ref site wins per key; the note proves the rest of
    // the definition's `x-doc` survived it.
    expect(section(content, '### Ref site title')).toContain('> Definition note.')
  })

  // A ref site that retypes a truncation is still describing the definition's
  // object, so it keeps its say in what the alternatives beside it require.
  it('lets a retyped truncation vote on what an alternative requires', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          self: {
            type: 'object',
            required: ['a'],
            properties: {
              a: {},
              kid: {
                anyOf: [
                  { $ref: '#/$defs/self', type: 'string' },
                  { type: 'object', required: ['a', 'b'], properties: { a: {}, b: {} } },
                ],
              },
            },
          },
        },
      }),
    )
    // `a` twice — the root's and the one under `kid`. `b` is asked for by one
    // alternative only, and the retyped truncation is the other one.
    expect(content.match(/\*\*Required\*\*/g)).toHaveLength(2)
    expect(section(content, '#### b')).not.toContain('**Required**')
  })

  // Reading what a truncation stands for follows `$ref` hops and composition,
  // both of which a schema is free to write in a circle.
  it('terminates on a definition that reaches itself through an alias', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/a' } },
        $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } },
      }),
    )
    expect(content).toContain('## root')
  })

  it('terminates on a definition that composes itself through allOf', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/self' } },
        $defs: {
          self: { type: 'object', allOf: [{ $ref: '#/$defs/self' }], properties: { again: { $ref: '#/$defs/self' } } },
        },
      }),
    )
    expect(content).toContain('### again')
  })

  // A root reached through a `$ref` has no `x-doc` of its own. Inventing an
  // empty one for it outranks the branch that carries the real one, and the
  // whole page silently changes layout.
  it('does not invent a doc keyword on a root reached through a ref', () => {
    const content = only(
      generateMarkdownFiles({
        $ref: '#/$defs/base',
        anyOf: [
          {
            type: 'object',
            properties: { theme: { type: 'object', properties: { mode: { type: 'string', description: 'Mode.' } } } },
            'x-doc': { layout: 'table' },
          },
        ],
        $defs: { base: { type: 'object' } },
      }),
    )
    expect(content).toContain('| `mode` | `string` | Mode. |')
  })

  // A row names the property in a cell several lines up, so the block below it
  // needs a heading of its own however `x-doc.heading` reads — without one, the
  // child's Deprecated callout landed under the parent's heading.
  it('labels a sub-block even when the child asks for no heading', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          opts: {
            type: 'object',
            description: 'Options.',
            'x-doc': { layout: 'table' },
            properties: {
              legacy: { type: 'string', description: 'Old.', deprecated: true, 'x-doc': { heading: false } },
              current: { type: 'string', description: 'New.' },
            },
          },
          after: { type: 'string' },
        },
      }),
    )
    expect(content.slice(0, content.indexOf('> **Deprecated**'))).toContain('### legacy')
  })

  it('labels each of two heading-less children under one table', () => {
    const child = (name: string) => ({
      type: 'object',
      'x-doc': { heading: false, layout: 'table' },
      properties: { [`${name}Field`]: { type: 'string', description: `${name}.` } },
    })
    const content = only(
      generateMarkdownFiles({
        properties: {
          outer: {
            type: 'object',
            'x-doc': { layout: 'table' },
            properties: { alpha: child('alpha'), beta: child('beta') },
          },
        },
      }),
    )
    expect(content).toContain('### alpha')
    expect(content).toContain('### beta')
    expect(content.indexOf('### alpha')).toBeLessThan(content.indexOf('| `betaField`'))
  })

  // A paragraph whose second line happens to be indented is a lazy
  // continuation, not a code block, so the blank line after it still ends it.
  it('does not fold a code block into a lazy continuation', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          opts: {
            type: 'object',
            properties: {
              sample: {
                type: 'string',
                description: 'Wrap the value in\n    the same shape\n\n    <b>literal</b>\n\nThen restart.',
              },
            },
          },
        },
      }),
    )
    const row = content.split('\n').find((line) => line.startsWith('| `sample'))
    // Named first: a negative assertion about a row that never rendered would
    // pass for the wrong reason, and so would the block below it.
    expect(row).toBe('| `sample` | `string` | Wrap the value in     the same shape |')
    expect(content).toContain('    <b>literal</b>')
  })

  // The collapse drops the definition's shape, which is already on the page —
  // not what it is called or what it says about itself.
  it('keeps the prose and the doc keyword of a truncated definition', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/node' } },
        $defs: {
          node: {
            type: 'object',
            description: 'A node in the tree.',
            'x-doc': { type: 'NodeShape' },
            properties: { name: { type: 'string' }, next: { $ref: '#/$defs/node' } },
          },
        },
      }),
    )
    const next = section(content, '### next')
    expect(next).toContain('**Type:** `NodeShape`')
    expect(next).toContain('A node in the tree.')
  })

  // A combinator language reaches the same definitions again by another path:
  // `Filter` is `And | Or`, and each of those inherits `Filter` through `allOf`.
  // Reading what a truncation stands for re-walked every one of those paths, so
  // this nine-line schema never finished rendering at all.
  it('renders a definition that composes itself through two branches', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { filter: { $ref: '#/$defs/Filter' } },
        $defs: {
          Filter: { anyOf: [{ $ref: '#/$defs/And' }, { $ref: '#/$defs/Or' }] },
          And: {
            type: 'object',
            allOf: [{ $ref: '#/$defs/Filter' }],
            required: ['and'],
            properties: { and: { type: 'array', items: { type: 'string' } } },
          },
          Or: {
            type: 'object',
            allOf: [{ $ref: '#/$defs/Filter' }],
            required: ['or'],
            properties: { or: { type: 'array', items: { type: 'string' } } },
          },
        },
      }),
    )
    expect(content).toContain('### and')
    expect(content).toContain('### or')
    // Neither branch requires what the other does, so neither field is marked.
    // That much the collector would say on its own; what this test is for is
    // that the render happens at all.
    expect(content).not.toContain('**Required**')
  })

  // Refusing to re-enter a definition already on the path is what makes the
  // reading terminate; this is the backstop for the schema that terminates and
  // still takes longer than anyone will wait. Silence would leave the reader
  // with **Required** markers that are guesses.
  it('refuses a schema whose definitions compose in too many ways to read', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const $defs = Object.fromEntries(
      names.map((name) => [
        name,
        {
          type: 'object',
          required: [name],
          properties: Object.fromEntries(names.map((other) => [other, {}])),
          anyOf: names.filter((other) => other !== name).map((other) => ({ $ref: `#/$defs/${other}` })),
        },
      ]),
    )
    // The number too: an allowance the reader cannot see is one nobody can
    // tell has been set to something useless.
    expect(() => generateMarkdownFiles({ properties: { root: { $ref: '#/$defs/a' } }, $defs })).toThrow(
      /passed 10000 nodes.*compose in too many ways/s,
    )
  })

  // `$ref: '#'` is the spelling a self-recursive schema uses, and it makes the
  // *root* the definition being truncated — whose `x-doc` is the page's own
  // configuration. Copying it wholesale headed the property with the page title
  // and printed the page's example underneath it a second time.
  it('does not take the page title and example onto a self-referencing property', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { title: 'App configuration', example: '{ "name": "demo" }' },
        properties: {
          name: { type: 'string' },
          parent: { $ref: '#', description: 'A parent config this one extends.' },
        },
      }),
    )
    expect(content).toContain('## parent')
    expect(content).not.toContain('## App configuration')
    expect(content.match(/\{ "name": "demo" \}/g)).toHaveLength(1)
  })

  // Where a property is documented is the ref site's to say. Carried down from
  // the definition, it tore the truncated child out of its parent and
  // republished it as a top-level heading on another file, with no path to say
  // what it belonged to.
  it('does not move a truncated child onto the page its definition names', () => {
    const files = generateMarkdownFiles({
      'x-doc': { pages: [{ id: 'nodes', file: 'nodes.md', title: 'Nodes' }] },
      properties: { alt: { $ref: '#/$defs/Node', 'x-doc': { page: 'index' } } },
      $defs: {
        Node: {
          type: 'object',
          'x-doc': { page: 'nodes' },
          properties: { label: { type: 'string' }, child: { $ref: '#/$defs/Node' } },
        },
      },
    })
    const index = files.find((file) => file.filename === 'index.md')?.content ?? ''
    const nodes = files.find((file) => file.filename === 'nodes.md')?.content ?? ''
    expect(index).toContain('### child')
    // The page is written, and empty: without this the `?? ''` fallback would
    // satisfy the next line on its own.
    expect(nodes).toBe('# Nodes\n')
    expect(nodes).not.toContain('child')
  })

  // The rule the ref site's own `description` wins by holds on both routes: two
  // properties sharing a definition each print their own sentence, whether the
  // reference was inlined or truncated.
  it('lets a truncated ref site description beat the definition doc keyword', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/Node' } },
        $defs: {
          Node: {
            type: 'object',
            'x-doc': { description: 'A node. Described once, in $defs.' },
            properties: { child: { $ref: '#/$defs/Node', description: "This node's own child." } },
          },
        },
      }),
    )
    expect(section(content, '### child')).toContain("This node's own child.")
    expect(section(content, '### child')).not.toContain('Described once')
  })

  // The scalar half of `string | { … }` has no say in what the object half
  // requires. One reader applied that rule and the other did not, so the same
  // union was documented two ways on one page depending on which route reached
  // it.
  it('documents one union the same way whether it is truncated or not', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { first: { $ref: '#/$defs/Other' }, nested: { $ref: '#/$defs/Item' } },
        $defs: {
          Other: { anyOf: [{ type: 'string' }, { type: 'object', required: ['id'], properties: { id: {} } }] },
          Item: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                required: ['id'],
                properties: {
                  id: {},
                  kid: {
                    anyOf: [{ $ref: '#/$defs/Item' }, { type: 'object', required: ['id'], properties: { id: {} } }],
                  },
                },
              },
            ],
          },
        },
      }),
    )
    // `first.id`, `nested.id`, and `nested.kid.id` — the truncated route reads
    // the union the same way the inlined one does.
    expect(content.match(/\*\*Required\*\*/g)).toHaveLength(3)
    expect(section(content, '#### id')).toContain('**Required**')
  })

  // A row is one line and a code block is not one line. Squeezed into a cell it
  // lost the indentation that made it code, and a sample of HTML reached the
  // reader as live markup — and as nothing else, because the block below the
  // row skips whatever the row already said.
  it('keeps a description that opens with a code sample out of the row', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { layout: 'table' },
        properties: {
          theme: {
            type: 'object',
            properties: {
              template: { type: 'string', description: '    <div class="x">sample</div>\n\nPaste it verbatim.' },
            },
          },
        },
      }),
    )
    expect(content).toContain('| `template` | `string` | Paste it verbatim. |')
    expect(content).toContain('\n    <div class="x">sample</div>')
  })

  /** A definition that documents itself, and a property that truncates it. */
  const truncating = (doc: Record<string, unknown>, site: Record<string, unknown>): unknown => ({
    title: 'Config',
    properties: { root: { $ref: '#/$defs/Node' } },
    $defs: {
      Node: {
        type: 'object',
        'x-doc': doc,
        properties: {
          name: { type: 'string', description: 'Name.' },
          child: { $ref: '#/$defs/Node', description: 'Nested node.', ...site },
        },
      },
    },
  })

  // A truncation is documented the way any other `$ref` site is. Reading it as
  // a special case cost the definition's layout the moment the ref site added a
  // field of its own — and `{ $ref: Base, properties: … }` is the extension
  // idiom, not an edge case.
  it('keeps the definition layout on a truncation that declares its own fields', () => {
    const content = only(
      generateMarkdownFiles(
        truncating({ layout: 'table' }, { properties: { extra: { type: 'string', description: 'Extra.' } } }),
      ),
    )
    expect(section(content, '### child')).toContain('| `extra` | `string` | Extra. |')
  })

  // `hidden` is the one member whose failure mode is publishing an option the
  // schema said to keep out of the docs.
  it('keeps a definition hidden where a truncation reaches it', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'Config',
        properties: { cache: { $ref: '#/$defs/Cache', 'x-doc': { hidden: false }, description: 'Cache settings.' } },
        $defs: {
          Cache: {
            type: 'object',
            'x-doc': { hidden: true, layout: 'table' },
            properties: {
              ttl: { type: 'number', description: 'Seconds.' },
              fallback: { $ref: '#/$defs/Cache', description: 'Fallback cache.' },
            },
          },
        },
      }),
    )
    expect(content).toContain('| `ttl` | `number` | Seconds. |')
    expect(content).not.toContain('fallback')
  })

  it('keeps the definition example on a truncation', () => {
    const content = only(
      generateMarkdownFiles(truncating({ example: { value: { name: 'n1' }, caption: 'A node looks like this.' } }, {})),
    )
    expect(section(content, '### child')).toContain('A node looks like this.')
  })

  // Where a property is documented is the ref site's to say — a truncation has
  // no shape to move, so it would arrive as a bare heading.
  it('does not move a truncated child into the section its definition names', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': { sections: [{ id: 'later', title: 'Later' }] },
        properties: { alt: { $ref: '#/$defs/Node' } },
        $defs: {
          Node: {
            type: 'object',
            'x-doc': { section: 'later' },
            properties: { label: { type: 'string' }, child: { $ref: '#/$defs/Node' } },
          },
        },
      }),
    )
    expect(section(content, '### alt')).toContain('#### child')
  })

  // The document root is not a definition: its `x-doc` is the page's own
  // configuration, and `$ref: '#'` used to reprint the page's introduction,
  // notes and footer under the property's name.
  it('takes nothing from the page onto a self-referencing property', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'Configuration',
        'x-doc': {
          description: 'Everything on this page configures the reference.',
          notes: ['Root note.'],
          footer: 'Read the migration guide before upgrading.',
        },
        properties: { theme: { type: 'string', description: 'The theme.' }, sibling: { $ref: '#' } },
      }),
    )
    expect(section(content, '## sibling')).toBe('## sibling\n\n**Type:** `object`\n')
    expect(content.match(/Everything on this page configures the reference\./g)).toHaveLength(1)
  })

  // A chain of one-line alias definitions is not a cycle, so nothing cuts it —
  // and a code generator emits them by the thousand. The node allowance counts
  // nodes, not frames, so the reading recursed until the stack gave out and
  // said only `RangeError`, on whichever runtime happened to have the smaller
  // stack.
  it('refuses an alias chain deeper than the composition can be followed', () => {
    const $defs: Record<string, unknown> = {
      // `properties` before `allOf`: the truncation inside it is reached — and
      // reads the chain — before the inliner ever descends the chain itself.
      Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } }, allOf: [{ $ref: '#/$defs/L0' }] },
    }
    for (let index = 0; index < 900; index++) {
      $defs[`L${index}`] = index === 899 ? { type: 'object' } : { allOf: [{ $ref: `#/$defs/L${index + 1}` }] }
    }
    expect(() => generateMarkdownFiles({ properties: { a: { $ref: '#/$defs/Node' } }, $defs })).toThrow(
      /composition passed 512 levels/,
    )
  })

  // The allowance has to be large enough for a schema that legitimately
  // composes: three hundred bases is a lot, and it is not an error.
  it('reads a definition that composes three hundred bases', () => {
    const $defs: Record<string, unknown> = {}
    const allOf: unknown[] = []
    for (let index = 0; index < 300; index++) {
      $defs[`D${index}`] = { type: 'object', ...(index === 0 && { required: ['deep'] }) }
      allOf.push({ $ref: `#/$defs/D${index}` })
    }
    $defs['Node'] = {
      type: 'object',
      allOf,
      properties: { deep: { type: 'string' }, next: { $ref: '#/$defs/Node' } },
    }
    const content = only(generateMarkdownFiles({ properties: { node: { $ref: '#/$defs/Node' } }, $defs }))
    expect(section(content, '### deep')).toContain('**Required**')
  })

  // Working out what a definition requires depends only on the document and the
  // pointer, so it is worked out once. Repeating it at every truncation took 75
  // seconds on a 3 KB schema — and then failed on the node allowance anyway, so
  // the whole 75 seconds bought an error message.
  it('reads what each definition requires once', () => {
    const $defs: Record<string, unknown> = {}
    for (let index = 0; index < 9; index++) {
      $defs[`E${index}`] = { allOf: [{ $ref: `#/$defs/E${index + 1}` }, { $ref: `#/$defs/E${index + 1}` }] }
    }
    $defs['E9'] = { type: 'object' }
    const fan = (target: string) =>
      Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`p${index}`, { $ref: `#/$defs/${target}` }]))
    $defs['A'] = { type: 'object', allOf: [{ $ref: '#/$defs/E0' }], properties: fan('B') }
    $defs['B'] = { type: 'object', properties: fan('C') }
    $defs['C'] = { type: 'object', properties: fan('A') }
    // The schema is too big to inline, which is the error it should reach —
    // quickly. Read once per pointer this takes a fifth of a second; read once
    // per truncation the test times out long before the message arrives.
    expect(() =>
      generateMarkdownFiles({ 'x-doc': { layout: 'none' }, properties: { root: { $ref: '#/$defs/A' } }, $defs }),
    ).toThrow(/more than 100000 nodes/)
  })

  // `#/` addresses the document as surely as `#` does, and a truncation that
  // cannot resolve it loses everything the definition said, requirements first.
  it('resolves the other spelling of the empty pointer at a truncation', () => {
    const content = only(
      generateMarkdownFiles({
        required: ['a'],
        properties: {
          a: { type: 'string' },
          kid: { anyOf: [{ $ref: '#/' }, { type: 'object', required: ['a'], properties: { a: {} } }] },
        },
      }),
    )
    expect(section(content, '### a')).toContain('**Required**')
  })

  // A branch reached through a reference is whatever the definition says. The
  // `allOf`-wrapped `$ref` is how OpenAPI 3.0 attaches prose to one, and read
  // without following it a `string` definition looked like an object — the one
  // vote this filter exists to refuse.
  it('follows a reference before letting a branch vote on what an alternative requires', () => {
    const content = only(
      generateMarkdownFiles({
        title: 'Rules',
        properties: { nested: { $ref: '#/$defs/Group' } },
        $defs: {
          RuleId: { type: 'string' },
          RuleIdRef: { description: 'Prose about the id.', allOf: [{ $ref: '#/$defs/RuleId' }] },
          Group: {
            type: 'object',
            properties: { inner: { $ref: '#/$defs/Rule' } },
            anyOf: [
              { $ref: '#/$defs/RuleIdRef' },
              { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
            ],
          },
          Rule: {
            type: 'object',
            anyOf: [
              { $ref: '#/$defs/Group' },
              { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
            ],
          },
        },
      }),
    )
    expect(section(content, '#### id')).toContain('**Required**')
  })

  // `type: ['string', 'object']` says the same thing as `['object', 'string']`.
  it('reads a union whose object form is not the first type it names', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          auth: {
            anyOf: [{ $ref: '#/$defs/token' }, { type: 'object', required: ['user'], properties: { user: {} } }],
          },
        },
        $defs: { token: { type: ['string', 'object'], properties: { t: {} } } },
      }),
    )
    expect(content).not.toContain('**Required**')
  })

  // A truncated branch carries its requirements in the marker rather than in
  // `required`, and `allOf: [{ $ref: Base }, { properties: … }]` is where a
  // recursive base gets truncated — the inheritance idiom of every
  // OpenAPI-derived schema.
  it('records what a truncated allOf branch requires', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/Node' } },
        $defs: {
          Node: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
              child: { allOf: [{ $ref: '#/$defs/Node' }, { properties: { id: { type: 'string' } } }] },
            },
          },
        },
      }),
    )
    expect(section(content, '#### id')).toContain('**Required**')
  })

  // A name is one value however it is spelled: passing it through the
  // paragraph reader erased a property called `\tindented` from its own table,
  // because a leading tab reads as an indented code block and a row cannot
  // hold one.
  it('keeps a property name that reads as a code block in its own row', () => {
    const content = only(
      generateMarkdownFiles({
        properties: {
          ui: {
            type: 'object',
            'x-doc': { layout: 'table' },
            properties: {
              '\tindented': { type: 'string', description: 'Tab-named.' },
              normal: { type: 'string', description: 'Fine.', 'x-doc': { type: '    Weird' } },
            },
          },
        },
      }),
    )
    // Whitespace and all: the row names the key the schema declares, and the
    // code span is padded so an edge space survives being shown. Trimming it
    // named a key that does not exist, and disagreed with the heading the
    // other layout gives the same property.
    expect(content).toContain('| ` \tindented ` | `string` | Tab-named. |')
    expect(content).toContain('| `normal` | `     Weird ` | Fine. |')
  })

  // The same rule on the three other routes a description reaches the page by.
  it('keeps a code sample indented in a page, section and footer description', () => {
    const content = only(
      generateMarkdownFiles({
        'x-doc': {
          title: 'Cfg',
          description: '    <div>page sample</div>\n\nThe page.',
          sections: [{ id: 'later', title: 'Later', description: '    <div>section sample</div>\n\nThe section.' }],
        },
        properties: {
          a: { type: 'string', 'x-doc': { section: 'later', footer: '    <div>footer sample</div>' } },
        },
      }),
    )
    for (const sample of ['page', 'section', 'footer']) expect(content).toContain(`\n    <div>${sample} sample</div>`)
  })

  // A description opening with blank lines is not a paragraph of its own, and
  // printing them left a hole between the type line and the prose.
  it('drops the blank lines a description opens with', () => {
    const content = only(generateMarkdownFiles({ properties: { a: { type: 'string', description: '  \n\nProse.' } } }))
    expect(content).toContain('**Type:** `string`\n\nProse.')
  })

  // `heading: false` means "the heading above already names this, and the
  // children stand on their own". A truncation has no children, so the property
  // disappeared outright and its sentence read as a second paragraph of its
  // sibling's prose.
  it('does not let a definition drop the heading of a truncation', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { tree: { $ref: '#/$defs/Node' } },
        $defs: {
          Node: {
            type: 'object',
            'x-doc': { heading: false },
            properties: {
              name: { type: 'string', description: 'Name.' },
              child: { $ref: '#/$defs/Node', description: 'The nested child node.' },
            },
          },
        },
      }),
    )
    // `tree` is a full reference, so it keeps the definition's `heading: false`
    // and its children move up a level — that is what the keyword means, and
    // what a truncation cannot do.
    expect(section(content, '## child')).toContain('The nested child node.')
  })

  // Otherwise every truncation of one definition is headed the same string:
  // colliding anchors, and the names the reader has to type nowhere on the page.
  it('does not let a definition rename the truncations that stand for it', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/Node' } },
        $defs: {
          Node: {
            type: 'object',
            'x-doc': { title: 'Node' },
            properties: {
              left: { $ref: '#/$defs/Node', description: 'Left child.' },
              right: { $ref: '#/$defs/Node', description: 'Right child.' },
            },
          },
        },
      }),
    )
    expect(content).toContain('### left')
    expect(content).toContain('### right')
    expect(content.match(/### Node/g)).toBeNull()
  })

  // `order` sorts an occurrence among its siblings, which is the ref site's
  // business for the same reason its heading is: carried down, one definition
  // reordered every property that happened to truncate it.
  it('does not let a definition reorder the truncations that stand for it', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/Node' } },
        $defs: {
          Node: {
            type: 'object',
            'x-doc': { order: 0 },
            properties: { aaa: { type: 'string' }, zzz: { $ref: '#/$defs/Node' } },
          },
        },
      }),
    )
    expect(content.indexOf('### aaa')).toBeLessThan(content.indexOf('### zzz'))
  })

  // A definition written as a one-line alias documents itself; reading the end
  // of the chain gave a truncation of `Alias` the prose of `Base`, while a
  // reference to the same `Alias` one level up carried `Alias`'s.
  it('carries the alias documentation a truncation was written with', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { root: { $ref: '#/$defs/Alias' } },
        $defs: {
          Base: { type: 'object', description: 'Base prose.', properties: { again: { $ref: '#/$defs/Alias' } } },
          Alias: { $ref: '#/$defs/Base', description: 'Alias prose.' },
        },
      }),
    )
    expect(section(content, '### again')).toContain('Alias prose.')
    expect(section(content, '### again')).not.toContain('Base prose.')
  })

  // `allOf: [{ $ref: Base }]` at the root, where the base only restates
  // `required`, names no property the root does not already list — and the
  // early return handed the schema back with every marker it composed in
  // dropped.
  it('keeps a requirement the root composes in without naming a new field', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { a: { type: 'string', description: 'A.' } },
        allOf: [{ required: ['a'] }],
      }),
    )
    expect(section(content, '## a')).toContain('**Required**')
  })

  // `#` and `#/` are seeded as seen; the root's own `$anchor` is the third
  // spelling of the same node, and it expanded the whole document a second time
  // under a property's name, page notes and all.
  it('truncates a reference to the root written as its own anchor', () => {
    const content = only(
      generateMarkdownFiles({
        $anchor: 'root',
        title: 'Configuration',
        'x-doc': { notes: ['A page-level note.'] },
        properties: {
          name: { type: 'string', description: 'Name.' },
          nested: { $ref: '#root', description: 'A nested configuration.' },
        },
      }),
    )
    expect(section(content, '## nested')).toBe('## nested\n\n**Type:** `object`\n\nA nested configuration.\n')
  })

  // The ref site's keywords apply alongside the definition's, which is what the
  // inliner does with them. Replacing the branch with the definition dropped a
  // `required` written at the ref site, so one union was documented one way
  // inlined and another truncated.
  it('reads a required list written at a composition branch ref site', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { item: { $ref: '#/$defs/Item' } },
        $defs: {
          Base: { type: 'object', properties: { kind: { type: 'string', description: 'K.' } } },
          Item: {
            type: 'object',
            allOf: [{ $ref: '#/$defs/Base', required: ['kind'] }],
            properties: {
              child: {
                anyOf: [
                  { $ref: '#/$defs/Item' },
                  { type: 'object', required: ['kind'], properties: { kind: { type: 'string' } } },
                ],
              },
            },
          },
        },
      }),
    )
    expect(section(content, '#### kind')).toContain('**Required**')
  })

  // A truncation said `object` whatever it stood for, so a definition spelled
  // `string | { … }` told the reader a string was not valid at every recursive
  // position — and put a phantom `object` in the label of any union it sat in.
  it('labels a truncation with the type its definition has', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { filter: { $ref: '#/$defs/Filter' } },
        $defs: {
          Filter: {
            anyOf: [
              { type: 'string' },
              { type: 'object', properties: { not: { $ref: '#/$defs/Filter', description: 'Negated.' } } },
            ],
          },
        },
      }),
    )
    expect(section(content, '### not')).toContain('**Type:** `string | object`')
  })

  // A ref site that declares its own shape is describing that shape, whatever
  // the definition it points at is — reading the definition alone judged
  // `{ $ref: Scalar, type: 'object' }` a scalar and dropped it from the
  // intersection, which invents requirements rather than losing them.
  it('lets a branch ref site type decide whether it votes as an object', () => {
    const content = only(
      generateMarkdownFiles({
        properties: { node: { $ref: '#/$defs/Node' } },
        $defs: {
          Scalar: { type: 'string' },
          Node: {
            type: 'object',
            required: ['a'],
            properties: {
              a: { type: 'string' },
              kid: {
                anyOf: [
                  { $ref: '#/$defs/Node' },
                  { $ref: '#/$defs/Scalar', type: 'object', properties: { a: {}, b: {} } },
                  { type: 'object', required: ['a', 'b'], properties: { a: {}, b: {} } },
                ],
              },
            },
          },
        },
      }),
    )
    // The retyped branch requires nothing, so nothing under `kid` is required —
    // read as a scalar it would have been dropped and `a` marked instead.
    expect(section(content, '#### a')).not.toContain('**Required**')
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
