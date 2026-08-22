import { readFile, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateMarkdown } from '#table/generate-markdown'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

const readFileMock = vi.mocked(readFile)
const writeFileMock = vi.mocked(writeFile)

/**
 * Test data representing a minimal valid schema.
 * Used across multiple tests to avoid repetition.
 */
const minimalSchema = {
  title: 'Test Schema',
  description: 'A test schema',
  properties: {
    testProp: {
      type: 'string',
      description: 'A test property',
    },
  },
}

const mockFs = (schema: unknown) => {
  readFileMock.mockImplementation(async (path) => {
    if (typeof path === 'string' && path.includes('config.schema.json')) {
      return JSON.stringify(schema)
    }
    throw new Error('Unexpected file path')
  })
  writeFileMock.mockImplementation(async () => {})
}

describe('generate-markdown', () => {
  beforeEach(() => {
    readFileMock.mockReset()
    writeFileMock.mockReset()
  })

  it('generates properties table from minimal schema', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [path, content] = writeFileMock.mock.calls[0] ?? []
    expect(path).toContain('README.md')
    expect(content).toContain('testProp')
  })

  it('handles schema with required properties', async () => {
    const schemaWithRequired = {
      ...minimalSchema,
      required: ['testProp'],
    }

    mockFs(schemaWithRequired)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('✅')
    expect(content).toContain('testProp')
  })

  it('handles schema with optional properties', async () => {
    const schemaWithOptional = {
      ...minimalSchema,
      required: [],
      properties: {
        optionalProp: {
          type: 'string',
          description: 'An optional property',
        },
      },
    }

    mockFs(schemaWithOptional)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    const metaRow = (content as string)
      .split('<tr>')
      .find((row: string) => row.includes('<code>optionalProp</code>') && !row.includes('colspan'))
    expect(metaRow).toBeDefined()
    // Nothing marks it required, and there is no placeholder dash
    expect(metaRow).not.toContain('✅')
    expect(content).not.toContain('—')
  })

  it('renders CLI flags when x-cli-flag is present', async () => {
    const schemaWithCliFlag = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'string',
          description: 'A test property',
          'x-cli-flag': '--test-flag',
        },
      },
    }

    mockFs(schemaWithCliFlag)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('--test-flag')
  })

  it('omits the CLI Flag column entirely when no property declares one', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    // No CLI flags anywhere -> the whole column (header and cells) is gone
    expect(content).not.toContain('<th>CLI Flag</th>')
    expect(content).not.toContain('—')
  })

  it('keeps the CLI Flag column for properties without a flag when another has one', async () => {
    const schemaWithMixedFlags = {
      ...minimalSchema,
      properties: {
        withFlag: { type: 'string', description: 'Has a flag', 'x-cli-flag': '--with' },
        withoutFlag: { type: 'string', description: 'No flag' },
      },
    }

    mockFs(schemaWithMixedFlags)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('<th>CLI Flag</th>')
    expect(content).toContain('<code>--with</code>')
    // The flag-less row gets an empty cell, never a dash placeholder
    const metaRow = (content as string)
      .split('<tr>')
      .find((row: string) => row.includes('<code>withoutFlag</code>') && !row.includes('colspan'))
    expect(metaRow).toContain('<td></td>')
    expect(content).not.toContain('—')
  })

  it('renders custom icon when x-icon is present', async () => {
    const schemaWithIcon = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'string',
          description: 'A test property',
          'x-icon': '🎯',
        },
      },
    }

    mockFs(schemaWithIcon)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('🎯')
  })

  it('escapes html-significant characters in x-icon', async () => {
    const schemaWithHtmlIcon = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'string',
          description: 'A test property',
          'x-icon': '<img src=x onerror=alert(1)>',
        },
      },
    }

    mockFs(schemaWithHtmlIcon)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(content).not.toContain('<img src=x')
  })

  it('renders no icon when x-icon is not present', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    // There is no fallback icon — the name stands on its own
    expect(content).not.toContain('🔧')
    expect(content).toContain('<td><code>testProp</code></td>')
  })

  it('formats string default values with quotes', async () => {
    const schemaWithStringDefault = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'string',
          description: 'A test property',
          default: 'default-value',
        },
      },
    }

    mockFs(schemaWithStringDefault)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('"default-value"')
  })

  it('formats boolean default values without quotes', async () => {
    const schemaWithBooleanDefault = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'boolean',
          description: 'A test property',
          default: false,
        },
      },
    }

    mockFs(schemaWithBooleanDefault)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('<code>false</code>')
  })

  it('formats number default values without quotes', async () => {
    const schemaWithNumberDefault = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'number',
          description: 'A test property',
          default: 42,
        },
      },
    }

    mockFs(schemaWithNumberDefault)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('<code>42</code>')
  })

  it('formats object default values as JSON', async () => {
    const schemaWithObjectDefault = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'object',
          description: 'A test property',
          default: { key: 'value' },
        },
      },
    }

    mockFs(schemaWithObjectDefault)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('{"key":"value"}')
  })

  it('formats array default values as JSON', async () => {
    const schemaWithArrayDefault = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'array',
          description: 'A test property',
          default: ['item1', 'item2'],
        },
      },
    }

    mockFs(schemaWithArrayDefault)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('["item1","item2"]')
  })

  it('renders enum values as an allowed list in the detail row', async () => {
    const schemaWithEnum = {
      ...minimalSchema,
      properties: {
        input: {
          type: 'string',
          description: 'Source format.',
          enum: ['json', 'zod', 'typebox'],
        },
      },
    }

    mockFs(schemaWithEnum)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('<strong>Allowed:</strong>')
    expect(content).toContain('<code>"json"</code>')
    expect(content).toContain('<code>"zod"</code>')
    expect(content).toContain('<code>"typebox"</code>')
  })

  it('renders examples in the detail row', async () => {
    const schemaWithExamples = {
      ...minimalSchema,
      properties: {
        schema: {
          type: 'string',
          description: 'Path to the schema.',
          examples: ['./schema.json'],
        },
      },
    }

    mockFs(schemaWithExamples)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('<strong>Examples:</strong>')
    expect(content).toContain('<code>"./schema.json"</code>')
  })

  it('renders both enum and examples alongside the description', async () => {
    const schemaWithBoth = {
      ...minimalSchema,
      properties: {
        input: {
          type: 'string',
          description: 'Source format.',
          enum: ['json', 'zod'],
          examples: ['json'],
        },
      },
    }

    mockFs(schemaWithBoth)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    const detailRow = (content as string).split('<tr>').find((row: string) => row.includes('colspan'))
    expect(detailRow).toContain('Source format.')
    expect(detailRow).toContain('<strong>Allowed:</strong>')
    expect(detailRow).toContain('<strong>Examples:</strong>')
  })

  it('omits the allowed and examples lines when neither is present', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).not.toContain('<strong>Allowed:</strong>')
    expect(content).not.toContain('<strong>Examples:</strong>')
  })

  it('omits the allowed line when enum is an empty array', async () => {
    const schemaWithEmptyEnum = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'string',
          description: 'A test property',
          enum: [] as string[],
        },
      },
    }

    mockFs(schemaWithEmptyEnum)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).not.toContain('<strong>Allowed:</strong>')
  })

  it('links object properties to a detail table rendered below', async () => {
    const schemaWithNestedObject = {
      ...minimalSchema,
      properties: {
        server: {
          type: 'object',
          description: 'Server settings',
          properties: {
            host: {
              type: 'string',
              description: 'Hostname to bind',
            },
            port: {
              type: 'number',
              description: 'Port to listen on',
              default: 8080,
            },
          },
        },
      },
    }

    mockFs(schemaWithNestedObject)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    // Parent row links to the detail table anchor
    expect(content).toContain('<a href="#config-server"><code>server</code></a>')
    // Detail table has a matching anchor and heading
    expect(content).toContain('<a id="config-server"></a>')
    expect(content).toContain('#### `server`')
    // Nested fields appear in the detail table by their local name
    expect(content).toContain('<code>host</code>')
    expect(content).toContain('<code>port</code>')
    expect(content).toContain('<code>8080</code>')
  })

  it('renders a detail table per level for deeply nested objects', async () => {
    const schemaWithDeepNesting = {
      ...minimalSchema,
      properties: {
        a: {
          type: 'object',
          description: 'Level a',
          properties: {
            b: {
              type: 'object',
              description: 'Level b',
              properties: {
                c: {
                  type: 'string',
                  description: 'Level c',
                },
              },
            },
          },
        },
      },
    }

    mockFs(schemaWithDeepNesting)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    // Each object links to the next level's table
    expect(content).toContain('<a href="#config-a"><code>a</code></a>')
    expect(content).toContain('<a href="#config-a-b"><code>b</code></a>')
    expect(content).toContain('<a id="config-a-b"></a>')
    expect(content).toContain('#### `a.b`')
    expect(content).toContain('<code>c</code>')
  })

  it('marks nested required properties using the nested required list', async () => {
    const schemaWithNestedRequired = {
      ...minimalSchema,
      properties: {
        server: {
          type: 'object',
          description: 'Server settings',
          required: ['host'],
          properties: {
            host: {
              type: 'string',
              description: 'Hostname to bind',
            },
            port: {
              type: 'number',
              description: 'Port to listen on',
            },
          },
        },
      },
    }

    mockFs(schemaWithNestedRequired)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    const rows = (content as string).split('<tr>')
    const hostRow = rows.find((row: string) => row.includes('<code>host</code>') && !row.includes('colspan'))
    const portRow = rows.find((row: string) => row.includes('<code>port</code>') && !row.includes('colspan'))
    expect(hostRow).toContain('✅')
    expect(portRow).not.toContain('✅')
  })

  it('omits the Default column entirely when no property has a default', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    // No defaults anywhere -> the whole column disappears, no placeholder dash
    expect(content).not.toContain('<th align="center">Default</th>')
    expect(content).not.toContain('—')
  })

  it('treats a null default as no default and leaves the cell empty', async () => {
    const schemaWithNullDefault = {
      ...minimalSchema,
      properties: {
        real: { type: 'string', description: 'Has a default', default: 'x' },
        nullish: { type: 'null', description: 'Null default', default: null },
      },
    }

    mockFs(schemaWithNullDefault)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    // The real default keeps the column alive; the null one renders empty
    expect(content).toContain('<th align="center">Default</th>')
    const metaRow = (content as string)
      .split('<tr>')
      .find((row: string) => row.includes('<code>nullish</code>') && !row.includes('colspan'))
    expect(metaRow).toContain('<td align="center"></td>')
    expect(content).not.toContain('—')
  })

  it('uses first paragraph of description in table', async () => {
    const schemaWithMultiParagraph = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'string',
          description: 'First paragraph.\n\nSecond paragraph.',
        },
      },
    }

    mockFs(schemaWithMultiParagraph)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('First paragraph.')
    expect(content).not.toContain('Second paragraph.')
  })

  it('replaces newlines with spaces in description', async () => {
    const schemaWithNewlines = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'string',
          description: 'Line one\nLine two\nLine three',
        },
      },
    }

    mockFs(schemaWithNewlines)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('Line one Line two Line three')
  })

  it('handles missing description gracefully', async () => {
    const schemaWithoutDescription = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'string',
        },
      },
    }

    mockFs(schemaWithoutDescription)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('testProp')
  })

  it('renders the description in a full-width row below the metadata', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    // Minimal schema renders only Property + Type, so the detail row spans 2
    expect(content).toContain('<td colspan="2">A test property</td>')
  })

  it('escapes html-significant characters in cli flags', async () => {
    const schemaWithAngleBrackets = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'string',
          description: 'A test property',
          'x-cli-flag': '--out <dir>',
        },
      },
    }

    mockFs(schemaWithAngleBrackets)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('<code>--out &lt;dir&gt;</code>')
  })

  it('includes every column header when the schema uses every feature', async () => {
    const fullSchema = {
      title: 'Full',
      required: ['testProp'],
      properties: {
        testProp: {
          type: 'string',
          description: 'A test property',
          'x-cli-flag': '--test',
          default: 'value',
        },
      },
    }

    mockFs(fullSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('<th>Property</th>')
    expect(content).toContain('<th>CLI Flag</th>')
    expect(content).toContain('<th>Type</th>')
    expect(content).toContain('<th align="center">Required</th>')
    expect(content).toContain('<th align="center">Default</th>')
  })

  it('renders only Property and Type columns for a minimal schema', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('<th>Property</th>')
    expect(content).toContain('<th>Type</th>')
    expect(content).not.toContain('<th>CLI Flag</th>')
    expect(content).not.toContain('<th align="center">Required</th>')
    expect(content).not.toContain('<th align="center">Default</th>')
  })

  it('handles multiple properties in schema', async () => {
    const schemaWithMultipleProps = {
      ...minimalSchema,
      properties: {
        prop1: {
          type: 'string',
          description: 'First property',
        },
        prop2: {
          type: 'number',
          description: 'Second property',
        },
        prop3: {
          type: 'boolean',
          description: 'Third property',
        },
      },
    }

    mockFs(schemaWithMultipleProps)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('prop1')
    expect(content).toContain('prop2')
    expect(content).toContain('prop3')
  })

  it('logs success message to console', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    mockFs(minimalSchema)

    await generateMarkdown()

    expect(consoleSpy).toHaveBeenCalledWith('README.md generated successfully.')

    consoleSpy.mockRestore()
  })

  it('resolves schema file path from current working directory', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const calls = readFileMock.mock.calls
    expect(calls[0]?.[0]).toContain(process.cwd())
  })

  it('writes README to correct path', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [path] = writeFileMock.mock.calls[0] ?? []
    expect(path).toContain('README.md')
    expect(path).toContain(process.cwd())
  })

  it('reads schema file and attempts to read README', async () => {
    readFileMock.mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('config.schema.json')) {
        return JSON.stringify(minimalSchema)
      }
      throw new Error('ENOENT')
    })
    writeFileMock.mockImplementation(async () => {})

    await generateMarkdown()

    // Two reads: config.schema.json + README.md attempt
    expect(readFileMock).toHaveBeenCalledTimes(2)
  })

  describe('$ref and $defs resolution', () => {
    it('inlines a top-level $ref into the referenced definition', async () => {
      const schema = {
        title: 'Refs',
        properties: {
          server: { $ref: '#/$defs/server' },
        },
        $defs: {
          server: {
            type: 'object',
            description: 'HTTP server settings.',
            properties: {
              host: { type: 'string', description: 'Hostname to bind.' },
            },
          },
        },
      }

      mockFs(schema)

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      // The ref expands into a linked object row plus its own detail table
      expect(content).toContain('<a href="#config-server"><code>server</code></a>')
      expect(content).toContain('#### `server`')
      expect(content).toContain('<code>host</code>')
      expect(content).toContain('Hostname to bind.')
    })

    it('resolves nested $refs and $refs that point at other $refs', async () => {
      const schema = {
        title: 'Nested refs',
        properties: {
          target: { $ref: '#/$defs/target' },
        },
        $defs: {
          target: {
            type: 'object',
            description: 'A target.',
            properties: {
              publish: { $ref: '#/$defs/publish' },
            },
          },
          publish: {
            type: 'object',
            description: 'Publish settings.',
            properties: {
              registry: { $ref: '#/$defs/registry' },
            },
          },
          registry: { type: 'string', description: 'Registry URL.' },
        },
      }

      mockFs(schema)

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<a href="#config-target"><code>target</code></a>')
      expect(content).toContain('<a href="#config-target-publish"><code>publish</code></a>')
      expect(content).toContain('#### `target.publish`')
      expect(content).toContain('<code>registry</code>')
      expect(content).toContain('Registry URL.')
    })

    it('lets sibling keywords on a $ref override the referenced definition', async () => {
      const schema = {
        title: 'Sibling override',
        properties: {
          primary: { $ref: '#/$defs/url', description: 'The primary endpoint.' },
        },
        $defs: {
          url: { type: 'string', description: 'A generic URL.' },
        },
      }

      mockFs(schema)

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      // The description from the ref site wins over the one in $defs
      expect(content).toContain('The primary endpoint.')
      expect(content).not.toContain('A generic URL.')
    })

    it('terminates on recursive $refs instead of looping forever', async () => {
      const schema = {
        title: 'Recursive',
        properties: {
          node: { $ref: '#/$defs/node' },
        },
        $defs: {
          node: {
            type: 'object',
            description: 'A tree node.',
            properties: {
              value: { type: 'string', description: 'Node value.' },
              child: { $ref: '#/$defs/node' },
            },
          },
        },
      }

      mockFs(schema)

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('#### `node`')
      expect(content).toContain('<code>value</code>')
      // The recursive child resolves to a plain object row, not an infinite tree
      expect(content).toContain('<code>child</code>')
    })

    it('degrades gracefully when a $ref cannot be resolved', async () => {
      const schema = {
        title: 'Broken ref',
        properties: {
          missing: { $ref: '#/$defs/nope', description: 'Points nowhere.' },
        },
        $defs: {},
      }

      mockFs(schema)

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<code>missing</code>')
      expect(content).toContain('Points nowhere.')
    })

    it('infers a union type from enum values when type is absent', async () => {
      const schema = {
        title: 'Enum type',
        properties: {
          format: { enum: ['json', 'zod'], description: 'Source format.' },
        },
      }

      mockFs(schema)

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<code>string</code>')
    })

    it('infers a type from const when type is absent', async () => {
      const schema = {
        title: 'Const type',
        properties: {
          kind: { const: true, description: 'Always true.' },
        },
      }

      mockFs(schema)

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<code>boolean</code>')
    })

    it('infers a union type from anyOf members when type is absent', async () => {
      const schema = {
        title: 'AnyOf type',
        properties: {
          timeout: {
            anyOf: [{ type: 'number' }, { type: 'string' }],
            description: 'Timeout in ms or duration string.',
          },
        },
      }

      mockFs(schema)

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<code>number | string</code>')
    })
  })

  describe('marker injection', () => {
    it('injects table between markers when both markers are present', async () => {
      const existingReadme = `# My Package\n\n<!-- config-table-start -->\nold content\n<!-- config-table-end -->\n\n---\n`

      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string') {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existingReadme
        }
        throw new Error('Unexpected file path')
      })
      writeFileMock.mockImplementation(async () => {})

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('# My Package')
      expect(content).toContain('<!-- config-table-start -->')
      expect(content).toContain('<!-- config-table-end -->')
      expect(content).toContain('testProp')
      expect(content).not.toContain('old content')
      expect(content).toContain('---')
    })

    it('preserves content before start marker', async () => {
      const existingReadme = `# Header\n\nSome intro.\n\n<!-- config-table-start -->\n<!-- config-table-end -->\n`

      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string') {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existingReadme
        }
        throw new Error('Unexpected file path')
      })
      writeFileMock.mockImplementation(async () => {})

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect((content as string).startsWith('# Header\n\nSome intro.')).toBe(true)
    })

    it('preserves content after end marker', async () => {
      const existingReadme = `<!-- config-table-start -->\n<!-- config-table-end -->\n\n## License\n\nMIT\n`

      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string') {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existingReadme
        }
        throw new Error('Unexpected file path')
      })
      writeFileMock.mockImplementation(async () => {})

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('## License')
      expect(content).toContain('MIT')
    })

    it('refuses to overwrite an existing README that has no markers', async () => {
      const existingReadme = `# My Package\n\nNo markers here.\n`

      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string') {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existingReadme
        }
        throw new Error('Unexpected file path')
      })
      writeFileMock.mockImplementation(async () => {})

      // Clobbering a hand-written README would lose content, so we error instead.
      await expect(generateMarkdown()).rejects.toThrow(/without a .* region/)
      expect(writeFileMock).not.toHaveBeenCalled()
    })

    it('refuses to overwrite when only one marker is present', async () => {
      const existingReadme = `# My Package\n\n<!-- config-table-start -->\nno end marker\n`

      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string') {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existingReadme
        }
        throw new Error('Unexpected file path')
      })
      writeFileMock.mockImplementation(async () => {})

      await expect(generateMarkdown()).rejects.toThrow(/without a .* region/)
      expect(writeFileMock).not.toHaveBeenCalled()
    })

    // Only a missing README means "safe to create one". Swallowing every read
    // error let an existing-but-unreadable README be replaced wholesale by the
    // bootstrap path — the opposite of the refusal above.
    it('refuses to overwrite a README it cannot read', async () => {
      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
        const error = new Error('permission denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      })
      writeFileMock.mockImplementation(async () => {})

      await expect(generateMarkdown()).rejects.toThrow(/permission denied/)
      expect(writeFileMock).not.toHaveBeenCalled()
    })

    // What Node actually throws, `code` included — an `Error` without one is a
    // different path, and testing that one left the real missing-file case
    // unexercised.
    it('falls back to table-only when README does not exist', async () => {
      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      writeFileMock.mockImplementation(async () => {})

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('testProp')
    })
  })

  describe('hostile schema input', () => {
    it('escapes control characters in string values so the table survives', async () => {
      // A raw newline inside the <table> ends the HTML block: every tag after it
      // renders as literal text and the row structure is lost.
      mockFs({ title: 'T', properties: { banner: { type: 'string', default: 'line one\n\nline two' } } })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('line one\\n\\nline two')
      const table = String(content).slice(0, String(content).indexOf('</table>'))
      expect(table).not.toContain('\n\n')
    })

    it('renders null members of enum and examples instead of dropping them', async () => {
      mockFs({
        title: 'T',
        properties: { mode: { type: ['string', 'null'], enum: ['auto', null], examples: [null] } },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      // Blank would both contradict the Type column and leave a dangling `, `.
      expect(content).toContain('<code>"auto"</code>, <code>null</code>')
      expect(content).toContain('<strong>Examples:</strong> <code>null</code>')
    })

    it('keeps anchor ids free of characters that would end the attribute', async () => {
      mockFs({ title: 'T', properties: { 'a"b': { type: 'object', properties: { x: { type: 'string' } } } } })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<a id="config-a-b"></a>')
      expect(content).not.toContain('config-a"b')
    })

    it('gives colliding paths distinct anchor ids', async () => {
      // `a.b` the property name and `b` nested under `a` both display as `a.b`,
      // so the id has to disambiguate or one table becomes unreachable.
      mockFs({
        title: 'T',
        properties: {
          'a.b': { type: 'object', properties: { z: { type: 'string' } } },
          a: { type: 'object', properties: { b: { type: 'object', properties: { y: { type: 'string' } } } } },
        },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      const ids = [...String(content).matchAll(/<a id="([^"]+)"/g)].map(([, id]) => id)
      expect(ids).toStrictEqual(['config-a-b', 'config-a', 'config-a-b-2'])
    })

    it('tolerates non-string x-cli-flag and x-icon values', async () => {
      // The schema is parsed, never validated, so the declared type is a hope.
      mockFs({ title: 'T', properties: { a: { type: 'string', 'x-cli-flag': 42, 'x-icon': 7 } } })

      await expect(generateMarkdown()).resolves.toBeUndefined()
      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).not.toContain('CLI Flag')
    })

    it('omits the CLI Flag column when every flag is an empty string', async () => {
      mockFs({ title: 'T', properties: { a: { type: 'string', 'x-cli-flag': '' }, b: { type: 'string' } } })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).not.toContain('<th>CLI Flag</th>')
    })

    it('renders a schema that declares no properties', async () => {
      mockFs({ title: 'T', type: 'object', description: 'nothing' })

      await expect(generateMarkdown()).resolves.toBeUndefined()
      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<table>')
    })

    it('escapes a splice marker that reaches an HTML cell', async () => {
      // Left in, it would make the next run splice against this run's table and
      // duplicate the region on every invocation.
      mockFs({ title: 'T', properties: { b: { type: 'string', 'x-cli-flag': '<!-- config-table-start -->' } } })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      // The bootstrap README carries the markers itself, so check the table
      // region rather than the whole document.
      const table = String(content).slice(String(content).indexOf('<table>'))
      expect(table).not.toContain('<!-- config-table-start -->')
      expect(table).toContain('&lt;!-- config-table-start --&gt;')
    })

    it('refuses to write when a marker reaches the heading, which is not HTML', async () => {
      // The `####` heading is a markdown code span, so its content is literal —
      // escaping it there would double-escape and display the wrong name. The
      // marker guard is what covers this path instead, and it fails loudly.
      mockFs({
        title: 'T',
        properties: {
          'evil <!-- config-table-end --> name': { type: 'object', properties: { x: { type: 'string' } } },
        },
      })

      await expect(generateMarkdown()).rejects.toThrow(/would corrupt README\.md/)
      expect(writeFileMock).not.toHaveBeenCalled()
    })
  })

  describe('$ref inlining', () => {
    it('leaves $ref-shaped values inside default and examples untouched', async () => {
      mockFs({
        title: 'T',
        $defs: { secret: { type: 'string', description: 'SHOULD NOT APPEAR' } },
        properties: {
          tpl: { type: 'object', default: { $ref: '#/$defs/secret' }, examples: [{ $ref: '#/$defs/secret' }] },
        },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      // A documented config value that happens to be $ref-shaped is data, not a
      // reference — inlining it replaces the value the reader is meant to copy.
      expect(content).not.toContain('SHOULD NOT APPEAR')
      expect(content).toContain('#/$defs/secret')
    })

    it('still inlines a property whose name is a data keyword', async () => {
      mockFs({
        title: 'T',
        $defs: { thing: { type: 'string', description: 'REAL DEF' } },
        properties: { default: { $ref: '#/$defs/thing' } },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('REAL DEF')
    })
  })

  describe('README splicing', () => {
    it('is idempotent when the end marker also appears above the region', async () => {
      const schema = { title: 'T', properties: { a: { type: 'string' } } }
      let readme = 'Ends at <!-- config-table-end -->.\n\n<!-- config-table-start -->\nold\n<!-- config-table-end -->\n'

      // Taking the document's *first* end marker sliced backwards, duplicating
      // the span between the two indices on every run.
      const sizes: number[] = []
      for (let run = 0; run < 3; run++) {
        readFileMock.mockImplementation(async (path) => {
          if (typeof path === 'string') {
            if (path.includes('config.schema.json')) return JSON.stringify(schema)
            if (path.includes('README.md')) return readme
          }
          throw new Error('Unexpected file path')
        })
        writeFileMock.mockReset()
        writeFileMock.mockImplementation(async () => {})

        await generateMarkdown()

        readme = String(writeFileMock.mock.calls[0]?.[1] ?? '')
        sizes.push(readme.length)
      }

      expect(new Set(sizes).size).toBe(1)
      expect(readme).toContain('Ends at <!-- config-table-end -->.')
    })
  })

  describe('round-2 hardening', () => {
    it('collapses line endings in every cell, not just formatted values', async () => {
      // A blank line inside the <table> ends its HTML block mid-row. CommonMark
      // counts a bare CR as a line ending too.
      mockFs({
        title: 'T',
        properties: {
          'a\n\nb': { type: 'string', 'x-cli-flag': '--a\n\n--b', 'x-icon': 'i\n\nj', description: 'one\r\rtwo' },
        },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      const table = String(content).slice(String(content).indexOf('<table>'), String(content).indexOf('</table>'))
      expect(table).not.toMatch(/\n[ \t]*\n/)
      expect(table).not.toMatch(/\r/)
    })

    it('does not escape the heading, which is a markdown code span', async () => {
      // Code-span content is literal, so the renderer escapes it — escaping here
      // too displayed `a&amp;b` while the linking cell showed `a&b`.
      mockFs({ title: 'T', properties: { 'a&b': { type: 'object', properties: { x: { type: 'string' } } } } })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('#### `a&b`')
    })

    it('documents a property named __proto__', async () => {
      // Plain assignment sets the prototype, so the property vanished silently.
      // Only JSON.parse can produce this key, never a JS object literal.
      mockFs(JSON.parse('{"title":"T","properties":{"__proto__":{"type":"string"},"normal":{"type":"number"}}}'))

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<code>__proto__</code>')
      expect(content).toContain('<code>normal</code>')
    })

    it('renders a non-finite default the way a nested one renders', async () => {
      // Via JSON.parse, the way an overflowing literal actually reaches the
      // renderer — the number is already `Infinity` by the time it is read.
      mockFs(JSON.parse('{"title":"T","properties":{"a":{"type":"number","default":1e400}}}'))

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      // `Infinity` is not JSON — documenting it tells the reader to type
      // something their parser rejects.
      expect(content).not.toContain('Infinity')
    })

    it('tolerates keywords whose value has the wrong type', async () => {
      // The schema is parsed, never validated, so every declared type is a hope.
      const cases: unknown[] = [
        { title: 'T', properties: { a: { type: 'object', properties: null } } },
        { title: 'T', properties: { a: { type: 'string', enum: 'abc' } } },
        { title: 'T', properties: { a: { type: 'string', examples: 'abc' } } },
        { title: 'T', properties: { a: { type: 'string', description: 5 } } },
        { title: 'T', required: 5, properties: { a: { type: 'string' } } },
        { title: 'T', properties: { a: { type: 'object', required: {}, properties: { b: { type: 'string' } } } } },
      ]

      for (const schema of cases) {
        writeFileMock.mockReset()
        mockFs(schema)
        await expect(generateMarkdown()).resolves.toBeUndefined()
      }
    })
  })

  describe('round-3 hardening', () => {
    it('collapses line endings in the heading path', async () => {
      // The heading is the one place a property name reaches the output neither
      // escaped nor collapsed. A newline ends the code span, and the rest of the
      // name opens a fence, heading, list or raw HTML block that swallows the
      // tables below it.
      mockFs({
        title: 'T',
        properties: {
          'a\n```\n# pwned\n<script>x</script>': { type: 'object', properties: { x: { type: 'string' } } },
        },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      const heading = String(content)
        .split('\n')
        .find((line) => line.startsWith('#### '))
      // The delimiter is a backtick run longer than any run in the name, so the
      // name cannot close it early and escape into inline context.
      expect(heading).toBe('#### ````a ``` # pwned <script>x</script>````')
    })

    it('keeps a name containing a backtick inside its code span', async () => {
      // A single-backtick delimiter is closed by the name's own backtick, and
      // the remainder lands in inline context where raw HTML is live.
      mockFs({
        title: 'T',
        properties: { 'a`<b>OWNED</b>': { type: 'object', properties: { x: { type: 'string' } } } },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      const heading = String(content)
        .split('\n')
        .find((line) => line.startsWith('#### '))
      expect(heading).toBe('#### ``a`<b>OWNED</b>``')
    })

    it('preserves a name that is only backticks, or that has edge spaces', async () => {
      mockFs({
        title: 'T',
        properties: { '` a `': { type: 'object', properties: { x: { type: 'string' } } } },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      const heading = String(content)
        .split('\n')
        .find((line) => line.startsWith('#### '))
      // Padded, because CommonMark strips one leading and trailing space — which
      // is exactly what lets the name's own backticks and spaces survive.
      expect(heading).toBe('#### `` ` a ` ``')
    })

    it('does not pad an all-spaces name in the heading', async () => {
      // CommonMark strips one leading and trailing space only when the content
      // is not entirely spaces, so padding here just widens the name. Tabs and
      // NBSP *are* stripped, so those must stay padded.
      mockFs({ title: 'T', properties: { '   ': { type: 'object', properties: { x: { type: 'string' } } } } })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      const heading = String(content)
        .split('\n')
        .find((line) => line.startsWith('#### '))
      expect(heading).toBe('#### `   `')
    })

    it('truncates a CRLF-authored description to its first paragraph', async () => {
      // CommonMark ends a paragraph at any blank line: CRLF, CR-only, and a
      // line holding only spaces or tabs.
      for (const separator of ['\r\n\r\n', '\r\r', '\n   \n', '\r\n\r']) {
        writeFileMock.mockReset()
        mockFs({
          title: 'T',
          properties: { a: { type: 'string', description: `First para.${separator}SECOND para.` } },
        })

        await generateMarkdown()

        const [, content] = writeFileMock.mock.calls[0] ?? []
        expect(content).not.toContain('SECOND para.')
      }
    })

    it('keeps a CRLF-separated first paragraph whole', async () => {
      // A negative assertion alone cannot catch an over-splitting regex: it
      // passes trivially. CommonMark treats a lone CRLF as one line ending
      // inside a paragraph, so both halves must survive.
      mockFs({
        title: 'T',
        properties: { a: { type: 'string', description: 'One line.\r\nStill first.\r\n\r\nSECOND para.' } },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('One line. Still first.')
      expect(content).not.toContain('SECOND para.')
    })

    it('tolerates null members inside the guarded keywords', async () => {
      // asArray guards the container; these reach a property read on the member.
      const cases: unknown[] = [
        { title: 'T', properties: { a: { anyOf: [null] } } },
        { title: 'T', properties: { a: null } },
        { title: 'T', properties: { a: { type: 'object', properties: { b: null } } } },
        null,
      ]

      for (const schema of cases) {
        writeFileMock.mockReset()
        mockFs(schema)
        await expect(generateMarkdown()).resolves.toBeUndefined()
      }
    })

    it('writes a bootstrap README that a second run can splice', async () => {
      mockFs(minimalSchema)
      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
        throw new Error('ENOENT: no such file or directory')
      })

      await generateMarkdown()
      const first = String(writeFileMock.mock.calls[0]?.[1] ?? '')

      // Without the markers the tool refuses to touch its own output.
      expect(first).toContain('<!-- config-table-start -->')
      expect(first).toContain('<!-- config-table-end -->')

      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string') {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return first
        }
        throw new Error('Unexpected file path')
      })
      writeFileMock.mockReset()
      writeFileMock.mockImplementation(async () => {})

      await generateMarkdown()

      expect(String(writeFileMock.mock.calls[0]?.[1] ?? '')).toBe(first)
    })

    it('takes the start marker closest to the region, not the first in the file', async () => {
      // A marker quoted in a code fence above the region used to become the
      // opener, silently deleting everything down to the real one.
      const existing = [
        '# T',
        '',
        '```',
        '<!-- config-table-start -->',
        '```',
        '',
        'KEEP ME',
        '',
        '<!-- config-table-start -->',
        'OLD',
        '<!-- config-table-end -->',
        '',
      ].join('\n')

      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string') {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existing
        }
        throw new Error('Unexpected file path')
      })
      writeFileMock.mockImplementation(async () => {})

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('KEEP ME')
      expect(content).toContain('```\n<!-- config-table-start -->\n```')
    })
  })
  describe('round-4 hardening', () => {
    it('resolves a $ref that points into an array', async () => {
      // `#/$defs/x/anyOf/0` is an ordinary pointer; refusing to index the array
      // documented the property as a bare name with no type and no description.
      mockFs({
        title: 'T',
        $defs: { holder: { anyOf: [{ type: 'string', description: 'From the first branch.' }, { type: 'number' }] } },
        properties: { p: { $ref: '#/$defs/holder/anyOf/0' } },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<code>string</code>')
      expect(content).toContain('From the first branch.')
    })

    it('resolves a $ref whose segment carries a percent escape', async () => {
      // The pointer arrives as a URI fragment, so a space is written `%20`.
      mockFs({
        title: 'T',
        $defs: { 'a b': { type: 'string', description: 'Spaced definition.' } },
        properties: { p: { $ref: '#/$defs/a%20b' } },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('Spaced definition.')
    })

    it('leaves a pointer segment alone when its percent escape is invalid', async () => {
      mockFs({
        title: 'T',
        $defs: { 'a%zz': { type: 'string', description: 'Literal percent.' } },
        properties: { p: { $ref: '#/$defs/a%zz' } },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('Literal percent.')
    })

    it('does not resolve a pointer through the prototype chain', async () => {
      // Only own properties are addressable. A bare `current[segment]` read let
      // an arbitrary `#/<name>` resolve to whatever had polluted the prototype.
      const proto = Object.prototype as unknown as Record<string, unknown>
      Object.defineProperty(proto, 'polluted', {
        value: { type: 'string', description: 'INJECTED' },
        configurable: true,
      })
      try {
        mockFs({ title: 'T', $defs: {}, properties: { p: { $ref: '#/polluted' } } })

        await expect(generateMarkdown()).resolves.toBeUndefined()
        const [, content] = writeFileMock.mock.calls[0] ?? []
        expect(content).toContain('<code>p</code>')
        expect(content).not.toContain('INJECTED')
      } finally {
        delete proto['polluted']
      }
    })

    it('does not index an array through a non-index name', async () => {
      mockFs({
        title: 'T',
        $defs: { holder: { anyOf: [{ type: 'string' }] } },
        properties: { p: { $ref: '#/$defs/holder/anyOf/length' } },
      })

      await expect(generateMarkdown()).resolves.toBeUndefined()
      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).not.toContain('<code>1</code>')
    })

    it('omits the Required column when the required list names no declared property', async () => {
      // The column would render and then stay blank on every row - exactly the
      // empty column the whole-schema scan exists to suppress.
      mockFs({
        title: 'T',
        properties: {
          a: { type: 'string' },
          nest: { type: 'object', required: ['ghost'], properties: { b: { type: 'string' } } },
        },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).not.toContain('<th align="center">Required</th>')
    })

    it('keeps the Required column when only a nested list names a declared property', async () => {
      mockFs({
        title: 'T',
        properties: {
          nest: { type: 'object', required: ['b'], properties: { b: { type: 'string' } } },
        },
      })

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('<th align="center">Required</th>')
      expect(content).toContain('✅')
    })
    it('refuses a schema whose $refs expand past the node budget', async () => {
      // A definition reused twice per level doubles with depth: 3 KB of schema
      // used to spin forever, or quietly write a README no one could open.
      const $defs: Record<string, unknown> = { a0: { type: 'string' } }
      for (let level = 1; level <= 24; level++) {
        $defs[`a${level}`] = {
          type: 'object',
          properties: { x: { $ref: `#/$defs/a${level - 1}` }, y: { $ref: `#/$defs/a${level - 1}` } },
        }
      }
      mockFs({ title: 'T', $defs, properties: { root: { $ref: '#/$defs/a24' } } })

      await expect(generateMarkdown()).rejects.toThrow(/expand/i)
      expect(writeFileMock).not.toHaveBeenCalled()
    })

    it('does not spell a non-object properties map into rows', async () => {
      // Object.entries on a string yields its characters, which rendered rows
      // named 0 and 1 that the column scan had nothing to fill.
      mockFs({ title: 'T', properties: 'ab' })

      await expect(generateMarkdown()).resolves.toBeUndefined()
      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).not.toContain('<code>0</code>')
      expect(content).not.toContain('<code>1</code>')
    })

    it('names the schema file when it does not hold valid JSON', async () => {
      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('config.schema.json')) return '{ nope'
        throw new Error('Unexpected file path')
      })

      await expect(generateMarkdown()).rejects.toThrow(/config\.schema\.json is not valid JSON/)
      expect(writeFileMock).not.toHaveBeenCalled()
    })
    it('refuses when the markers are present but out of order', async () => {
      // Both markers are in the file, so the message says "region", not
      // "missing" - splicing backwards would duplicate the span between them.
      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string') {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return '<!-- config-table-end -->\nKEEP\n<!-- config-table-start -->\n'
        }
        throw new Error('Unexpected file path')
      })
      writeFileMock.mockImplementation(async () => {})

      await expect(generateMarkdown()).rejects.toThrow(/in that order/)
      expect(writeFileMock).not.toHaveBeenCalled()
    })
  })
})
