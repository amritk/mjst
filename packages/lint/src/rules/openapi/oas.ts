import type { RuleEntry, RulesetDefinition } from '../../core'

const OPERATIONS = '$.paths[*][get,put,post,delete,options,head,patch,trace]'
const WEBHOOK_OPERATIONS = '$.webhooks[*][get,put,post,delete,options,head,patch,trace]'
const OPERATION_ID_URL_SAFE = "^[A-Za-z0-9-._~:/?#\\[\\]@!\\$&'()*+,;=]*$"

/** Rules shared across OpenAPI v2 and v3. */
const sharedRules: Record<string, RuleEntry> = {
  'contact-properties': {
    description: 'Contact object must have name, url, and email.',
    given: '$.info.contact',
    severity: 'warn',
    recommended: false,
    then: [
      { field: 'name', function: 'truthy' },
      { field: 'url', function: 'truthy' },
      { field: 'email', function: 'truthy' },
    ],
  },
  'duplicated-entry-in-enum': {
    description: 'Enum values must not have duplicate entries.',
    given: '$..enum',
    severity: 'warn',
    then: { function: 'schema', functionOptions: { schema: { type: 'array', uniqueItems: true } } },
  },
  'info-contact': {
    description: 'Info object must have a contact object.',
    given: '$.info',
    then: { field: 'contact', function: 'truthy' },
  },
  'info-description': {
    description: 'Info object must have a description.',
    given: '$.info',
    then: { field: 'description', function: 'truthy' },
  },
  'info-license': {
    description: 'Info object should have a license.',
    given: '$.info',
    severity: 'warn',
    recommended: false,
    then: { field: 'license', function: 'truthy' },
  },
  'license-url': {
    description: 'License object should have a url.',
    given: '$.info.license',
    severity: 'warn',
    recommended: false,
    then: { field: 'url', function: 'truthy' },
  },
  'no-$ref-siblings': {
    description: 'Sibling values alongside $ref are ignored.',
    // OpenAPI 3.1 (JSON Schema 2020-12) permits siblings next to `$ref`, so this
    // rule is gated to 2.0 / 3.0 — matching `spectral:oas`.
    formats: ['oas2', 'oas3_0'],
    given: '$..$ref^',
    severity: 'error',
    resolved: false,
    then: { function: 'refSiblings' },
  },
  'no-eval-in-markdown': {
    description: 'Markdown descriptions must not contain "eval(".',
    given: '$..description',
    then: { function: 'pattern', functionOptions: { notMatch: 'eval\\(' } },
  },
  'no-script-tags-in-markdown': {
    description: 'Markdown descriptions must not contain <script> tags.',
    given: '$..description',
    then: { function: 'pattern', functionOptions: { notMatch: '<script' } },
  },
  'openapi-tags': {
    description: 'Top-level tags should be present and non-empty.',
    given: '$.tags',
    severity: 'warn',
    recommended: false,
    then: { function: 'length', functionOptions: { min: 1 } },
  },
  'openapi-tags-alphabetical': {
    description: 'Top-level tags should be in alphabetical order.',
    given: '$.tags',
    severity: 'warn',
    recommended: false,
    then: { function: 'alphabetical', functionOptions: { keyedBy: 'name' } },
  },
  'openapi-tags-uniqueness': {
    description: 'Top-level tag names must be unique.',
    given: '$.tags',
    severity: 'error',
    then: { function: 'oasTagsUnique' },
  },
  'operation-description': {
    description: 'Operation must have a description.',
    given: OPERATIONS,
    then: { field: 'description', function: 'truthy' },
  },
  'operation-operationId': {
    description: 'Operation must have an operationId.',
    given: OPERATIONS,
    then: { field: 'operationId', function: 'truthy' },
  },
  'operation-operationId-unique': {
    description: 'Every operationId must be unique.',
    given: '$.paths',
    severity: 'error',
    then: { function: 'oasOpIdUnique' },
  },
  'operation-operationId-valid-in-url': {
    description: 'operationId must use URL-safe characters.',
    given: OPERATIONS,
    then: { field: 'operationId', function: 'pattern', functionOptions: { match: OPERATION_ID_URL_SAFE } },
  },
  'operation-parameters': {
    description: 'Operation parameters must be unique and non-repeating.',
    given: '$.paths[*][*].parameters',
    then: { function: 'oasOpParams' },
  },
  'operation-singular-tag': {
    description: 'Operation should have a single tag.',
    given: OPERATIONS,
    severity: 'warn',
    recommended: false,
    then: { field: 'tags', function: 'length', functionOptions: { max: 1 } },
  },
  'operation-success-response': {
    description: 'Operation must have at least one 2xx or 3xx response.',
    given: OPERATIONS,
    then: { field: 'responses', function: 'oasOpSuccessResponse' },
  },
  'operation-tags': {
    description: 'Operation must have non-empty tags.',
    given: OPERATIONS,
    then: { field: 'tags', function: 'truthy' },
  },
  'operation-tag-defined': {
    description: 'Operation tags must be defined in the global tags list.',
    given: OPERATIONS,
    then: { function: 'oasTagDefined' },
  },
  'path-declarations-must-exist': {
    description: 'Path parameter declarations must not be empty ({}).',
    given: '$.paths',
    then: { field: '@key', function: 'pattern', functionOptions: { notMatch: '{}' } },
  },
  'path-keys-no-trailing-slash': {
    description: 'Path keys should not end with a slash.',
    given: '$.paths',
    then: { field: '@key', function: 'pattern', functionOptions: { notMatch: '.+\\/$' } },
  },
  'path-not-include-query': {
    description: 'Path keys should not include query strings.',
    given: '$.paths',
    then: { field: '@key', function: 'pattern', functionOptions: { notMatch: '\\?' } },
  },
  'path-params': {
    description: 'Path parameters must be defined and not duplicated.',
    given: '$.paths',
    severity: 'error',
    then: { function: 'oasPathParam' },
  },
  'tag-description': {
    description: 'Tags should have a description.',
    given: '$.tags[*]',
    severity: 'warn',
    recommended: false,
    then: { field: 'description', function: 'truthy' },
  },
  'typed-enum': {
    description: 'Enum values must respect the specified type.',
    given: '$..enum^',
    then: { function: 'typedEnum' },
  },
  'array-items': {
    description: 'Schemas of type array must define items.',
    given: "$..[?(@ && @.type === 'array')]",
    severity: 'error',
    then: { field: 'items', function: 'defined' },
  },
}

