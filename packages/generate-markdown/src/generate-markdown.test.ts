import { afterAll, describe, expect, it, mock } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'

import { generateMarkdown } from '.'

// Save the real fs functions before any mocking so we can restore them after.
// mock.module does not restore on its own — without this cleanup the mocked module
// leaks into other test files that also use node:fs/promises (e.g. load-config, build-schema).
const realReadFile = readFile
const realWriteFile = writeFile

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

const mockFs = (schema: unknown) =>
  mock.module('node:fs/promises', () => ({
    readFile: mock(async (path: string) => {
      if (path.includes('config.schema.json')) {
        return JSON.stringify(schema)
      }
      throw new Error('Unexpected file path')
    }),
    writeFile: mock(async () => {}),
  }))

describe('generate-readme', () => {
  // Restore the real node:fs/promises after the suite completes so that other test files
  // (e.g. load-config, build-schema) are not affected by the module mock.
  afterAll(() => {
    mock.module('node:fs/promises', () => ({
      readFile: realReadFile,
      writeFile: realWriteFile,
    }))
  })

  it('generates properties table from minimal schema', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [path, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    const lines = content.split('\n')
    const optionalLine = lines.find((line: string) => line.includes('optionalProp'))
    expect(optionalLine).toBeDefined()
    expect(optionalLine).toContain('—')
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    expect(content).toContain('--test-flag')
  })

  it('renders em dash when CLI flag is not present', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    const lines = content.split('\n')
    const propLine = lines.find((line: string) => line.includes('testProp'))
    expect(propLine).toContain('—')
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    expect(content).toContain('🎯')
  })

  it('renders default icon when x-icon is not present', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    expect(content).toContain('`false`')
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    expect(content).toContain('`42`')
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    expect(content).toContain('["item1","item2"]')
  })

  it('renders em dash for undefined default values', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    const lines = content.split('\n')
    const propLine = lines.find((line: string) => line.includes('testProp'))
    const cells = propLine?.split('|').map((cell: string) => cell.trim())
    const defaultCell = cells?.[6]
    expect(defaultCell).toBe('—')
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    const lines = content.split('\n')
    const propLine = lines.find((line: string) => line.includes('testProp'))
    const cells = propLine?.split('|').map((cell: string) => cell.trim())
    const defaultCell = cells?.[6]
    expect(defaultCell).toBe('—')
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    expect(content).toContain('testProp')
  })

  it('includes table header with correct columns', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    expect(content).toContain('| | Property | CLI Flag | Type | Required | Default | Description |')
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

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
    expect(content).toContain('prop1')
    expect(content).toContain('prop2')
    expect(content).toContain('prop3')
  })

  it('logs success message to console', async () => {
    const consoleSpy = mock(() => {})
    console.log = consoleSpy

    mockFs(minimalSchema)

    await generateMarkdown()

    expect(consoleSpy).toHaveBeenCalledWith('README.md generated successfully.')
  })

  it('resolves schema file path from current working directory', async () => {
    const readFileSpy = mock(async (path: string) => {
      if (path.includes('config.schema.json')) {
        return JSON.stringify(minimalSchema)
      }
      throw new Error('Unexpected file path')
    })

    mock.module('node:fs/promises', () => ({
      readFile: readFileSpy,
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const calls = readFileSpy.mock.calls
    expect(calls[0]?.[0]).toContain(process.cwd())
  })

  it('writes README to correct path', async () => {
    const writeFileSpy = mock(async (_path: string, _content: string) => {})

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: writeFileSpy,
    }))

    await generateMarkdown()

    const [path] = writeFileSpy.mock.calls[0] ?? []
    expect(path).toContain('README.md')
    expect(path).toContain(process.cwd())
  })

  it('reads schema file and attempts to read README', async () => {
    const readFileSpy = mock(async (path: string) => {
      if (path.includes('config.schema.json')) {
        return JSON.stringify(minimalSchema)
      }
      throw new Error('ENOENT')
    })

    mock.module('node:fs/promises', () => ({
      readFile: readFileSpy,
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    // Two reads: config.schema.json + README.md attempt
    expect(readFileSpy).toHaveBeenCalledTimes(2)
  })

  describe('marker injection', () => {
    it('injects table between markers when both markers are present', async () => {
      const existingReadme = `# My Package\n\n<!-- config-table-start -->\nold content\n<!-- config-table-end -->\n\n---\n`

      mock.module('node:fs/promises', () => ({
        readFile: mock(async (path: string) => {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existingReadme
          throw new Error('Unexpected file path')
        }),
        writeFile: mock(async () => {}),
      }))

      await generateMarkdown()

      const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
      expect(content).toContain('# My Package')
      expect(content).toContain('<!-- config-table-start -->')
      expect(content).toContain('<!-- config-table-end -->')
      expect(content).toContain('testProp')
      expect(content).not.toContain('old content')
      expect(content).toContain('---')
    })

    it('preserves content before start marker', async () => {
      const existingReadme = `# Header\n\nSome intro.\n\n<!-- config-table-start -->\n<!-- config-table-end -->\n`

      mock.module('node:fs/promises', () => ({
        readFile: mock(async (path: string) => {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existingReadme
          throw new Error('Unexpected file path')
        }),
        writeFile: mock(async () => {}),
      }))

      await generateMarkdown()

      const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
      expect(content.startsWith('# Header\n\nSome intro.')).toBe(true)
    })

    it('preserves content after end marker', async () => {
      const existingReadme = `<!-- config-table-start -->\n<!-- config-table-end -->\n\n## License\n\nMIT\n`

      mock.module('node:fs/promises', () => ({
        readFile: mock(async (path: string) => {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existingReadme
          throw new Error('Unexpected file path')
        }),
        writeFile: mock(async () => {}),
      }))

      await generateMarkdown()

      const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
      expect(content).toContain('## License')
      expect(content).toContain('MIT')
    })

    it('falls back to table-only when README has no markers', async () => {
      const existingReadme = `# My Package\n\nNo markers here.\n`

      mock.module('node:fs/promises', () => ({
        readFile: mock(async (path: string) => {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          if (path.includes('README.md')) return existingReadme
          throw new Error('Unexpected file path')
        }),
        writeFile: mock(async () => {}),
      }))

      await generateMarkdown()

      const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
      expect(content).not.toContain('# My Package')
      expect(content).toContain('testProp')
    })

    it('falls back to table-only when README does not exist', async () => {
      mock.module('node:fs/promises', () => ({
        readFile: mock(async (path: string) => {
          if (path.includes('config.schema.json')) return JSON.stringify(minimalSchema)
          throw new Error('ENOENT: no such file or directory')
        }),
        writeFile: mock(async () => {}),
      }))

      await generateMarkdown()

      const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0] ?? []
      expect(content).toContain('testProp')
    })
  })
})
