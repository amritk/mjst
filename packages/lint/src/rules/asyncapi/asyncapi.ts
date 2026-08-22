import type { RuleEntry, RulesetDefinition } from '../../core/types'
import { LATEST_ASYNCAPI_VERSION } from './schemas'

// AsyncAPI 2.x hangs its two operations off each channel as fixed fields. The
// bracket form (rather than `.publish` / `.subscribe` unions) keeps a channel
// matched once per operation, the way the OpenAPI ruleset walks path items.
const V2_OPERATIONS = '$.channels[*][publish,subscribe]'
const V2_COMPONENT_OPERATIONS = '$.components.channels[*][publish,subscribe]'

// A 2.x message can be written inline, as a `oneOf` list of alternatives, or in
// `components`, and each of those can carry `traits`. Anywhere a rule looks at
// "every message" it has to look at all of them.
const V2_MESSAGES = [
  `${V2_OPERATIONS}.message`,
  `${V2_OPERATIONS}.message.oneOf[*]`,
  `${V2_COMPONENT_OPERATIONS}.message`,
  `${V2_COMPONENT_OPERATIONS}.message.oneOf[*]`,
  '$.components.messages[*]',
]
const V2_MESSAGE_TRAITS = [
  `${V2_OPERATIONS}.message.traits[*]`,
  `${V2_OPERATIONS}.message.oneOf[*].traits[*]`,
  `${V2_COMPONENT_OPERATIONS}.message.traits[*]`,
  `${V2_COMPONENT_OPERATIONS}.message.oneOf[*].traits[*]`,
  '$.components.messages[*].traits[*]',
  '$.components.messageTraits[*]',
]

// Payload rules are gated to messages that leave `schemaFormat` unset: those are
// the only payloads that are AsyncAPI Schema Objects. An Avro or Protobuf
// payload is a different language entirely, and
// `asyncapi-payload-unsupported-schemaFormat` is what reports it.
const V2_DEFAULT_FORMAT_PAYLOADS = [
  '$.components.messageTraits[?(@.schemaFormat === void 0)].payload',
  '$.components.messages[?(@.schemaFormat === void 0)].payload',
  "$.channels[*][publish,subscribe][?(@property === 'message' && @.schemaFormat === void 0)].payload",
]

// `^` selects the payload schema itself from the `default` / `examples` it
// carries, so the function receives the schema and can validate the value
// against it.
const payloadSiblings = (keyword: 'default' | 'examples'): string[] =>
  V2_DEFAULT_FORMAT_PAYLOADS.map((given) => `${given}.${keyword}^`)

const HEADERS_OBJECT_SCHEMA = { type: 'object', properties: { type: { enum: ['object'] } }, required: ['type'] }

