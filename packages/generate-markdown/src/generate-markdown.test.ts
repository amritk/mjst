import { readFile, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateMarkdown } from '.'

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

describe('generate-readme', () => {
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
    expect(metaRow).toContain('—')
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

  it('renders em dash when CLI flag is not present', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    const metaRow = (content as string)
      .split('<tr>')
      .find((row: string) => row.includes('<code>testProp</code>') && !row.includes('colspan'))
    // CLI flag cell falls back to a plain em dash
    expect(metaRow).toContain('<td>—</td>')
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

  it('renders default icon when x-icon is not present', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('🔧')
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

  it('renders em dash for undefined default values', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    const metaRow = (content as string)
      .split('<tr>')
      .find((row: string) => row.includes('<code>testProp</code>') && !row.includes('colspan'))
    // Default column renders an em dash when no default is set
    expect(metaRow).toContain('<td align="center">—</td>')
  })

  it('renders em dash for null default values', async () => {
    const schemaWithNullDefault = {
      ...minimalSchema,
      properties: {
        testProp: {
          type: 'null',
          description: 'A test property',
          default: null,
        },
      },
    }

    mockFs(schemaWithNullDefault)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    const metaRow = (content as string)
      .split('<tr>')
      .find((row: string) => row.includes('<code>testProp</code>') && !row.includes('colspan'))
    // A null default is treated the same as an absent one: an em dash
    expect(metaRow).toContain('<td align="center">—</td>')
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
    expect(content).toContain('<td colspan="5">A test property</td>')
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

  it('includes table header with correct columns', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = writeFileMock.mock.calls[0] ?? []
    expect(content).toContain('<th>Property</th>')
    expect(content).toContain('<th>CLI Flag</th>')
    expect(content).toContain('<th>Type</th>')
    expect(content).toContain('<th align="center">Required</th>')
    expect(content).toContain('<th align="center">Default</th>')
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

    it('falls back to table-only when README has no markers', async () => {
      const existingReadme = `# My Package\n\nNo markers here.\n`

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
      expect(content).not.toContain('# My Package')
      expect(content).toContain('testProp')
    })

    it('falls back to table-only when README does not exist', async () => {
      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        throw new Error('ENOENT: no such file or directory')
      })
      writeFileMock.mockImplementation(async () => {})

      await generateMarkdown()

      const [, content] = writeFileMock.mock.calls[0] ?? []
      expect(content).toContain('testProp')
    })
  })
})
