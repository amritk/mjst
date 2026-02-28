import { describe, expect, it, mock } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { generateMarkdown } from '#markdown/index'

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

/**
 * Test data representing a minimal valid package.json.
 * Used across multiple tests to avoid repetition.
 */
const minimalPackage = {
  name: 'test-package',
  description: 'A test package',
  version: '1.0.0',
  license: 'MIT',
}

describe('generate-readme', () => {
  it('generates README with minimal schema and package data', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [path, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(path).toContain('README.md')
    expect(content).toContain('test-package')
    expect(content).toContain('A test package')
  })

  it('includes version badge with correct version number', async () => {
    const packageWithVersion = {
      ...minimalPackage,
      version: '2.5.3',
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(packageWithVersion)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('v2.5.3')
    expect(content).toContain('https://img.shields.io/badge/')
  })

  it('handles schema with required properties', async () => {
    const schemaWithRequired = {
      ...minimalSchema,
      required: ['testProp'],
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithRequired)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithOptional)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithCliFlag)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('--test-flag')
  })

  it('renders em dash when CLI flag is not present', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithIcon)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('🎯')
  })

  it('renders default icon when x-icon is not present', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithStringDefault)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithBooleanDefault)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithNumberDefault)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithObjectDefault)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithArrayDefault)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('["item1","item2"]')
  })

  it('renders em dash for undefined default values', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithNullDefault)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithMultiParagraph)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithNewlines)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithoutDescription)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('testProp')
  })

  it('renders examples section when examples are present', async () => {
    const schemaWithExamples = {
      ...minimalSchema,
      examples: [{ testProp: 'example1' }, { testProp: 'example2' }],
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithExamples)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('## Config File Examples')
    expect(content).toContain('example1')
    expect(content).toContain('example2')
  })

  it('omits examples section when no examples are present', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).not.toContain('## Config File Examples')
  })

  it('omits examples section when examples array is empty', async () => {
    const schemaWithEmptyExamples = {
      ...minimalSchema,
      examples: [],
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithEmptyExamples)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).not.toContain('## Config File Examples')
  })

  it('uses custom example titles when x-example-titles is present', async () => {
    const schemaWithTitles = {
      ...minimalSchema,
      examples: [{ testProp: 'example1' }, { testProp: 'example2' }],
      'x-example-titles': ['Custom Title 1', 'Custom Title 2'],
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithTitles)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('Custom Title 1')
    expect(content).toContain('Custom Title 2')
  })

  it('uses default example titles when x-example-titles is not present', async () => {
    const schemaWithExamples = {
      ...minimalSchema,
      examples: [{ testProp: 'example1' }, { testProp: 'example2' }],
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithExamples)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('Example 1')
    expect(content).toContain('Example 2')
  })

  it('uses default title when x-example-titles has fewer entries than examples', async () => {
    const schemaWithMismatchedTitles = {
      ...minimalSchema,
      examples: [{ testProp: 'example1' }, { testProp: 'example2' }, { testProp: 'example3' }],
      'x-example-titles': ['Custom Title 1'],
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithMismatchedTitles)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('Custom Title 1')
    expect(content).toContain('Example 2')
    expect(content).toContain('Example 3')
  })

  it('formats examples as JSON with proper indentation', async () => {
    const schemaWithNestedExample = {
      ...minimalSchema,
      examples: [
        {
          testProp: 'value',
          nested: {
            key: 'value',
          },
        },
      ],
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithNestedExample)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('  "testProp": "value"')
    expect(content).toContain('  "nested": {')
  })

  it('escapes hyphens in badge labels', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('JSON%20Schema')
  })

  it('escapes underscores in badge labels', async () => {
    const packageWithUnderscore = {
      ...minimalPackage,
      name: 'test_package',
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(packageWithUnderscore)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('test_package')
  })

  it('includes logo parameter in badge when provided', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('logo=npm')
    expect(content).toContain('logo=typescript')
  })

  it('includes logoColor parameter in badge when logo is provided', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('logoColor=white')
  })

  it('includes labelColor parameter in badge when provided', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('style=flat-square')
  })

  it('defaults to MIT license when license is not present in package.json', async () => {
    const packageWithoutLicense = {
      name: 'test-package',
      description: 'A test package',
      version: '1.0.0',
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(packageWithoutLicense)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('license-MIT')
  })

  it('uses custom license when present in package.json', async () => {
    const packageWithCustomLicense = {
      ...minimalPackage,
      license: 'Apache-2.0',
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(packageWithCustomLicense)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('license-Apache--2.0')
  })

  it('includes all standard badges', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('version-v1.0.0')
    expect(content).toContain('license-MIT')
    expect(content).toContain('TypeScript-5.x')
    expect(content).toContain('JSON%20Schema-2020--12')
    expect(content).toContain('pnpm-required')
  })

  it('separates badges with non-breaking spaces', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('&nbsp;')
  })

  it('includes package name as heading', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('# test-package')
  })

  it('includes package description as subheading', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('**A test package**')
  })

  it('includes standard sections', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('## Overview')
    expect(content).toContain('## Installation')
    expect(content).toContain('## Usage')
    expect(content).toContain('## Configuration Reference')
    expect(content).toContain('## How It Works')
    expect(content).toContain('## Scripts')
  })

  it('includes table header with correct columns', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
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

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithMultipleProps)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('prop1')
    expect(content).toContain('prop2')
    expect(content).toContain('prop3')
  })

  it('logs success message to console', async () => {
    const consoleSpy = mock(() => {})
    console.log = consoleSpy

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    expect(consoleSpy).toHaveBeenCalledWith('README.md generated successfully.')
  })

  it('resolves file paths from current working directory', async () => {
    const readFileSpy = mock(async (path: string) => {
      if (path.includes('config.schema.json')) {
        return JSON.stringify(minimalSchema)
      }
      if (path.includes('package.json')) {
        return JSON.stringify(minimalPackage)
      }
      throw new Error('Unexpected file path')
    })

    mock.module('node:fs/promises', () => ({
      readFile: readFileSpy,
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const calls = readFileSpy.mock.calls
    expect(calls[0]![0]).toContain(process.cwd())
    expect(calls[1]![0]).toContain(process.cwd())
  })

  it('writes README to correct path', async () => {
    const writeFileSpy = mock(async (_path: string, _content: string) => {})

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: writeFileSpy,
    }))

    await generateMarkdown()

    const [path] = writeFileSpy.mock.calls[0]!
    expect(path).toContain('README.md')
    expect(path).toContain(process.cwd())
  })

  it('reads both files in parallel', async () => {
    const readFileSpy = mock(async (path: string) => {
      if (path.includes('config.schema.json')) {
        return JSON.stringify(minimalSchema)
      }
      if (path.includes('package.json')) {
        return JSON.stringify(minimalPackage)
      }
      throw new Error('Unexpected file path')
    })

    mock.module('node:fs/promises', () => ({
      readFile: readFileSpy,
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    expect(readFileSpy).toHaveBeenCalledTimes(2)
  })

  it('renders overview from schema description', async () => {
    const schemaWithDescription = {
      ...minimalSchema,
      description: 'This tool does something really useful.',
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithDescription)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('This tool does something really useful.')
  })

  it('falls back to schema title in overview when description is absent', async () => {
    const schemaWithoutDescription = {
      title: 'My Tool Title',
      properties: minimalSchema.properties,
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithoutDescription)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('My Tool Title')
  })

  it('detects bun as package manager from scripts', async () => {
    const packageWithBunScripts = {
      ...minimalPackage,
      scripts: {
        test: 'bun test',
        build: 'bun build src/cli.ts',
      },
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(packageWithBunScripts)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('bun install')
  })

  it('detects pnpm as package manager from scripts', async () => {
    const packageWithPnpmScripts = {
      ...minimalPackage,
      scripts: {
        test: 'pnpm vitest',
      },
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(packageWithPnpmScripts)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('pnpm install')
  })

  it('defaults to npm when no scripts are present', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('npm install')
  })

  it('builds CLI example from required properties with x-cli-flag and examples', async () => {
    const schemaWithRequiredFlags = {
      ...minimalSchema,
      required: ['inputFile'],
      properties: {
        inputFile: {
          type: 'string',
          description: 'The input file.',
          'x-cli-flag': '--input <path>',
          examples: ['./input.json'],
        },
      },
    }

    const packageWithBin = {
      ...minimalPackage,
      bin: { 'my-tool': './dist/cli.mjs' },
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithRequiredFlags)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(packageWithBin)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('my-tool --input ./input.json')
  })

  it('uses pkg.name as CLI name when no bin is defined', async () => {
    const schemaWithRequiredFlag = {
      ...minimalSchema,
      required: ['testProp'],
      properties: {
        testProp: {
          type: 'string',
          description: 'A test property.',
          'x-cli-flag': '--test <val>',
          examples: ['hello'],
        },
      },
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithRequiredFlag)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('test-package --test hello')
  })

  it('uses second paragraph of schema description in config file section', async () => {
    const schemaWithMultiParagraphDescription = {
      ...minimalSchema,
      description: 'First paragraph overview.\n\nSecond paragraph explains the config file approach.',
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithMultiParagraphDescription)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('Second paragraph explains the config file approach.')
  })

  it('uses schema $comment in config file section when description has only one paragraph', async () => {
    const schemaWithComment = {
      ...minimalSchema,
      description: 'Single paragraph only.',
      $comment: 'This comment explains the config file.',
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithComment)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('This comment explains the config file.')
  })

  it('renders scripts table from pkg.scripts', async () => {
    const packageWithScripts = {
      ...minimalPackage,
      scripts: {
        test: 'bun test',
        build: 'bun build src/cli.ts --outfile dist/cli.mjs',
      },
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(packageWithScripts)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('bun run test')
    expect(content).toContain('bun run build')
    expect(content).toContain('bun test')
    expect(content).toContain('bun build src/cli.ts --outfile dist/cli.mjs')
  })

  it('renders no scripts message when scripts are absent', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('_No scripts defined._')
  })

  it('derives How It Works steps from schema properties', async () => {
    const schemaWithMultipleProps = {
      ...minimalSchema,
      required: ['first'],
      properties: {
        first: {
          type: 'string',
          description: 'The first required property.',
          'x-cli-flag': '--first <val>',
        },
        second: {
          type: 'boolean',
          description: 'The second optional property.',
          'x-cli-flag': '--second',
        },
      },
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithMultipleProps)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    expect(content).toContain('`first`')
    expect(content).toContain('`second`')
    expect(content).toContain('The first required property')
    expect(content).toContain('The second optional property')
  })

  it('marks optional properties in How It Works', async () => {
    const schemaWithOptionalProp = {
      ...minimalSchema,
      required: [],
      properties: {
        optProp: {
          type: 'boolean',
          description: 'An optional toggle.',
          'x-cli-flag': '--opt',
        },
      },
    }

    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(schemaWithOptionalProp)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    const howItWorksIdx = content.indexOf('## How It Works')
    const propLine = content.slice(howItWorksIdx).split('\n').find((line: string) => line.includes('optProp'))
    expect(propLine).toContain('_(optional)_')
  })

  it('config file command uses package name', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async (path: string) => {
        if (path.includes('config.schema.json')) {
          return JSON.stringify(minimalSchema)
        }
        if (path.includes('package.json')) {
          return JSON.stringify(minimalPackage)
        }
        throw new Error('Unexpected file path')
      }),
      writeFile: mock(async () => {}),
    }))

    await generateMarkdown()

    const [, content] = (writeFile as ReturnType<typeof mock>).mock.calls[0]!
    // The config file usage example should reference the package name in the config filename
    expect(content).toContain('test-package.config.json')
  })
})