/** Rules that apply to every AsyncAPI version. */
const sharedRules: Record<string, RuleEntry> = {
  'asyncapi-channel-parameters': {
    description: 'Channel parameters must be defined, and none may be redundant.',
    given: ['$.channels[*]', '$.components.channels[*]'],
    severity: 'error',
    then: { function: 'asyncApiChannelParameters' },
  },
  'asyncapi-info-contact': {
    description: 'Info object must have a contact object.',
    given: '$.info',
    then: { field: 'contact', function: 'truthy' },
  },
  'asyncapi-info-contact-properties': {
    description: 'Contact object must have name, url, and email.',
    given: '$.info.contact',
    severity: 'warn',
    then: [
      { field: 'name', function: 'truthy' },
      { field: 'url', function: 'truthy' },
      { field: 'email', function: 'truthy' },
    ],
  },
  'asyncapi-info-description': {
    description: 'Info object must have a description.',
    given: '$.info',
    then: { field: 'description', function: 'truthy' },
  },
  'asyncapi-info-license': {
    description: 'Info object must have a license object.',
    given: '$.info',
    then: { field: 'license', function: 'truthy' },
  },
  'asyncapi-info-license-url': {
    description: 'License object should have a url.',
    given: '$.info.license',
    severity: 'warn',
    recommended: false,
    then: { field: 'url', function: 'truthy' },
  },
  'asyncapi-latest-version': {
    // Informational: an older document is valid, just not current. The version
    // named here is the newest one this package bundles a meta-schema for, so the
    // advice never points past what the linter can actually check.
    description: 'AsyncAPI document should use the latest specification version.',
    message: `The latest version is not used. You should update to the "${LATEST_ASYNCAPI_VERSION}" version.`,
    given: '$.asyncapi',
    severity: 'info',
    then: { function: 'schema', functionOptions: { schema: { const: LATEST_ASYNCAPI_VERSION } } },
  },
  'asyncapi-parameter-description': {
    description: 'Parameter objects should have a description.',
    given: ['$.components.parameters[*]', '$.channels[*].parameters[*]'],
    severity: 'warn',
    recommended: false,
    then: { field: 'description', function: 'truthy' },
  },
  'asyncapi-servers': {
    description: 'AsyncAPI object must have a non-empty servers object.',
    given: '$',
    severity: 'warn',
    then: {
      field: 'servers',
      function: 'schema',
      functionOptions: { schema: { type: 'object', minProperties: 1 }, allErrors: true },
    },
  },
  'asyncapi-unused-components-schema': {
    description: 'Potentially unused components schema has been detected.',
    // Unresolved: once `$ref`s are inlined there is nothing left pointing at
    // `#/components/schemas`, so every entry would look unused.
    resolved: false,
    given: '$.components.schemas',
    severity: 'warn',
    then: {
      function: 'unreferencedReusableObject',
      functionOptions: { reusableObjectsLocation: '#/components/schemas' },
    },
  },
  'asyncapi-unused-components-server': {
    description: 'Potentially unused components server has been detected.',
    resolved: false,
    given: '$.components.servers',
    severity: 'warn',
    then: {
      function: 'unreferencedReusableObject',
      functionOptions: { reusableObjectsLocation: '#/components/servers' },
    },
  },
}