/** OpenAPI v2.0-only rules. */
const oas2Rules: Record<string, RuleEntry> = {
  'oas2-anyOf': {
    description: 'anyOf is not available in OpenAPI v2.0.',
    formats: ['oas2'],
    given: '$..anyOf',
    then: { function: 'falsy' },
  },
  'oas2-oneOf': {
    description: 'oneOf is not available in OpenAPI v2.0.',
    formats: ['oas2'],
    given: '$..oneOf',
    then: { function: 'falsy' },
  },
  'oas2-api-host': {
    description: 'OpenAPI host must be present and non-empty.',
    formats: ['oas2'],
    given: '$',
    then: { field: 'host', function: 'truthy' },
  },
  'oas2-api-schemes': {
    description: 'OpenAPI schemes must be present and non-empty.',
    formats: ['oas2'],
    given: '$.schemes',
    then: { function: 'length', functionOptions: { min: 1 } },
  },
  'oas2-discriminator': {
    description: 'Discriminator must reference a required property.',
    formats: ['oas2'],
    given: '$.definitions[*]',
    severity: 'error',
    then: { function: 'oasDiscriminator' },
  },
  'oas2-host-not-example': {
    description: 'Host should not point to example.com.',
    formats: ['oas2'],
    given: '$',
    severity: 'warn',
    recommended: false,
    then: { field: 'host', function: 'pattern', functionOptions: { notMatch: 'example\\.com' } },
  },
  'oas2-host-trailing-slash': {
    description: 'Host should not have a trailing slash.',
    formats: ['oas2'],
    given: '$',
    then: { field: 'host', function: 'pattern', functionOptions: { notMatch: '/$' } },
  },
  'oas2-operation-formData-consume-check': {
    description: 'formData operations must consume form media types.',
    formats: ['oas2'],
    given: OPERATIONS,
    then: { function: 'oasOpFormDataConsumeCheck' },
  },
  'oas2-operation-security-defined': {
    description: 'Operation security must reference defined securityDefinitions.',
    formats: ['oas2'],
    given: '$',
    then: { function: 'oasOpSecurityDefined', functionOptions: { schemesPath: ['securityDefinitions'] } },
  },
  'oas2-parameter-description': {
    description: 'Parameters should have a description.',
    formats: ['oas2'],
    given: '$..parameters[*]',
    severity: 'warn',
    recommended: false,
    then: { field: 'description', function: 'truthy' },
  },
  'oas2-unused-definition': {
    description: 'Definitions should be referenced.',
    formats: ['oas2'],
    given: '$.definitions',
    severity: 'warn',
    resolved: false,
    then: { function: 'unreferencedReusableObject', functionOptions: { reusableObjectsLocation: '#/definitions' } },
  },
  'oas2-valid-schema-example': {
    description: 'Schema examples must be valid against their schema.',
    formats: ['oas2'],
    given: '$..example^',
    severity: 'error',
    then: { function: 'oasSchemaExample' },
  },
  'oas2-valid-media-example': {
    description: 'Media type examples must be valid against their schema.',
    formats: ['oas2'],
    given: ['$..responses[*]', '$..parameters[*]'],
    severity: 'error',
    then: { function: 'oasMediaExample' },
  },
  'oas2-schema': {
    description: 'Validate structure of OpenAPI v2 specification.',
    formats: ['oas2'],
    severity: 'error',
    recommended: true,
    resolved: false,
    given: '$',
    then: { function: 'oasSchema', functionOptions: { version: '2.0' } },
  },
}

