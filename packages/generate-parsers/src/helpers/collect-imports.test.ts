import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { afterEach, describe, expect, it } from 'vitest'

import { collectImports, collectImportTypeNames } from './collect-imports'

describe('collect-imports', () => {
  it('collects imports from properties with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
        server: { $ref: '#/$defs/server' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type Contact, parseContact, validateContactShape } from './contact.js';",
      "import { type Server, parseServer, validateServerShape } from './server.js';",
    ])
  })

  it('collects imports from array items with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type Server, parseServer, validateServerShape } from './server.js';"])
  })

  it('collects imports from additionalProperties with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        webhooks: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/path-item' },
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItem, parsePathItem, validatePathItemShape } from './path-item.js';"])
  })

  it('collects imports from non-extension patternProperties with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: {
        '^/': { $ref: '#/$defs/path-item' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItem, parsePathItem, validatePathItemShape } from './path-item.js';"])
  })

  it('collects imports from patternProperties with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: {
        '^/': { $ref: '#/$defs/path-item' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItem, parsePathItem, validatePathItemShape } from './path-item.js';"])
  })

  it('collects imports from oneOf with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        response: {
          oneOf: [{ $ref: '#/$defs/response' }, { $ref: '#/$defs/reference' }],
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type Reference, parseReference, validateReferenceShape } from './reference.js';",
      "import { type Response, parseResponse, validateResponseShape } from './response.js';",
    ])
  })

  it('collects imports from anyOf with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        value: {
          anyOf: [{ $ref: '#/$defs/string-value' }, { $ref: '#/$defs/number-value' }],
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type NumberValue, parseNumberValue, validateNumberValueShape } from './number-value.js';",
      "import { type StringValue, parseStringValue, validateStringValueShape } from './string-value.js';",
    ])
  })

  it('collects imports from allOf with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        combined: {
          allOf: [{ $ref: '#/$defs/base' }, { $ref: '#/$defs/extension' }],
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type Base, parseBase, validateBaseShape } from './base.js';",
      "import { type Extension, parseExtension, validateExtensionShape } from './extension.js';",
    ])
  })

  it('deduplicates imports by filename', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact1: { $ref: '#/$defs/contact' },
        contact2: { $ref: '#/$defs/contact' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type Contact, parseContact, validateContactShape } from './contact.js';"])
  })

  it('collects imports from $ref properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        response: { $ref: '#/$defs/response' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type Response, parseResponse, validateResponseShape } from './response.js';"])
  })

  it('handles nested refs in complex schemas', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
        callbacks: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/callback' },
        },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type Callback, parseCallback, validateCallbackShape } from './callback.js';",
      "import { type Server, parseServer, validateServerShape } from './server.js';",
    ])
  })

  it('collects imports from root-level additionalProperties', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/path-item' },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type PathItem, parsePathItem, validatePathItemShape } from './path-item.js';"])
  })

  it('imports Schema parser and type from generated schema.ts', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        schema: { $ref: '#/$defs/schema' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type Schema, parseSchema, validateSchemaShape } from './schema.js';"])
  })

  it('handles empty schema', () => {
    const schema: JSONSchema = {
      type: 'object',
    }

    const result = collectImports(schema)

    expect(result).toEqual([])
  })

  it('handles schema without properties', () => {
    const schema: JSONSchema = {
      type: 'string',
    }

    const result = collectImports(schema)

    expect(result).toEqual([])
  })

  it('collects imports from root-level allOf refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      allOf: [
        { $ref: '#/$defs/security-scheme/$defs/type-apikey' },
        { $ref: '#/$defs/security-scheme/$defs/type-http' },
      ],
    }

    const result = collectImports(schema)

    // A definition nested under another is named for both, so two parents can
    // each hold a `type-apikey`.
    expect(result).toEqual([
      'import { type SecuritySchemeTypeApikey, parseSecuritySchemeTypeApikey, ' +
        "validateSecuritySchemeTypeApikeyShape } from './security-scheme-type-apikey.js';",
      'import { type SecuritySchemeTypeHttp, parseSecuritySchemeTypeHttp, ' +
        "validateSecuritySchemeTypeHttpShape } from './security-scheme-type-http.js';",
    ])
  })

  it('collects imports from all allOf $ref entries', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contentType: { type: 'string' },
      },
      allOf: [{ $ref: '#/$defs/base-schema' }, { $ref: '#/$defs/styles-for-form' }],
    }

    const result = collectImports(schema)

    expect(result).toEqual([
      "import { type BaseSchema, parseBaseSchema, validateBaseSchemaShape } from './base-schema.js';",
      "import { type StylesForForm, parseStylesForForm, validateStylesForFormShape } from './styles-for-form.js';",
    ])
  })

  it('generates type-only imports when typesOnly is true', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
        server: { $ref: '#/$defs/server' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([
      "import type { Contact } from './contact.js';",
      "import type { Server } from './server.js';",
    ])
  })

  it('does not include parser names in type-only imports', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { Contact } from './contact.js';"])
    expect(result[0]).not.toContain('parseContact')
  })

  it('collects type-only imports from $ref properties in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        response: { $ref: '#/$defs/response' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { Response } from './response.js';"])
  })

  it('generates type-only imports from array items $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { Server } from './server.js';"])
  })

  it('generates type-only imports from additionalProperties $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/path-item' },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { PathItem } from './path-item.js';"])
  })

  it('generates type-only imports from anyOf $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        value: {
          anyOf: [{ $ref: '#/$defs/string-value' }, { $ref: '#/$defs/number-value' }],
        },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([
      "import type { NumberValue } from './number-value.js';",
      "import type { StringValue } from './string-value.js';",
    ])
  })

  it('generates type-only imports from allOf $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      allOf: [{ $ref: '#/$defs/base' }, { $ref: '#/$defs/extension' }],
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([
      "import type { Base } from './base.js';",
      "import type { Extension } from './extension.js';",
    ])
  })

  it('deduplicates type-only imports by filename', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact1: { $ref: '#/$defs/contact' },
        contact2: { $ref: '#/$defs/contact' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { Contact } from './contact.js';"])
  })

  it('returns empty array for schema with no $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual([])
  })

  it('collects imports from root-level array items with $ref', () => {
    const schema: JSONSchema = {
      type: 'array',
      items: { $ref: '#/$defs/server' },
    }

    const result = collectImports(schema)

    expect(result).toEqual(["import { type Server, parseServer, validateServerShape } from './server.js';"])
  })

  it('collects imports from root-level array items $ref in typesOnly mode', () => {
    const schema: JSONSchema = {
      type: 'array',
      items: { $ref: '#/$defs/parameter' },
    }

    const result = collectImports(schema, { typesOnly: true })

    expect(result).toEqual(["import type { Parameter } from './parameter.js';"])
  })

  it('collects imports from root-level oneOf refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      oneOf: [{ $ref: '#/$defs/contact' }, { $ref: '#/$defs/server' }],
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
    expect(result).toContain("import { type Server, parseServer, validateServerShape } from './server.js';")
  })

  it('collects imports from root-level anyOf refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      anyOf: [{ $ref: '#/$defs/contact' }, { $ref: '#/$defs/server' }],
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
    expect(result).toContain("import { type Server, parseServer, validateServerShape } from './server.js';")
  })

  it('collects imports from root-level if branch', () => {
    const schema: JSONSchema = {
      if: { $ref: '#/$defs/contact' },
      then: { type: 'object' },
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
  })

  it('collects imports from root-level then branch', () => {
    const schema: JSONSchema = {
      if: { type: 'object' },
      then: { $ref: '#/$defs/server' },
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Server, parseServer, validateServerShape } from './server.js';")
  })

  it('collects imports from root-level else branch', () => {
    const schema: JSONSchema = {
      if: { type: 'object' },
      else: { $ref: '#/$defs/contact' },
    }

    const result = collectImports(schema)

    expect(result).toContain("import { type Contact, parseContact, validateContactShape } from './contact.js';")
  })

  it('does not generate a self-import when a schema references its own $defs key via a property', () => {
    // Mirrors the encoding schema: encoding.ts has a property `itemEncoding` that is a direct
    // $ref back to #/$defs/encoding. Generating `import ... from './encoding.js'` inside encoding.ts
    // would be a circular self-import that crashes at runtime.
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        itemEncoding: { $ref: '#/$defs/encoding' },
        header: { $ref: '#/$defs/header' },
      },
    }

    const result = collectImports(schema, { selfRef: '#/$defs/encoding' })

    expect(result).not.toContain("'./encoding'")
    expect(result).toContain("import { type Header, parseHeader, validateHeaderShape } from './header.js';")
  })

  it('does not generate a self-import when a schema references its own $defs key via additionalProperties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        encoding: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/encoding' },
        },
      },
    }

    const result = collectImports(schema, { selfRef: '#/$defs/encoding' })

    expect(result).not.toContain("'./encoding'")
  })

  it('does not generate a self-import when a schema references its own $defs key via array items', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        prefixEncoding: {
          type: 'array',
          items: { $ref: '#/$defs/encoding' },
        },
      },
    }

    const result = collectImports(schema, { selfRef: '#/$defs/encoding' })

    expect(result).not.toContain("'./encoding'")
  })

  it('does not collect imports for external $refs', () => {
    // External refs (e.g. from draft-04 schemas) cannot be resolved locally and have no generated file.
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        maximum: { $ref: 'http://json-schema.org/draft-04/schema#/properties/maximum' },
        name: { type: 'string' },
      },
    }

    const result = collectImports(schema)

    expect(result).toEqual([])
  })

  it('does not generate a self-import in types-only mode', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        itemEncoding: { $ref: '#/$defs/encoding' },
        header: { $ref: '#/$defs/header' },
      },
    }

    const result = collectImports(schema, { typesOnly: true, selfRef: '#/$defs/encoding' })

    expect(result).not.toContain("'./encoding'")
    expect(result).toContain("import type { Header } from './header.js';")
  })

  it('emits .ts specifiers when importExt is ts', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { contact: { $ref: '#/$defs/contact' } },
    }

    expect(collectImports(schema, { importExt: 'ts' })).toEqual([
      "import { type Contact, parseContact, validateContactShape } from './contact.ts';",
    ])
    expect(collectImports(schema, { typesOnly: true, importExt: 'ts' })).toEqual([
      "import type { Contact } from './contact.ts';",
    ])
  })

  it('imports a $ref used in a tuple position', () => {
    // The type emitter renders a `prefixItems` `$ref` as the referenced type
    // name, so skipping tuple positions here produced a file that names
    // `Contact` with no import for it — output that does not compile.
    const schema = {
      type: 'object' as const,
      properties: {
        pair: { type: 'array' as const, prefixItems: [{ $ref: '#/$defs/Contact' }, { type: 'string' as const }] },
      },
    }
    expect(collectImportTypeNames(schema)).toContain('Contact')
  })

  it('imports a tuple-only $ref as a type, and a mixed one as a value', () => {
    // The parser emitter passes a tuple element through untouched, so importing
    // `parseContact`/`validateContactShape` beside the type leaves two bindings
    // nothing calls — a `noUnusedLocals` error in the consumer's build. A ref
    // used anywhere else still needs the value import.
    const tupleOnly = {
      type: 'object' as const,
      properties: { pair: { type: 'array' as const, prefixItems: [{ $ref: '#/$defs/Contact' }] } },
    }
    expect(collectImports(tupleOnly)).toEqual(["import type { Contact } from './contact.js';"])

    const mixed = {
      type: 'object' as const,
      properties: {
        pair: { type: 'array' as const, prefixItems: [{ $ref: '#/$defs/Contact' }] },
        direct: { $ref: '#/$defs/Contact' },
      },
    }
    expect(collectImports(mixed)).toEqual([
      "import { type Contact, parseContact, validateContactShape } from './contact.js';",
    ])
  })

  it('imports a $ref from a root-level tuple, in either spelling', () => {
    // The root enumerates its keywords by hand, so one missing from that list
    // is never walked at all: a schema that *is* a tuple emitted a type naming
    // `Contact` with no import for it.
    for (const keyword of ['prefixItems', 'items'] as const) {
      const schema = { type: 'array' as const, [keyword]: [{ $ref: '#/$defs/Contact' }, { type: 'string' }] }
      expect(collectImports(schema)).toEqual(["import type { Contact } from './contact.js';"])
    }
  })

  it('treats a draft-07 array-valued items tuple as type-only too', () => {
    const schema = {
      type: 'object' as const,
      properties: { pair: { type: 'array' as const, items: [{ $ref: '#/$defs/Contact' }] } },
    }
    expect(collectImports(schema)).toEqual(["import type { Contact } from './contact.js';"])
  })

  it('keeps the value import for a single-schema items', () => {
    const schema = {
      type: 'object' as const,
      properties: { list: { type: 'array' as const, items: { $ref: '#/$defs/Contact' } } },
    }
    expect(collectImports(schema)).toEqual([
      "import { type Contact, parseContact, validateContactShape } from './contact.js';",
    ])
  })

  describe('a polluted Object.prototype', () => {
    // The walk probes and reads keys off documents the caller supplied, so an
    // inherited one used to read as declared — and the import that followed
    // named a module that was never emitted, so the generated output did not
    // compile.
    const proto = Object.prototype as unknown as Record<string, unknown>
    afterEach(() => {
      for (const key of ['properties', 'prefixItems', 'items', 'if']) delete proto[key]
    })

    for (const key of ['properties', 'prefixItems', 'items', 'if'] as const) {
      it(`conjures no import from an inherited ${key}`, () => {
        proto[key] =
          key === 'prefixItems' || key === 'items' ? [{ $ref: '#/$defs/Ghost' }] : { g: { $ref: '#/$defs/Ghost' } }
        expect(collectImports({ type: 'string' })).toEqual([])
      })
    }
  })

  it('imports a $ref used as a draft-07 tuple rest element', () => {
    // The type emitter renders `additionalItems` as `...Contact[]`, so a `$ref`
    // there needs its import exactly as a fixed position does — and the tuple
    // walk collected the positions but not the rest element.
    const schema = {
      type: 'array' as const,
      items: [{ type: 'string' as const }],
      additionalItems: { $ref: '#/$defs/Contact' },
    }
    expect(collectImports(schema)).toEqual(["import type { Contact } from './contact.js';"])
  })

  describe('conditionals inlined through an allOf $ref', () => {
    // OpenAPI's security scheme, in miniature: the composing schema enumerates
    // `type`, each `allOf` member refs a definition that is an `if`/`then` on it,
    // and one of those `then` arms refs a third definition. The type emitter
    // reads the referenced definition and renders its arms *here*, so
    // `OauthFlows` is a name in this file — but the ref walk stopped at the
    // member, so the file said `OauthFlowsObject` with nothing importing it
    // (`TS2304`) while the member's own file imported it and rendered nothing
    // (`TS6133`).
    const rootSchema = {
      $defs: {
        'security-scheme': {
          type: 'object',
          properties: { type: { enum: ['http', 'oauth2'] } },
          required: ['type'],
          allOf: [{ $ref: '#/$defs/type-oauth2' }],
        },
        'type-oauth2': {
          if: { properties: { type: { const: 'oauth2' } } },
          then: { properties: { flows: { $ref: '#/$defs/oauth-flows' } }, required: ['flows'] },
        },
        'oauth-flows': { type: 'object', properties: { implicit: { type: 'object' } } },
      },
    }

    it('imports the type a referenced conditional names', () => {
      const imports = collectImports(rootSchema.$defs['security-scheme'] as never, {
        rootSchema,
        selfRef: '#/$defs/security-scheme',
      })

      expect(imports).toContain("import type { OauthFlows } from './oauth-flows.js';")
    })

    it('leaves the ref alone when the root document is not on offer to resolve it', () => {
      // Without `rootSchema` the definition cannot be read, so there is nothing
      // to inline and nothing extra to import.
      const imports = collectImports(rootSchema.$defs['security-scheme'] as never, {
        selfRef: '#/$defs/security-scheme',
      })

      expect(imports).not.toContain("import type { OauthFlows } from './oauth-flows.js';")
    })
  })

  describe('usedIn', () => {
    const schema = {
      type: 'object' as const,
      properties: { contact: { $ref: '#/$defs/contact' } },
    }

    it('drops an import the emitted body never spells', () => {
      expect(collectImports(schema, { usedIn: 'export const x = 1' })).toEqual([])
    })

    it('keeps only the bindings the body reads', () => {
      expect(collectImports(schema, { usedIn: 'const a: Contact = parseContact(input)' })).toEqual([
        "import { type Contact, parseContact } from './contact.js';",
      ])
    })

    it('narrows to a type-only import when no function is called', () => {
      expect(collectImports(schema, { usedIn: 'const a: Contact = input' })).toEqual([
        "import type { Contact } from './contact.js';",
      ])
    })

    it('does not count a name that only appears in a comment or a string', () => {
      // A JSDoc block is the schema's `description` verbatim and a validator's
      // error messages quote property names, so prose mentioning a definition
      // would otherwise keep a binding nothing reads.
      expect(collectImports(schema, { usedIn: '/** see Contact */ const m = "parseContact"' })).toEqual([])
    })
  })

  it('tolerates a malformed properties rather than throwing', () => {
    // `properties: null` is malformed, and was ignored before — `Object.values`
    // throws on it, which turned a bad schema into a crash out of the generator.
    expect(collectImports({ type: 'object' as const, properties: null } as never)).toEqual([])
    expect(collectImports({ type: 'object' as const, patternProperties: null } as never)).toEqual([])
  })
})
