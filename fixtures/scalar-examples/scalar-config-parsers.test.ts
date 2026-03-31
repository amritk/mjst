import { exec } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

const execAsync = promisify(exec)

describe('scalar-config-parsers', () => {
  const fixturesDir = join(process.cwd(), 'fixtures', 'scalar-examples')
  const tmpDir = resolve(__dirname, '../../tmp')

  let parseApiReferenceConfigurationWithSourceObject: (input: unknown) => any
  let parseApiReferenceConfigurationWithMultipleSourcesObject: (input: unknown) => any
  let parseAuthenticationConfigurationObject: (input: unknown) => any
  let parseServerObject: (input: unknown) => any
  let parseHtmlRenderingConfigurationObject: (input: unknown) => any
  let parseBaseConfigurationObject: (input: unknown) => any
  let parseSecuritySchemeObject: (input: unknown) => any
  let parseSourceConfigurationObject: (input: unknown) => any

  beforeAll(async () => {
    await execAsync('bun packages/cli/src/cli.ts --schema fixtures/scalar-api-reference-config.json --outDir ./tmp', {
      cwd: resolve(__dirname, '../..'),
    })

    parseApiReferenceConfigurationWithSourceObject = (await import(`${tmpDir}/apiReferenceConfigurationWithSource.ts`))
      .parseApiReferenceConfigurationWithSourceObject

    parseApiReferenceConfigurationWithMultipleSourcesObject = (
      await import(`${tmpDir}/apiReferenceConfigurationWithMultipleSources.ts`)
    ).parseApiReferenceConfigurationWithMultipleSourcesObject

    parseAuthenticationConfigurationObject = (await import(`${tmpDir}/authenticationConfiguration.ts`))
      .parseAuthenticationConfigurationObject

    parseServerObject = (await import(`${tmpDir}/server.ts`)).parseServerObject

    parseHtmlRenderingConfigurationObject = (await import(`${tmpDir}/htmlRenderingConfiguration.ts`))
      .parseHtmlRenderingConfigurationObject

    parseBaseConfigurationObject = (await import(`${tmpDir}/baseConfiguration.ts`)).parseBaseConfigurationObject

    parseSecuritySchemeObject = (await import(`${tmpDir}/securityScheme.ts`)).parseSecuritySchemeObject

    parseSourceConfigurationObject = (await import(`${tmpDir}/sourceConfiguration.ts`)).parseSourceConfigurationObject
  })

  afterAll(async () => {
    // await rm(tmpDir, { recursive: true, force: true })
  })

  const loadFixture = async (filename: string) => {
    const content = await readFile(join(fixturesDir, filename), 'utf-8')
    return JSON.parse(content)
  }

  it('parses a basic configuration with minimal properties', async () => {
    const config = await loadFixture('basic-config.json')

    const result = parseApiReferenceConfigurationWithSourceObject(config)

    expect(result).toBeDefined()
    expect(result.url).toBe('https://petstore3.swagger.io/api/v3/openapi.json')
    expect(result.proxyUrl).toBe('https://proxy.scalar.com')
    expect(result.theme).toBe('default')
    expect(result.darkMode).toBe(false)
    expect(result.layout).toBe('modern')
    expect(result.showSidebar).toBe(true)
  })

  it('parses an advanced configuration with authentication and servers', async () => {
    const config = await loadFixture('advanced-config.json')

    const result = parseApiReferenceConfigurationWithSourceObject(config)

    expect(result.title).toBe('My API Documentation')
    expect(result.slug).toBe('my-api-docs')
    expect(result.theme).toBe('purple')
    expect(result.darkMode).toBe(true)
    expect(result.baseServerURL).toBe('https://api.example.com')
    expect(result.showDeveloperTools).toBe('always')
    expect(result.searchHotKey).toBe('k')
    expect(result.persistAuth).toBe(true)
    expect(result.telemetry).toBe(false)
  })

  it('parses authentication configuration with multiple security schemes', async () => {
    const config = await loadFixture('advanced-config.json')

    const result = parseAuthenticationConfigurationObject(config.authentication)

    expect(result.preferredSecurityScheme).toBe('bearerAuth')
    expect(result.securitySchemes).toBeDefined()
    expect(result.securitySchemes?.bearerAuth).toBeDefined()
    expect(result.securitySchemes?.bearerAuth?.type).toBe('http')
    expect(result.securitySchemes?.bearerAuth?.scheme).toBe('bearer')
    expect(result.securitySchemes?.apiKeyAuth).toBeDefined()
    expect(result.securitySchemes?.apiKeyAuth?.type).toBe('apiKey')
    expect(result.securitySchemes?.apiKeyAuth?.in).toBe('header')
  })

  it('parses server configuration with descriptions', async () => {
    const config = await loadFixture('advanced-config.json')

    const prodServer = parseServerObject(config.servers[0])
    const stagingServer = parseServerObject(config.servers[1])

    expect(prodServer.url).toBe('https://api.example.com/v1')
    expect(prodServer.description).toBe('Production server')
    expect(stagingServer.url).toBe('https://staging.example.com/v1')
    expect(stagingServer.description).toBe('Staging server')
  })

  it('parses metadata for SEO and social sharing', async () => {
    const config = await loadFixture('advanced-config.json')

    const result = parseApiReferenceConfigurationWithSourceObject(config)

    expect(result.metaData).toBeDefined()
    expect(result.metaData?.title).toBe('My API Documentation')
    expect(result.metaData?.description).toBe('Comprehensive API documentation for developers')
    expect(result.metaData?.ogTitle).toBe('My API - Developer Documentation')
    expect(result.metaData?.ogImage).toBe('https://example.com/og-image.png')
  })

  it('parses configuration with multiple document sources', async () => {
    const config = await loadFixture('multiple-sources-config.json')

    const result = parseApiReferenceConfigurationWithMultipleSourcesObject(config)

    expect(result.sources).toBeDefined()
    expect(result.sources).toHaveLength(3)
    expect(result.sources?.[0]?.url).toBe('https://api.example.com/openapi-v1.json')
    expect(result.sources?.[0]?.title).toBe('API v1')
    expect(result.sources?.[0]?.default).toBe(true)
    expect(result.sources?.[1]?.url).toBe('https://api.example.com/openapi-v2.json')
    expect(result.sources?.[2]?.content).toBeDefined()
  })

  it('parses HTML rendering configuration with CDN and page title', async () => {
    const config = await loadFixture('html-rendering-config.json')

    const result = parseHtmlRenderingConfigurationObject(config)

    expect(result.pageTitle).toBe('My API Documentation Portal')
    expect(result.cdn).toBe('https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.24.0')
    expect(result.theme).toBe('deepSpace')
    expect(result.darkMode).toBe(true)
    expect(result.favicon).toBe('https://example.com/favicon.ico')
  })

  it('handles enum validation for theme property', () => {
    const validThemes = [
      'default',
      'alternate',
      'moon',
      'purple',
      'solarized',
      'bluePlanet',
      'saturn',
      'kepler',
      'mars',
      'deepSpace',
      'none',
      'pink',
      'elysiajs',
      'borderless',
    ]

    for (const theme of validThemes) {
      const result = parseBaseConfigurationObject({ theme })
      expect(result.theme).toBe(theme)
    }
  })

  it('handles enum validation for showDeveloperTools property', () => {
    const result1 = parseBaseConfigurationObject({ showDeveloperTools: 'always' })
    expect(result1.showDeveloperTools).toBe('always')

    const result2 = parseBaseConfigurationObject({ showDeveloperTools: 'localhost' })
    expect(result2.showDeveloperTools).toBe('localhost')

    const result3 = parseBaseConfigurationObject({ showDeveloperTools: 'never' })
    expect(result3.showDeveloperTools).toBe('never')
  })

  it('validates security scheme types', () => {
    const apiKey = parseSecuritySchemeObject({
      type: 'apiKey',
      name: 'api_key',
      in: 'header',
    })
    expect(apiKey.type).toBe('apiKey')
    expect(apiKey.in).toBe('header')

    const oauth = parseSecuritySchemeObject({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
        },
      },
    })
    expect(oauth.type).toBe('oauth2')
    expect(oauth.flows).toBeDefined()
  })

  it('handles source configuration with both url and content', () => {
    const urlSource = parseSourceConfigurationObject({
      url: 'https://api.example.com/openapi.json',
      title: 'API Docs',
      default: true,
    })
    expect(urlSource.url).toBe('https://api.example.com/openapi.json')
    expect(urlSource.default).toBe(true)

    const contentSource = parseSourceConfigurationObject({
      content: { openapi: '3.1.0', info: { title: 'Test' } },
      title: 'Inline Spec',
    })
    expect(contentSource.content).toBeDefined()
    expect(typeof contentSource.content).toBe('object')
  })

  it('handles empty or invalid input gracefully', () => {
    const emptyResult = parseBaseConfigurationObject({})
    expect(emptyResult).toBeDefined()

    const nullResult = parseBaseConfigurationObject(null)
    expect(nullResult).toBeDefined()

    const undefinedResult = parseBaseConfigurationObject(undefined)
    expect(undefinedResult).toBeDefined()
  })

  it('coerces invalid types to expected types', () => {
    const result = parseBaseConfigurationObject({
      title: 123,
      showSidebar: 'true',
      telemetry: 1,
    })

    expect(typeof result.title).toBe('string')
    expect(typeof result.showSidebar).toBe('boolean')
    expect(typeof result.telemetry).toBe('boolean')
  })

  it('validates searchHotKey pattern', () => {
    const validKey = parseBaseConfigurationObject({ searchHotKey: 'k' })
    expect(validKey.searchHotKey).toBe('k')

    const anotherValidKey = parseBaseConfigurationObject({ searchHotKey: 'f' })
    expect(anotherValidKey.searchHotKey).toBe('f')
  })

  it('handles custom CSS configuration', () => {
    const customCss = '.api-reference { background: #000; color: #fff; }'
    const result = parseApiReferenceConfigurationWithSourceObject({
      url: 'https://example.com/spec.json',
      customCss,
    })

    expect(result.customCss).toBe(customCss)
  })

  it('handles path routing configuration', () => {
    const booleanRouting = parseApiReferenceConfigurationWithSourceObject({
      url: 'https://example.com/spec.json',
      pathRouting: true,
    })
    expect(booleanRouting.pathRouting).toBe(true)

    const objectRouting = parseApiReferenceConfigurationWithSourceObject({
      url: 'https://example.com/spec.json',
      pathRouting: { basePath: '/docs' },
    })
    expect(typeof objectRouting.pathRouting).toBe('object')
  })

  it('handles sorting configuration', async () => {
    const config = await loadFixture('advanced-config.json')
    const result = parseApiReferenceConfigurationWithSourceObject(config)

    expect(result.tagsSorter).toBe('alpha')
    expect(result.operationsSorter).toBe('method')
    expect(result.defaultOpenAllTags).toBe(true)
  })

  it('coerces incorrect types for required server fields', () => {
    const result = parseServerObject({
      url: 12345,
      description: true,
    })

    expect(typeof result.url).toBe('string')
    expect(result.url).toBe('12345')
    expect(typeof result.description).toBe('string')
  })

  it('handles missing required fields in server object', () => {
    const result = parseServerObject({})

    expect(result).toBeDefined()
    expect(result.url).toBeDefined()
  })

  it('coerces incorrect types for required security scheme fields', () => {
    const result = parseSecuritySchemeObject({
      type: 123,
      name: ['api_key'],
      in: { value: 'header' },
    })

    expect(typeof result.type).toBe('string')
    expect(typeof result.name).toBe('string')
    expect(typeof result.in).toBe('string')
  })

  it('handles invalid enum values with coercion', () => {
    const result = parseBaseConfigurationObject({
      theme: 'invalidTheme',
      showDeveloperTools: 'sometimes',
      layout: 'futuristic',
    })

    expect(result).toBeDefined()
  })

  it('coerces incorrect authentication configuration structure', () => {
    const result = parseAuthenticationConfigurationObject({
      preferredSecurityScheme: 123,
      securitySchemes: 'not-an-object',
    })

    expect(result).toBeDefined()
    expect(typeof result.preferredSecurityScheme).toBe('string')
  })

  it('handles array of sources with incorrect item types', () => {
    const result = parseApiReferenceConfigurationWithMultipleSourcesObject({
      sources: ['not-an-object', 123, null, { url: 12345, title: true }],
    })

    expect(result).toBeDefined()
    expect(Array.isArray(result.sources)).toBe(true)
  })

  it('coerces nested metadata with incorrect types', () => {
    const result = parseApiReferenceConfigurationWithSourceObject({
      url: 'https://example.com/spec.json',
      metaData: {
        title: 12345,
        description: ['array', 'instead', 'of', 'string'],
        ogTitle: { nested: 'object' },
        ogImage: true,
      },
    })

    expect(result.metaData).toBeDefined()
    expect(typeof result.metaData?.title).toBe('number')
    expect(Array.isArray(result.metaData?.description)).toBe(true)
    expect(typeof result.metaData?.ogTitle).toBe('object')
    expect(typeof result.metaData?.ogImage).toBe('boolean')
  })

  it('handles deeply nested incorrect types in oauth2 flows', () => {
    const result = parseSecuritySchemeObject({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 12345,
          tokenUrl: ['https://example.com/token'],
          scopes: 'not-an-object',
        },
      },
    })

    expect(result.type).toBe('oauth2')
    expect(result.flows).toBeDefined()
    if (result.flows?.authorizationCode) {
      expect(typeof result.flows.authorizationCode.authorizationUrl).toBe('number')
      expect(Array.isArray(result.flows.authorizationCode.tokenUrl)).toBe(true)
      expect(typeof result.flows.authorizationCode.scopes).toBe('string')
    }
  })

  it('coerces incorrect types in source configuration with required fields', () => {
    const result = parseSourceConfigurationObject({
      url: null,
      title: 12345,
      default: 'yes',
      content: 'not-an-object',
    })

    expect(result).toBeDefined()
    expect(typeof result.title).toBe('string')
    expect(typeof result.default).toBe('boolean')
  })

  it('handles mixed valid and invalid data in complex configuration', () => {
    const result = parseApiReferenceConfigurationWithSourceObject({
      url: 'https://example.com/spec.json',
      title: 12345,
      darkMode: 'yes',
      showSidebar: 1,
      theme: 999,
      servers: [{ url: 'valid-url' }, 'invalid-server', { url: 12345 }],
      authentication: {
        preferredSecurityScheme: ['bearer'],
        securitySchemes: {
          bearer: {
            type: 12345,
            scheme: true,
          },
        },
      },
    })

    expect(result).toBeDefined()
    expect(typeof result.title).toBe('number')
    expect(typeof result.darkMode).toBe('string')
    expect(typeof result.showSidebar).toBe('number')
    expect(typeof result.theme).toBe('number')
  })

  it('coerces required fields in HTML rendering configuration', () => {
    const result = parseHtmlRenderingConfigurationObject({
      pageTitle: 12345,
      cdn: ['https://cdn.example.com'],
      theme: 12345,
      darkMode: 'true',
      favicon: { url: 'https://example.com/favicon.ico' },
    })

    expect(result).toBeDefined()
    expect(typeof result.pageTitle).toBe('number')
    expect(Array.isArray(result.cdn)).toBe(true)
    expect(typeof result.theme).toBe('number')
    expect(typeof result.darkMode).toBe('string')
    expect(typeof result.favicon).toBe('object')
  })

  it('handles completely malformed nested structures', () => {
    const result = parseApiReferenceConfigurationWithSourceObject({
      url: 'https://example.com/spec.json',
      authentication: [1, 2, 3],
      servers: { url: 'not-an-array' },
      metaData: 'not-an-object',
      pathRouting: 123,
    })

    expect(result).toBeDefined()
    expect(result.url).toBe('https://example.com/spec.json')
  })

  it('coerces all truthy string and numeric values to booleans', () => {
    const result = parseBaseConfigurationObject({
      showSidebar: 0,
      persistAuth: 'no',
      telemetry: 'yes',
      defaultOpenAllTags: null,
    })

    expect(typeof result.showSidebar).toBe('boolean')
    expect(result.showSidebar).toBe(false)
    expect(typeof result.persistAuth).toBe('boolean')
    expect(typeof result.telemetry).toBe('boolean')
    expect(result.defaultOpenAllTags).toBe(null)
  })

  it('handles security scheme with missing required fields based on type', () => {
    const apiKeyScheme = parseSecuritySchemeObject({
      type: 'apiKey',
    })
    expect(apiKeyScheme.type).toBe('apiKey')

    const httpScheme = parseSecuritySchemeObject({
      type: 'http',
    })
    expect(httpScheme.type).toBe('http')

    const oauth2Scheme = parseSecuritySchemeObject({
      type: 'oauth2',
    })
    expect(oauth2Scheme.type).toBe('oauth2')
  })

  it('coerces numeric strings to proper types', () => {
    const result = parseBaseConfigurationObject({
      title: '12345',
      showSidebar: '1',
      telemetry: '0',
    })

    expect(result.title).toBe('12345')
    expect(typeof result.showSidebar).toBe('boolean')
    expect(typeof result.telemetry).toBe('boolean')
  })

  it('handles arrays with all invalid items', () => {
    const result = parseApiReferenceConfigurationWithMultipleSourcesObject({
      sources: [null, undefined, 'string', 123, true, []],
    })

    expect(result).toBeDefined()
    expect(Array.isArray(result.sources)).toBe(true)
  })
})