/** OpenAPI v3.x rules. */
const oas3Rules: Record<string, RuleEntry> = {
  'oas3-api-servers': {
    description: 'OpenAPI 3 documents must have a non-empty servers array.',
    formats: ['oas3'],
    given: '$.servers',
    then: { function: 'length', functionOptions: { min: 1 } },
  },
  'oas3-examples-value-or-externalValue': {
    description: 'Example objects must use either value or externalValue, not both.',
    formats: ['oas3'],
    given: ['$.components.examples[*]', '$..content[*].examples[*]', '$..parameters[*].examples[*]'],
    then: { function: 'xor', functionOptions: { properties: ['value', 'externalValue'] } },
  },
  'oas3-operation-security-defined': {
    description: 'Operation security must reference defined securitySchemes.',
    formats: ['oas3'],
    given: '$',
    then: { function: 'oasOpSecurityDefined', functionOptions: { schemesPath: ['components', 'securitySchemes'] } },
  },
  'oas3-parameter-description': {
    description: 'Parameters should have a description.',
    formats: ['oas3'],
    given: '$..parameters[*]',
    severity: 'warn',
    recommended: false,
    then: { field: 'description', function: 'truthy' },
  },
  'oas3-server-not-example.com': {
    description: 'Server URLs should not point to example.com.',
    formats: ['oas3'],
    given: '$.servers[*].url',
    severity: 'warn',
    recommended: false,
    then: { function: 'pattern', functionOptions: { notMatch: 'example\\.com' } },
  },
  'oas3-server-trailing-slash': {
    description: 'Server URLs should not have trailing slashes.',
    formats: ['oas3'],
    given: '$.servers[*].url',
    then: { function: 'pattern', functionOptions: { notMatch: './$' } },
  },
  'oas3-server-variables': {
    description: 'Server variables must be defined and used.',
    formats: ['oas3'],
    given: '$.servers[*]',
    severity: 'error',
    then: { function: 'oasServerVariables' },
  },
  'oas3-callbacks-in-callbacks': {
    description: 'Callbacks must not be defined within other callbacks.',
    formats: ['oas3'],
    given: '$..callbacks..callbacks',
    then: { function: 'falsy' },
  },
  'oas3-unused-component': {
    description: 'Reusable components should be referenced.',
    formats: ['oas3'],
    given: '$.components',
    severity: 'warn',
    resolved: false,
    then: { function: 'oasUnusedComponent' },
  },
  'oas3-valid-schema-example': {
    description: 'Schema examples must be valid against their schema.',
    formats: ['oas3'],
    given: '$..example^',
    severity: 'error',
    then: { function: 'oasSchemaExample' },
  },
  'oas3-valid-media-example': {
    description: 'Media type examples must be valid against their schema.',
    formats: ['oas3'],
    given: '$..content[*]',
    severity: 'error',
    then: { function: 'oasMediaExample' },
  },
  'oas3-schema': {
    description: 'Validate structure of OpenAPI v3.0.x specification.',
    formats: ['oas3_0'],
    severity: 'error',
    recommended: true,
    resolved: false,
    given: '$',
    then: { function: 'oasSchema', functionOptions: { version: '3.0' } },
  },
}