/** AsyncAPI 2.x rules. */
const v2Rules: Record<string, RuleEntry> = {
  'asyncapi-channel-no-empty-parameter': {
    description: 'Channel path must not have an empty parameter substitution pattern.',
    formats: ['aas2'],
    given: '$.channels',
    severity: 'warn',
    then: { field: '@key', function: 'pattern', functionOptions: { notMatch: '{}' } },
  },
  'asyncapi-channel-no-query-nor-fragment': {
    description: 'Channel path must not include a query ("?") or fragment ("#") delimiter.',
    formats: ['aas2'],
    given: '$.channels',
    severity: 'warn',
    then: { field: '@key', function: 'pattern', functionOptions: { notMatch: '[\\?#]' } },
  },
  'asyncapi-channel-no-trailing-slash': {
    description: 'Channel path must not end with a slash.',
    formats: ['aas2'],
    given: '$.channels',
    severity: 'warn',
    then: { field: '@key', function: 'pattern', functionOptions: { notMatch: '.+\\/$' } },
  },
  'asyncapi-channel-servers': {
    description: 'Channel servers must be defined in the servers object.',
    formats: ['aas2'],
    given: '$',
    severity: 'error',
    then: { function: 'asyncApiChannelServers' },
  },
  'asyncapi-headers-schema-type-object': {
    description: 'Headers schema type must be "object".',
    formats: ['aas2'],
    given: [
      '$.components.messageTraits[*].headers',
      '$.components.messages[*].headers',
      `${V2_OPERATIONS}.message.headers`,
      `${V2_OPERATIONS}.message.traits[*].headers`,
    ],
    severity: 'error',
    then: { function: 'schema', functionOptions: { schema: HEADERS_OBJECT_SCHEMA, allErrors: true } },
  },
  'asyncapi-message-examples': {
    description: 'Message examples must be valid against the payload and headers schemas.',
    formats: ['aas2'],
    given: [...V2_MESSAGES, ...V2_MESSAGE_TRAITS],
    severity: 'error',
    then: { function: 'asyncApiMessageExamples' },
  },
  'asyncapi-message-messageId-uniqueness': {
    description: 'Every messageId must be unique.',
    formats: ['aas2'],
    given: '$',
    severity: 'error',
    then: { function: 'asyncApiMessageIdUnique' },
  },
  'asyncapi-operation-description': {
    description: 'Operation must have a description.',
    formats: ['aas2'],
    given: V2_OPERATIONS,
    then: { field: 'description', function: 'truthy' },
  },
  'asyncapi-operation-operationId': {
    description: 'Operation must have an operationId.',
    formats: ['aas2'],
    given: V2_OPERATIONS,
    severity: 'error',
    then: { field: 'operationId', function: 'truthy' },
  },
  'asyncapi-operation-operationId-uniqueness': {
    description: 'Every operationId must be unique.',
    formats: ['aas2'],
    given: '$',
    severity: 'error',
    then: { function: 'asyncApiOperationIdUnique' },
  },
  'asyncapi-operation-security': {
    description: 'Operation security must reference a defined security scheme.',
    formats: ['aas2'],
    given: `${V2_OPERATIONS}.security[*]`,
    severity: 'error',
    then: { function: 'asyncApiSecurity', functionOptions: { objectType: 'Operation' } },
  },
  'asyncapi-payload': {
    description: 'Payloads must be valid against the AsyncAPI Schema object.',
    formats: ['aas2'],
    given: V2_DEFAULT_FORMAT_PAYLOADS,
    severity: 'error',
    then: { function: 'asyncApiPayload' },
  },
  'asyncapi-payload-default': {
    description: 'Payload default must be valid against its schema.',
    formats: ['aas2'],
    given: payloadSiblings('default'),
    severity: 'error',
    then: { function: 'asyncApiSchemaValidation', functionOptions: { type: 'default' } },
  },
  'asyncapi-payload-examples': {
    description: 'Payload examples must be valid against their schema.',
    formats: ['aas2'],
    given: payloadSiblings('examples'),
    severity: 'error',
    then: { function: 'asyncApiSchemaValidation', functionOptions: { type: 'examples' } },
  },
  'asyncapi-payload-unsupported-schemaFormat': {
    description: 'Message payload validation is only supported with an unspecified schemaFormat.',
    formats: ['aas2'],
    given: ['$.components.messageTraits[*]', '$.components.messages[*]', `${V2_OPERATIONS}.message`],
    severity: 'info',
    then: { field: 'schemaFormat', function: 'undefined' },
  },
  'asyncapi-schema': {
    description: 'Validate structure of AsyncAPI v2 specification.',
    formats: ['aas2'],
    severity: 'error',
    resolved: false,
    given: '$',
    then: { function: 'asyncApiDocumentSchema', functionOptions: { resolved: false } },
  },
  'asyncapi-schema-default': {
    description: 'Schema default must be valid against its schema.',
    formats: ['aas2'],
    given: [
      '$.components.schemas[*].default^',
      '$.components.parameters[*].schema.default^',
      '$.channels[*].parameters[*].schema.default^',
    ],
    severity: 'error',
    then: { function: 'asyncApiSchemaValidation', functionOptions: { type: 'default' } },
  },
  'asyncapi-schema-examples': {
    description: 'Schema examples must be valid against their schema.',
    formats: ['aas2'],
    given: [
      '$.components.schemas[*].examples^',
      '$.components.parameters[*].schema.examples^',
      '$.channels[*].parameters[*].schema.examples^',
    ],
    severity: 'error',
    then: { function: 'asyncApiSchemaValidation', functionOptions: { type: 'examples' } },
  },
  'asyncapi-server-no-empty-variable': {
    description: 'Server URL must not have an empty variable substitution pattern.',
    formats: ['aas2'],
    given: '$.servers[*].url',
    severity: 'warn',
    then: { function: 'pattern', functionOptions: { notMatch: '{}' } },
  },
  'asyncapi-server-no-trailing-slash': {
    description: 'Server URL must not end with a slash.',
    formats: ['aas2'],
    given: '$.servers[*].url',
    severity: 'warn',
    then: { function: 'pattern', functionOptions: { notMatch: '/$' } },
  },
  'asyncapi-server-not-example-com': {
    description: 'Server URL must not point at example.com.',
    formats: ['aas2'],
    given: '$.servers[*].url',
    severity: 'warn',
    recommended: false,
    then: { function: 'pattern', functionOptions: { notMatch: 'example\\.com' } },
  },
  'asyncapi-server-security': {
    description: 'Server security must reference a defined security scheme.',
    formats: ['aas2'],
    given: '$.servers[*].security[*]',
    severity: 'error',
    then: { function: 'asyncApiSecurity', functionOptions: { objectType: 'Server' } },
  },
  'asyncapi-server-variables': {
    description: 'Server variables must be defined, and none may be redundant.',
    formats: ['aas2'],
    given: ['$.servers[*]', '$.components.servers[*]'],
    severity: 'error',
    then: { function: 'aasServerVariables' },
  },
  'asyncapi-tag-description': {
    description: 'Tag object should have a description.',
    formats: ['aas2'],
    given: '$.tags[*]',
    severity: 'warn',
    recommended: false,
    then: { field: 'description', function: 'truthy' },
  },
  'asyncapi-tags': {
    description: 'AsyncAPI object should have a non-empty tags array.',
    formats: ['aas2'],
    given: '$',
    severity: 'warn',
    then: { field: 'tags', function: 'truthy' },
  },
  'asyncapi-tags-alphabetical': {
    description: 'Tags should be in alphabetical order.',
    formats: ['aas2'],
    given: '$',
    severity: 'warn',
    recommended: false,
    then: { field: 'tags', function: 'alphabetical', functionOptions: { keyedBy: 'name' } },
  },
  'asyncapi-tags-uniqueness': {
    description: 'Tag names must be unique within each tags array.',
    formats: ['aas2'],
    given: [
      '$.tags',
      '$.servers[*].tags',
      '$.components.servers[*].tags',
      `${V2_OPERATIONS}.tags`,
      `${V2_COMPONENT_OPERATIONS}.tags`,
      `${V2_OPERATIONS}.traits[*].tags`,
      `${V2_COMPONENT_OPERATIONS}.traits[*].tags`,
      '$.components.operationTraits[*].tags',
      ...[...V2_MESSAGES, ...V2_MESSAGE_TRAITS].map((given) => `${given}.tags`),
    ],
    severity: 'error',
    then: { function: 'aasTagsUnique' },
  },
}

