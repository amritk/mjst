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

/** Returns the markdown content written to README.md by the last run. */
const writtenContent = (): string => (writeFileMock.mock.calls[0]?.[1] as string) ?? ''

/** Finds the heading line for a property by its dotted path. */
const headingFor = (content: string, path: string): string | undefined =>
  content.split('\n').find((line) => line.startsWith('#') && line.includes(`\`${path}\``))

/** Finds the metadata line that immediately follows a property's heading. */
const metaFor = (content: string, path: string): string | undefined => {
  const lines = content.split('\n')
  const headingIdx = lines.findIndex((line) => line.startsWith('#') && line.includes(`\`${path}\``))
  if (headingIdx === -1) return undefined
  // Skip the blank line separating heading and metadata.
  return lines.slice(headingIdx + 1).find((line) => line.trim().length > 0)
}

describe('generate-readme', () => {
  beforeEach(() => {
    readFileMock.mockReset()
    writeFileMock.mockReset()
  })

  it('generates a property section from a minimal schema', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [path, content] = writeFileMock.mock.calls[0] ?? []
    expect(path).toContain('README.md')
    expect(headingFor(content as string, 'testProp')).toBeDefined()
  })

  it('marks required properties with a Required badge', async () => {
    const schemaWithRequired = {
      ...minimalSchema,
      required: ['testProp'],
    }

    mockFs(schemaWithRequired)

    await generateMarkdown()

    expect(metaFor(writtenContent(), 'testProp')).toContain('**Required**')
  })

  it('omits the Required badge for optional properties', async () => {
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

    expect(metaFor(writtenContent(), 'optionalProp')).not.toContain('Required')
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

    expect(metaFor(writtenContent(), 'testProp')).toContain('`--test-flag`')
  })

  it('omits the CLI flag fact when x-cli-flag is not present', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    const meta = metaFor(writtenContent(), 'testProp')
    expect(meta).toBeDefined()
    expect(meta).not.toContain('--')
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

    expect(headingFor(writtenContent(), 'testProp')).toContain('🎯')
  })

  it('renders default icon when x-icon is not present', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    expect(headingFor(writtenContent(), 'testProp')).toContain('🔧')
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

    expect(metaFor(writtenContent(), 'testProp')).toContain('Default `"default-value"`')
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

    expect(metaFor(writtenContent(), 'testProp')).toContain('Default `false`')
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

    expect(metaFor(writtenContent(), 'testProp')).toContain('Default `42`')
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

    expect(writtenContent()).toContain('{"key":"value"}')
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

    expect(writtenContent()).toContain('["item1","item2"]')
  })

  it('renders nested object properties as deeper sections', async () => {
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

    const content = writtenContent()
    // Parent renders at level 3, children at level 4 keyed by dotted path.
    expect(headingFor(content, 'server')).toMatch(/^### /)
    expect(headingFor(content, 'server.host')).toMatch(/^#### /)
    expect(headingFor(content, 'server.port')).toMatch(/^#### /)
    // Each section carries a stable anchor for deep linking.
    expect(content).toContain('<a id="config-server"></a>')
    expect(content).toContain('<a id="config-server-host"></a>')
    expect(metaFor(content, 'server.port')).toContain('Default `8080`')
  })

  it('renders a section per level for deeply nested objects', async () => {
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

    const content = writtenContent()
    expect(headingFor(content, 'a')).toMatch(/^### /)
    expect(headingFor(content, 'a.b')).toMatch(/^#### /)
    expect(headingFor(content, 'a.b.c')).toMatch(/^##### /)
    expect(content).toContain('<a id="config-a-b-c"></a>')
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

    const content = writtenContent()
    expect(metaFor(content, 'server.host')).toContain('**Required**')
    expect(metaFor(content, 'server.port')).not.toContain('Required')
  })

  it('omits the Default fact for undefined default values', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    expect(metaFor(writtenContent(), 'testProp')).not.toContain('Default')
  })

  it('omits the Default fact for null default values', async () => {
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

    expect(metaFor(writtenContent(), 'testProp')).toContain('Default —')
  })

  it('renders the full multi-paragraph description', async () => {
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

    const content = writtenContent()
    expect(content).toContain('First paragraph.')
    expect(content).toContain('Second paragraph.')
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

    expect(headingFor(writtenContent(), 'testProp')).toBeDefined()
  })

  it('renders each property as its own heading', async () => {
    mockFs(minimalSchema)

    await generateMarkdown()

    expect(headingFor(writtenContent(), 'testProp')).toMatch(/^### .* `testProp`$/)
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

    const content = writtenContent()
    expect(headingFor(content, 'prop1')).toBeDefined()
    expect(headingFor(content, 'prop2')).toBeDefined()
    expect(headingFor(content, 'prop3')).toBeDefined()
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
    it('injects the reference between markers when both markers are present', async () => {
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

      const content = writtenContent()
      expect(content).toContain('# My Package')
      expect(content).toContain('<!-- config-table-start -->')
      expect(content).toContain('<!-- config-table-end -->')
      expect(headingFor(content, 'testProp')).toBeDefined()
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

      expect(writtenContent().startsWith('# Header\n\nSome intro.')).toBe(true)
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

      const content = writtenContent()
      expect(content).toContain('## License')
      expect(content).toContain('MIT')
    })

    it('falls back to reference-only when README has no markers', async () => {
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

      const content = writtenContent()
      expect(content).not.toContain('# My Package')
      expect(headingFor(content, 'testProp')).toBeDefined()
    })

    it('falls back to reference-only when README does not exist', async () => {
      readFileMock.mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        throw new Error('ENOENT: no such file or directory')
      })
      writeFileMock.mockImplementation(async () => {})

      await generateMarkdown()

      expect(headingFor(writtenContent(), 'testProp')).toBeDefined()
    })
  })
})
