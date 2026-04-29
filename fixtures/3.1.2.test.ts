import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { exec } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

describe('3.1.2', () => {
  const tmpDir = resolve(__dirname, '../tmp')
  let parseDocument: (input: unknown) => unknown

  beforeAll(async () => {
    await execAsync('bun packages/cli/src/cli.ts --schema fixtures/3.1.2-2025-09-15.json --outDir ./tmp', {
      cwd: resolve(__dirname, '..'),
    })
    parseDocument = (await import(`${tmpDir}/document.ts`)).parseDocument
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should parse the document', () => {
    const document = parseDocument({})
    expect(document).toBeDefined()
  })

  // TODO: deeply nested coercion (links/headers/securitySchemes/etc.) is incomplete; re-enable when implemented.
  it.todo('coerces incorrect types to match the schema', () => {
    const document = parseDocument({
      openapi: 123,
      info: {
        title: 456,
        version: 789,
        summary: ['not', 'a', 'string'],
        description: { not: 'a string' },
        termsOfService: 999,
        contact: {
          name: 123,
          url: 456,
          email: 789,
        },
        license: {
          name: 123,
          identifier: 456,
          url: 789,
        },
      },
      jsonSchemaDialect: 456,
      servers: {
        0: {
          url: 123,
          description: 456,
          variables: {
            variableName: {
              enum: 'not an array',
              default: 123,
              description: 456,
            },
          },
        },
      },
      paths: {
        '/api/users': {
          summary: 123,
          description: 456,
          servers: 'not an array',
          parameters: 'not an array',
          get: {
            tags: 'not an array',
            summary: 123,
            description: 456,
            operationId: 789,
            parameters: [
              {
                name: 123,
                in: 456,
                description: 789,
                required: 'not a boolean',
                deprecated: 'not a boolean',
                schema: 'not a schema',
              },
            ],
            requestBody: {
              description: 123,
              content: 'not an object',
              required: 'not a boolean',
            },
            responses: {
              '200': {
                description: 123,
                headers: 'not an object',
                content: {
                  'application/json': {
                    schema: 'not a schema',
                    example: 'some example',
                    encoding: 'not an object',
                  },
                },
                links: 'not an object',
              },
            },
            callbacks: 'not an object',
            deprecated: 'not a boolean',
            security: 'not an array',
            servers: 'not an array',
          },
          post: {
            tags: { not: 'an array' },
            summary: 123,
            description: 456,
            externalDocs: {
              description: 123,
              url: 456,
            },
          },
        },
      },
      webhooks: {
        newUser: {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: 'not a schema',
                },
              },
            },
            responses: {
              '200': {
                description: 123,
              },
            },
          },
        },
      },
      components: {
        schemas: 'not an object',
        responses: 'not an object',
        parameters: {
          userId: {
            name: 123,
            in: 456,
            required: 'not a boolean',
            schema: 'not a schema',
          },
        },
        examples: {
          userExample: {
            summary: 123,
            description: 456,
            value: { id: 1, name: 'test' },
            externalValue: 789,
          },
        },
        requestBodies: {
          userBody: {
            description: 123,
            content: 'not an object',
            required: 'not a boolean',
          },
        },
        headers: {
          'X-Rate-Limit': {
            description: 123,
            required: 'not a boolean',
            deprecated: 'not a boolean',
            schema: 'not a schema',
          },
        },
        securitySchemes: {
          apiKey: {
            type: 123,
            description: 456,
            name: 789,
            in: 999,
          },
          oauth2: {
            type: 123,
            description: 456,
            flows: {
              implicit: {
                authorizationUrl: 123,
                refreshUrl: 456,
                scopes: 'not an object',
              },
              password: {
                tokenUrl: 123,
                refreshUrl: 456,
                scopes: 'not an object',
              },
              clientCredentials: {
                tokenUrl: 123,
                refreshUrl: 456,
                scopes: 'not an object',
              },
              authorizationCode: {
                authorizationUrl: 123,
                tokenUrl: 456,
                refreshUrl: 789,
                scopes: 'not an object',
              },
            },
          },
          bearer: {
            type: 123,
            scheme: 456,
            bearerFormat: 789,
          },
          openId: {
            type: 123,
            openIdConnectUrl: 456,
          },
        },
        links: {
          userLink: {
            operationRef: 123,
            operationId: 456,
            parameters: 'not an object',
            requestBody: 'some body',
            description: 789,
            server: {
              url: 123,
              description: 456,
            },
          },
        },
        callbacks: {
          statusCallback: 'not an object',
        },
        pathItems: {
          '/users': {
            summary: 123,
            description: 456,
          },
        },
      },
      security: {
        0: {
          apiKey: 'not an array',
        },
      },
      tags: {
        0: {
          name: 123,
          description: 456,
          externalDocs: {
            description: 123,
            url: 456,
          },
        },
      },
      externalDocs: {
        description: 123,
        url: 456,
      },
    })
    expect(document).toEqual({
      openapi: '123',
      info: {
        title: '456',
        version: '789',
        summary: 'not,a,string',
        description: '[object Object]',
        termsOfService: '999',
        contact: { name: '123', url: '456', email: '789' },
        license: { name: '123', identifier: '456', url: '789' },
      },
      jsonSchemaDialect: '456',
      servers: [],
      paths: {
        '/api/users': {
          summary: '123',
          description: '456',
          servers: [],
          parameters: [],
          get: {
            tags: [],
            summary: '123',
            description: '456',
            operationId: '789',
            parameters: [
              {
                name: '123',
                in: 'query',
                description: '789',
                required: true,
                deprecated: true,
                schema: {},
              },
            ],
            requestBody: { description: '123', content: {}, required: true },
            responses: {
              '200': {
                description: '123',
                headers: {},
                content: {
                  'application/json': { schema: {}, example: 'some example', encoding: {} },
                },
                links: {},
              },
            },
            callbacks: {},
            deprecated: true,
            security: [],
            servers: [],
          },
          post: {
            tags: [],
            summary: '123',
            description: '456',
            externalDocs: { description: '123', url: '456' },
          },
        },
      },
      webhooks: {
        newUser: {
          post: {
            requestBody: { content: { 'application/json': { schema: {} } } },
            responses: { '200': { description: '123' } },
          },
        },
      },
      components: {
        schemas: {},
        responses: {},
        parameters: {
          userId: {
            name: '123',
            in: 'query',
            required: true,
            schema: {},
          },
        },
        examples: {
          userExample: {
            summary: '123',
            description: '456',
            value: { id: 1, name: 'test' },
            externalValue: '789',
          },
        },
        requestBodies: { userBody: { description: '123', content: {}, required: true } },
        headers: {
          'X-Rate-Limit': {
            description: '123',
            required: true,
            deprecated: true,
            schema: {},
          },
        },
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            description: '456',
            name: 789,
            in: 999,
            scheme: '',
            flows: {},
            openIdConnectUrl: '',
          },
          oauth2: {
            type: 'apiKey',
            description: '456',
            flows: {
              implicit: {
                authorizationUrl: 123,
                refreshUrl: 456,
                scopes: 'not an object',
              },
              password: { tokenUrl: 123, refreshUrl: 456, scopes: 'not an object' },
              clientCredentials: { tokenUrl: 123, refreshUrl: 456, scopes: 'not an object' },
              authorizationCode: {
                authorizationUrl: 123,
                tokenUrl: 456,
                refreshUrl: 789,
                scopes: 'not an object',
              },
            },
            name: '',
            in: 'query',
            scheme: '',
            openIdConnectUrl: '',
          },
          bearer: {
            type: 'apiKey',
            scheme: 456,
            bearerFormat: 789,
            name: '',
            in: 'query',
            flows: {},
            openIdConnectUrl: '',
          },
          openId: { type: 'apiKey', openIdConnectUrl: '456', name: '', in: 'query', scheme: '', flows: {} },
        },
        links: {
          userLink: {
            operationRef: '123',
            operationId: '456',
            parameters: {},
            requestBody: 'some body',
            description: '789',
            server: { url: '123', description: '456' },
          },
        },
        callbacks: { statusCallback: {} },
        pathItems: { '/users': { summary: '123', description: '456' } },
      },
      security: [],
      tags: [],
      externalDocs: { description: '123', url: '456' },
    })
  })
})