/** AsyncAPI 3.x rules. 3.0 moved operations to the top level and channels to an addressed map. */
const v3Rules: Record<string, RuleEntry> = {
  'asyncapi-3-channel-no-empty-parameter': {
    description: 'Channel address must not have an empty parameter substitution pattern.',
    formats: ['aas3'],
    given: '$.channels[*]',
    severity: 'warn',
    then: { field: 'address', function: 'pattern', functionOptions: { notMatch: '{}' } },
  },
  'asyncapi-3-channel-no-query-nor-fragment': {
    description: 'Channel address must not include a query ("?") or fragment ("#") delimiter.',
    formats: ['aas3'],
    given: '$.channels[*]',
    severity: 'warn',
    then: { field: 'address', function: 'pattern', functionOptions: { notMatch: '[\\?#]' } },
  },
  'asyncapi-3-channel-no-trailing-slash': {
    description: 'Channel address must not end with a slash.',
    formats: ['aas3'],
    given: '$.channels[*]',
    severity: 'warn',
    then: { field: 'address', function: 'pattern', functionOptions: { notMatch: '.+\\/$' } },
  },
  'asyncapi-3-channel-servers': {
    // 3.0 replaced the 2.x list of server *names* with references, so the check
    // is that each one points into `#/servers`. Unresolved, or the `$ref` this
    // reads would already have been replaced by the server it names.
    description: 'Channel servers must reference servers defined in the servers object.',
    formats: ['aas3'],
    resolved: false,
    given: '$.channels[*]',
    severity: 'error',
    then: { field: '$.servers[*].$ref', function: 'pattern', functionOptions: { match: '^#\\/servers\\/' } },
  },
  'asyncapi-3-document-resolved': {
    description: 'Validate structure of AsyncAPI v3 specification after resolving references.',
    formats: ['aas3'],
    severity: 'error',
    given: '$',
    then: { function: 'asyncApiDocumentSchema', functionOptions: { resolved: true } },
  },
  'asyncapi-3-document-unresolved': {
    description: 'Validate structure of AsyncAPI v3 specification before resolving references.',
    formats: ['aas3'],
    severity: 'error',
    resolved: false,
    given: '$',
    then: { function: 'asyncApiDocumentSchema', functionOptions: { resolved: false } },
  },
  'asyncapi-3-headers-schema-type-object': {
    description: 'Headers schema type must be "object".',
    formats: ['aas3'],
    given: [
      '$.components.messageTraits[*].headers',
      '$.components.messages[*].headers',
      '$.channels[*].messages[*].headers',
      '$.channels[*].messages[*].traits[*].headers',
    ],
    severity: 'error',
    then: { function: 'schema', functionOptions: { schema: HEADERS_OBJECT_SCHEMA, allErrors: true } },
  },
  'asyncapi-3-operation-description': {
    description: 'Operation must have a description.',
    formats: ['aas3'],
    given: '$.operations[*]',
    then: { field: 'description', function: 'truthy' },
  },
  'asyncapi-3-operation-security': {
    description: 'Operation security must reference a defined security scheme.',
    formats: ['aas3'],
    resolved: false,
    given: '$.operations[*].security[*]',
    severity: 'error',
    then: { function: 'asyncApiSecurity', functionOptions: { objectType: 'Operation' } },
  },
  'asyncapi-3-payload-unsupported-schemaFormat': {
    description: 'Message payload validation is only supported with an unspecified schemaFormat.',
    formats: ['aas3'],
    given: ['$.components.messages[*].payload', '$.channels[*].messages[*].payload'],
    severity: 'info',
    then: { field: 'schemaFormat', function: 'undefined' },
  },
  'asyncapi-3-server-no-empty-variable': {
    // 3.0 split the 2.x `url` into `host` and `pathname`, and either may be
    // templated.
    description: 'Server host and pathname must not have an empty variable substitution pattern.',
    formats: ['aas3'],
    given: ['$.servers[*].host', '$.servers[*].pathname'],
    severity: 'warn',
    then: { function: 'pattern', functionOptions: { notMatch: '{}' } },
  },
  'asyncapi-3-server-no-trailing-slash': {
    description: 'Server host must not end with a slash.',
    formats: ['aas3'],
    given: '$.servers[*].host',
    severity: 'warn',
    then: { function: 'pattern', functionOptions: { notMatch: '/$' } },
  },
  'asyncapi-3-server-not-example-com': {
    description: 'Server host must not point at example.com.',
    formats: ['aas3'],
    given: '$.servers[*].host',
    severity: 'warn',
    recommended: false,
    then: { function: 'pattern', functionOptions: { notMatch: 'example\\.com' } },
  },
  'asyncapi-3-tag-description': {
    description: 'Tag object should have a description.',
    formats: ['aas3'],
    given: '$.info.tags[*]',
    severity: 'warn',
    recommended: false,
    then: { field: 'description', function: 'truthy' },
  },
  'asyncapi-3-tags': {
    // 3.0 moved the document's tags under `info`.
    description: 'Info object should have a non-empty tags array.',
    formats: ['aas3'],
    given: '$.info',
    severity: 'warn',
    then: { field: 'tags', function: 'truthy' },
  },
  'asyncapi-3-tags-alphabetical': {
    description: 'Tags should be in alphabetical order.',
    formats: ['aas3'],
    given: '$.info',
    severity: 'warn',
    recommended: false,
    then: { field: 'tags', function: 'alphabetical', functionOptions: { keyedBy: 'name' } },
  },
  'asyncapi-3-tags-uniqueness': {
    description: 'Tag names must be unique within each tags array.',
    formats: ['aas3'],
    given: [
      '$.info.tags',
      '$.servers[*].tags',
      '$.components.servers[*].tags',
      '$.operations[*].tags',
      '$.components.operations[*].tags',
      '$.operations[*].traits[*].tags',
      '$.components.operations[*].traits[*].tags',
      '$.components.operationTraits[*].tags',
      '$.channels[*].messages[*].tags',
      '$.channels[*].messages[*].traits[*].tags',
      '$.components.channels[*].messages[*].tags',
      '$.components.channels[*].messages[*].traits[*].tags',
      '$.components.messages[*].tags',
      '$.components.messages[*].traits[*].tags',
      '$.components.messageTraits[*].tags',
    ],
    severity: 'error',
    then: { function: 'aasTagsUnique' },
  },
}

/** Loupe's built-in AsyncAPI ruleset (`loupe:asyncapi`). */
export const asyncapi: RulesetDefinition = {
  formats: ['aas2', 'aas3'],
  rules: {
    ...sharedRules,
    ...v2Rules,
    ...v3Rules,
  },
}