/** Rules for features introduced in OpenAPI 3.1 (and still in 3.2). */
const oas31Rules: Record<string, RuleEntry> = {
  'oas3_1-servers-in-webhook': {
    description: 'Webhooks must not define servers.',
    formats: ['oas3_1'],
    given: WEBHOOK_OPERATIONS,
    then: { field: 'servers', function: 'falsy' },
  },
  'oas3_1-callbacks-in-webhook': {
    description: 'Webhooks must not define callbacks.',
    formats: ['oas3_1'],
    given: WEBHOOK_OPERATIONS,
    then: { field: 'callbacks', function: 'falsy' },
  },
  'oas3_1-no-nullable': {
    // `nullable` was removed in OpenAPI 3.1 (JSON Schema 2020-12 uses a `null`
    // type instead) and stays gone in 3.2 — mirroring the oas2-anyOf/oneOf
    // "feature not available in this version" rules.
    description: 'nullable is not available in OpenAPI 3.1 or later; use a "null" type instead.',
    formats: ['oas3_1', 'oas3_2'],
    given: '$..nullable',
    then: { function: 'falsy' },
  },
  'oas3_1-license-identifier': {
    // The License Object's `identifier` (SPDX) field was added in 3.1 and is
    // "mutually exclusive of the url field".
    description: 'License object identifier and url are mutually exclusive.',
    formats: ['oas3_1', 'oas3_2'],
    given: '$.info.license',
    severity: 'error',
    then: { function: 'oasMutuallyExclusive', functionOptions: { properties: ['identifier', 'url'] } },
  },
  'oas3_1-schema': {
    // The official, self-contained OpenAPI 3.1 meta-schema (spec.openapis.org).
    // 3.1 realigned Schema Objects with JSON Schema 2020-12, so the official
    // schema validates the whole document *envelope* while leaving Schema Object
    // internals permissive (a local `$dynamicRef` "#meta" that the runtime
    // validator resolves natively). The 3.0-only `oas3-schema` rule does not
    // apply to 3.1 (different `openapi` version and structure).
    description: 'Validate structure of OpenAPI v3.1 specification.',
    formats: ['oas3_1'],
    severity: 'error',
    recommended: true,
    resolved: false,
    given: '$',
    then: { function: 'oasSchema', functionOptions: { version: '3.1' } },
  },
  'oas3_1-schema-example-deprecated': {
    // JSON Schema 2020-12 deprecates a Schema Object's singular `example` in
    // favor of the `examples` array. Off by default (recommended: false) since
    // singular examples remain widespread and valid-but-deprecated.
    description: 'Schema "example" is deprecated in OpenAPI 3.1; use "examples" instead.',
    formats: ['oas3_1', 'oas3_2'],
    given: '$..example^',
    severity: 'warn',
    recommended: false,
    then: { function: 'oasSchemaExampleDeprecated' },
  },
}

/** Rules for features introduced in OpenAPI 3.2. */
const oas32Rules: Record<string, RuleEntry> = {
  'oas3_2-schema': {
    // The official, self-contained OpenAPI 3.2 meta-schema (spec.openapis.org).
    // Like `oas3_1-schema`, it validates the document envelope and leaves Schema
    // Object internals to JSON Schema 2020-12 via a local `$dynamicRef`.
    description: 'Validate structure of OpenAPI v3.2 specification.',
    formats: ['oas3_2'],
    severity: 'error',
    recommended: true,
    resolved: false,
    given: '$',
    then: { function: 'oasSchema', functionOptions: { version: '3.2' } },
  },
  'oas3_2-additional-operations-standard-method': {
    // `additionalOperations` is for HTTP methods without a dedicated fixed
    // field; the spec forbids redefining a standard method there.
    description: 'additionalOperations must not redefine a standard HTTP method that has its own fixed field.',
    formats: ['oas3_2'],
    given: '$..additionalOperations',
    severity: 'error',
    then: { function: 'oasAdditionalOperations' },
  },
  'oas3_2-server-name-unique': {
    description: 'Server names should be unique across the servers array.',
    formats: ['oas3_2'],
    given: '$.servers',
    severity: 'warn',
    then: { function: 'oasServerNameUnique' },
  },
  'oas3_2-tag-parent-defined': {
    // Tag hierarchies (3.2): a `parent` must name a defined tag, with no cycles.
    // Mirrors `operation-tag-defined` for the new nesting feature.
    description: 'Tag parent must reference a tag defined in the global tags list, without cycles.',
    formats: ['oas3_2'],
    given: '$.tags',
    severity: 'warn',
    then: { function: 'oasTagParentDefined' },
  },
  'oas3_2-tag-kind': {
    // `kind` is free-form with a community registry of conventional values, so
    // this is off by default (recommended: false) to avoid flagging valid
    // custom kinds. Only a present-but-unregistered value is flagged.
    description: 'Tag kind should use a registered value (nav, badge, audience).',
    formats: ['oas3_2'],
    given: '$.tags[*]',
    severity: 'warn',
    recommended: false,
    then: { function: 'oasTagKind' },
  },
  'oas3_2-example-value': {
    // 3.2 added `dataValue`/`serializedValue` to the Example Object with
    // MUST-level exclusivity: dataValue excludes value; serializedValue excludes
    // value and externalValue. (The value/externalValue pair is left to the
    // 3.x-wide oas3-examples-value-or-externalValue rule.)
    description: 'Example object dataValue/serializedValue must not be combined with value or externalValue.',
    formats: ['oas3_2'],
    given: ['$.components.examples[*]', '$..content[*].examples[*]', '$..parameters[*].examples[*]'],
    severity: 'error',
    then: { function: 'oasExampleValue' },
  },
}

/** Loupe's built-in OpenAPI ruleset (`loupe:oas`). */
export const oas: RulesetDefinition = {
  formats: ['oas2', 'oas3'],
  rules: {
    ...sharedRules,
    ...oas2Rules,
    ...oas3Rules,
    ...oas31Rules,
    ...oas32Rules,
  },
}
