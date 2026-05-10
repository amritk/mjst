import { readFile, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateMarkdown } from '.'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

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

const setupFs = (schema: unknown, readme?: string): void => {
  vi.mocked(readFile).mockImplementation(async (path: Parameters<typeof readFile>[0]) => {
    const p = String(path)
    if (p.includes('config.schema.json')) return JSON.stringify(schema)
    if (p.includes('README.md') && readme !== undefined) return readme
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
  })
  vi.mocked(writeFile).mockResolvedValue(undefined)
}

describe('generate-readme', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates properties table from minimal schema', async () => {
    setupFs(minimalSchema)

    await generateMarkdown()

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [path, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    expect(path).toContain('README.md')
    expect(content).toContain('testProp')
  })

  it('handles schema with required properties', async () => {
    const schemaWithRequired = {
      ...minimalSchema,
      required: ['testProp'],
    }

    setupFs(schemaWithRequired)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
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

    setupFs(schemaWithOptional)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    const lines = String(content).split('\n')
    const optionalLine = lines.find((line) => line.includes('optionalProp'))
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

    setupFs(schemaWithCliFlag)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    expect(content).toContain('--test-flag')
  })

  it('renders em dash when CLI flag is not present', async () => {
    setupFs(minimalSchema)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    const lines = String(content).split('\n')
    const propLine = lines.find((line) => line.includes('testProp'))
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

    setupFs(schemaWithIcon)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    expect(content).toContain('🎯')
  })

  it('renders default icon when x-icon is not present', async () => {
    setupFs(minimalSchema)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
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

    setupFs(schemaWithStringDefault)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
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

    setupFs(schemaWithBooleanDefault)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
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

    setupFs(schemaWithNumberDefault)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
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

    setupFs(schemaWithObjectDefault)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
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

    setupFs(schemaWithArrayDefault)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    expect(content).toContain('["item1","item2"]')
  })

  it('renders em dash for undefined default values', async () => {
    setupFs(minimalSchema)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    const lines = String(content).split('\n')
    const propLine = lines.find((line) => line.includes('testProp'))
    const cells = propLine?.split('|').map((cell) => cell.trim())
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

    setupFs(schemaWithNullDefault)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    const lines = String(content).split('\n')
    const propLine = lines.find((line) => line.includes('testProp'))
    const cells = propLine?.split('|').map((cell) => cell.trim())
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

    setupFs(schemaWithMultiParagraph)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
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

    setupFs(schemaWithNewlines)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
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

    setupFs(schemaWithoutDescription)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    expect(content).toContain('testProp')
  })

  it('includes table header with correct columns', async () => {
    setupFs(minimalSchema)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
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

    setupFs(schemaWithMultipleProps)

    await generateMarkdown()

    const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
    expect(content).toContain('prop1')
    expect(content).toContain('prop2')
    expect(content).toContain('prop3')
  })

  it('logs success message to console', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    setupFs(minimalSchema)

    await generateMarkdown()

    expect(consoleSpy).toHaveBeenCalledWith('README.md generated successfully.')
    consoleSpy.mockRestore()
  })

  it('resolves schema file path from current working directory', async () => {
    setupFs(minimalSchema)

    await generateMarkdown()

    const calls = vi.mocked(readFile).mock.calls
    expect(String(calls[0]?.[0])).toContain(process.cwd())
  })

  it('writes README to correct path', async () => {
    setupFs(minimalSchema)

    await generateMarkdown()

    const [path] = vi.mocked(writeFile).mock.calls[0] ?? []
    expect(String(path)).toContain('README.md')
    expect(String(path)).toContain(process.cwd())
  })

  it('reads schema file and attempts to read README', async () => {
    setupFs(minimalSchema)

    await generateMarkdown()

    // Two reads: config.schema.json + README.md attempt
    expect(readFile).toHaveBeenCalledTimes(2)
  })

  describe('marker injection', () => {
    it('injects table between markers when both markers are present', async () => {
      const existingReadme = `# My Package\n\n<!-- config-table-start -->\nold content\n<!-- config-table-end -->\n\n---\n`

      setupFs(minimalSchema, existingReadme)

      await generateMarkdown()

      const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
      expect(content).toContain('# My Package')
      expect(content).toContain('<!-- config-table-start -->')
      expect(content).toContain('<!-- config-table-end -->')
      expect(content).toContain('testProp')
      expect(content).not.toContain('old content')
      expect(content).toContain('---')
    })

    it('preserves content before start marker', async () => {
      const existingReadme = `# Header\n\nSome intro.\n\n<!-- config-table-start -->\n<!-- config-table-end -->\n`

      setupFs(minimalSchema, existingReadme)

      await generateMarkdown()

      const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
      expect(String(content).startsWith('# Header\n\nSome intro.')).toBe(true)
    })

    it('preserves content after end marker', async () => {
      const existingReadme = `<!-- config-table-start -->\n<!-- config-table-end -->\n\n## License\n\nMIT\n`

      setupFs(minimalSchema, existingReadme)

      await generateMarkdown()

      const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
      expect(content).toContain('## License')
      expect(content).toContain('MIT')
    })

    it('falls back to table-only when README has no markers', async () => {
      const existingReadme = `# My Package\n\nNo markers here.\n`

      setupFs(minimalSchema, existingReadme)

      await generateMarkdown()

      const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
      expect(content).not.toContain('# My Package')
      expect(content).toContain('testProp')
    })

    it('falls back to table-only when README does not exist', async () => {
      setupFs(minimalSchema)

      await generateMarkdown()

      const [, content] = vi.mocked(writeFile).mock.calls[0] ?? []
      expect(content).toContain('testProp')
    })
  })
})
