import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateParserFunction, generateShapeValidator } from './generate-parser-function'

/**
 * Compiles generated parser source to JavaScript and returns the named export,
 * so tests can run real inputs through the emitted code instead of only
 * asserting on its text. The `isObject` runtime helper the generated code
 * imports is injected directly.
 */
const evalGenerated = <T>(code: string, exportName: string): T => {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleExports: Record<string, unknown> = {}
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  new Function('exports', 'isObject', js)(moduleExports, isObject)
  return moduleExports[exportName] as T
}

describe('generate-parser-function', () => {
  it('generates parser function for simple object schema', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    }

    const result = generateParserFunction(schema, 'User')
    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {
        name: "",
      };
  const _name = input.name;
  const _age = input.age;
  if (typeof _name === "string" && (_age === undefined || typeof _age === "number")) return { ...input } as User;
  return {
    ...input,
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_age !== undefined && { age: typeof _age === "number" ? _age : (Number.isFinite(Number(_age)) ? Number(_age) : 0) }),
  } as unknown as User;
}`,
    )
  })

  it('generates parser function with correct type name', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
      },
    }

    const result = generateParserFunction(schema, 'Product')
    expect(result).toBe(
      `export const parseProduct = (input: unknown): Product => {
  if (!isObject(input)) return {} as Product;
  const _id = input.id;
  if ((_id === undefined || typeof _id === "number")) return { ...input } as Product;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : (Number.isFinite(Number(_id)) ? Number(_id) : 0) }),
  } as unknown as Product;
}`,
    )
  })

  it('handles object schema without properties', () => {
    const schema: JSONSchema = {
      type: 'object',
    }

    const result = generateParserFunction(schema, 'Empty')
    expect(result).toBe(
      'export const parseEmpty = (input: unknown): Empty => isObject(input) ? { ...input } as Empty : {} as Empty;',
    )
  })

  it('handles non-object schema with type validation', () => {
    const schema: JSONSchema = {
      type: 'string',
    }

    const result = generateParserFunction(schema, 'StringType')
    expect(result).toBe(
      'export const parseStringType = (input: unknown): StringType => typeof input === "string" ? input as StringType : "" as StringType;',
    )
  })

  it('handles schema with required fields', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['id', 'name'],
    }

    const result = generateParserFunction(schema, 'User')

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {
        id: 0,
        name: "",
      };
  const _id = input.id;
  const _name = input.name;
  const _email = input.email;
  if (typeof _id === "number" && typeof _name === "string" && (_email === undefined || typeof _email === "string")) return { ...input } as User;
  return {
    ...input,
    id: typeof _id === "number" ? _id : (_id !== undefined ? (Number.isFinite(Number(_id)) ? Number(_id) : 0) : 0),
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_email !== undefined && { email: typeof _email === "string" ? _email : String(_email) }),
  } as unknown as User;
}`,
    )
  })

  it('handles schema with optional fields', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        description: { type: 'string' },
      },
      required: ['id'],
    }

    const result = generateParserFunction(schema, 'Item')

    expect(result).toBe(
      `export const parseItem = (input: unknown): Item => {
  if (!isObject(input)) return {
        id: 0,
      };
  const _id = input.id;
  const _description = input.description;
  if (typeof _id === "number" && (_description === undefined || typeof _description === "string")) return { ...input } as Item;
  return {
    ...input,
    id: typeof _id === "number" ? _id : (_id !== undefined ? (Number.isFinite(Number(_id)) ? Number(_id) : 0) : 0),
    ...(_description !== undefined && { description: typeof _description === "string" ? _description : String(_description) }),
  } as unknown as Item;
}`,
    )
  })

  it('handles non-schema object properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        validProp: { type: 'string' },
        invalidProp: true,
      },
    }

    const result = generateParserFunction(schema, 'Mixed')

    expect(result).toBe(
      `export const parseMixed = (input: unknown): Mixed => {
  if (!isObject(input)) return {} as Mixed;
  const _validProp = input.validProp;
  return {
    ...input,
    ...(_validProp !== undefined && { validProp: typeof _validProp === "string" ? _validProp : String(_validProp) }),
  } as unknown as Mixed;
}`,
    )
  })

  it('generates parser without useRefImports by default', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/Contact' },
      },
    }

    const result = generateParserFunction(schema, 'User')

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {} as User;
  const _contact = input.contact;
  return {
    ...input,
    ...(_contact !== undefined && { contact: _contact ?? undefined }),
  } as unknown as User;
}`,
    )
  })

  it('generates ref parser call when useRefImports is true for required field', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/Contact' },
      },
      required: ['contact'],
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {
        contact: parseContact(undefined),
      };
  const _contact = input.contact;
  if (validateContactShape(_contact)) return { ...input } as User;
  return {
    ...input,
    contact: parseContact(_contact),
  } as unknown as User;
}`,
    )
  })

  it('generates ref parser call when useRefImports is true for optional field', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/Contact' },
      },
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {} as User;
  const _contact = input.contact;
  if ((_contact === undefined || validateContactShape(_contact))) return { ...input } as User;
  return {
    ...input,
    ...(_contact !== undefined && { contact: parseContact(_contact) }),
  } as unknown as User;
}`,
    )
  })

  it('generates array ref parser call for required array with ref items', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contacts: {
          type: 'array',
          items: { $ref: '#/$defs/Contact' },
        },
      },
      required: ['contacts'],
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {
        contacts: [],
      };
  const _contacts = input.contacts;
  if (Array.isArray(_contacts) && _contacts.every(validateContactShape)) return { ...input } as User;
  return {
    ...input,
    contacts: validateArray(_contacts, parseContact),
  } as unknown as User;
}`,
    )
  })

  it('generates array ref parser call for optional array with ref items', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contacts: {
          type: 'array',
          items: { $ref: '#/$defs/Contact' },
        },
      },
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {} as User;
  const _contacts = input.contacts;
  if ((_contacts === undefined || Array.isArray(_contacts) && _contacts.every(validateContactShape))) return { ...input } as User;
  return {
    ...input,
    ...(_contacts !== undefined && { contacts: validateArray(_contacts, parseContact) }),
  } as unknown as User;
}`,
    )
  })

  it('does not generate array ref parser when useRefImports is false', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contacts: {
          type: 'array',
          items: { $ref: '#/$defs/Contact' },
        },
      },
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: false })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {} as User;
  const _contacts = input.contacts;
  if ((_contacts === undefined || Array.isArray(_contacts))) return { ...input } as User;
  return {
    ...input,
    ...(_contacts !== undefined && { contacts: Array.isArray(_contacts) ? _contacts : [] }),
  } as unknown as User;
}`,
    )
  })

  it('handles object with additionalProperties as object', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        type: 'string',
      },
    }

    const result = generateParserFunction(schema, 'StringMap')

    expect(result).toBe(
      'export const parseStringMap = (input: unknown): StringMap => validateRecord(input, (value: unknown) => typeof value === "string" ? value : "") as StringMap;',
    )
  })

  it('handles object with additionalProperties as ref without useRefImports', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        $ref: '#/$defs/Contact',
      },
    }

    const result = generateParserFunction(schema, 'ContactMap', { useRefImports: false })

    expect(result).toBe(
      `export const parseContactMap = (input: unknown): ContactMap => isObject(input) ? { ...input } as ContactMap : {};`,
    )
  })

  it('handles object with additionalProperties as ref with useRefImports', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        $ref: '#/$defs/Contact',
      },
    }

    const result = generateParserFunction(schema, 'ContactMap', { useRefImports: true })

    expect(result).toBe(
      `export const parseContactMap = (input: unknown): ContactMap => validateRecord(input, parseContact) as ContactMap;`,
    )
  })

  it('handles object with additionalProperties false', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: false,
    }

    const result = generateParserFunction(schema, 'Strict')

    expect(result).toBe(
      'export const parseStrict = (input: unknown): Strict => isObject(input) ? { ...input } as Strict : {} as Strict;',
    )
  })

  it('handles complex object with multiple property types', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' },
        isActive: { type: 'boolean' },
      },
      required: ['id', 'name'],
    }

    const result = generateParserFunction(schema, 'Complex')

    expect(result).toBe(
      `export const parseComplex = (input: unknown): Complex => {
  if (!isObject(input)) return {
        id: 0,
        name: "",
      };
  const _id = input.id;
  const _name = input.name;
  const _tags = input.tags;
  const _metadata = input.metadata;
  const _isActive = input.isActive;
  if (typeof _id === "number" && typeof _name === "string" && (_tags === undefined || Array.isArray(_tags)) && (_metadata === undefined || isObject(_metadata)) && (_isActive === undefined || typeof _isActive === "boolean")) return { ...input } as Complex;
  return {
    ...input,
    id: typeof _id === "number" ? _id : (_id !== undefined ? (Number.isFinite(Number(_id)) ? Number(_id) : 0) : 0),
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_tags !== undefined && { tags: Array.isArray(_tags) ? _tags : [] }),
    ...(_metadata !== undefined && { metadata: isObject(_metadata) ? _metadata : typeof _metadata === "object" && _metadata !== null ? _metadata : {} }),
    ...(_isActive !== undefined && { isActive: typeof _isActive === "boolean" ? _isActive : Boolean(_isActive) }),
  } as unknown as Complex;
}`,
    )
  })

  it('handles schema with kebab-case ref names', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        externalDoc: { $ref: '#/$defs/external-documentation' },
      },
    }

    const result = generateParserFunction(schema, 'ApiSpec', { useRefImports: true })

    expect(result).toBe(
      `export const parseApiSpec = (input: unknown): ApiSpec => {
  if (!isObject(input)) return {} as ApiSpec;
  const _externalDoc = input.externalDoc;
  if ((_externalDoc === undefined || validateExternalDocumentationShape(_externalDoc))) return { ...input } as ApiSpec;
  return {
    ...input,
    ...(_externalDoc !== undefined && { externalDoc: parseExternalDocumentation(_externalDoc) }),
  } as unknown as ApiSpec;
}`,
    )
  })

  it('handles schema with multiple refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/Contact' },
        address: { $ref: '#/$defs/Address' },
        company: { $ref: '#/$defs/Company' },
      },
      required: ['contact'],
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {
        contact: parseContact(undefined),
      };
  const _contact = input.contact;
  const _address = input.address;
  const _company = input.company;
  if (validateContactShape(_contact) && (_address === undefined || validateAddressShape(_address)) && (_company === undefined || validateCompanyShape(_company))) return { ...input } as User;
  return {
    ...input,
    contact: parseContact(_contact),
    ...(_address !== undefined && { address: parseAddress(_address) }),
    ...(_company !== undefined && { company: parseCompany(_company) }),
  } as unknown as User;
}`,
    )
  })

  it('handles mixed ref and non-ref properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        contact: { $ref: '#/$defs/Contact' },
        name: { type: 'string' },
      },
      required: ['id', 'name'],
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {
        id: 0,
        name: "",
      };
  const _id = input.id;
  const _contact = input.contact;
  const _name = input.name;
  if (typeof _id === "number" && (_contact === undefined || validateContactShape(_contact)) && typeof _name === "string") return { ...input } as User;
  return {
    ...input,
    id: typeof _id === "number" ? _id : (_id !== undefined ? (Number.isFinite(Number(_id)) ? Number(_id) : 0) : 0),
    ...(_contact !== undefined && { contact: parseContact(_contact) }),
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
  } as unknown as User;
}`,
    )
  })

  it('handles array without ref items when useRefImports is true', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    }

    const result = generateParserFunction(schema, 'Tagged', { useRefImports: true })

    expect(result).toBe(
      `export const parseTagged = (input: unknown): Tagged => {
  if (!isObject(input)) return {} as Tagged;
  const _tags = input.tags;
  if ((_tags === undefined || Array.isArray(_tags))) return { ...input } as Tagged;
  return {
    ...input,
    ...(_tags !== undefined && { tags: Array.isArray(_tags) ? _tags : [] }),
  } as unknown as Tagged;
}`,
    )
  })

  it('handles array without items property', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
        },
      },
    }

    const result = generateParserFunction(schema, 'ItemsContainer', { useRefImports: true })

    expect(result).toBe(
      `export const parseItemsContainer = (input: unknown): ItemsContainer => {
  if (!isObject(input)) return {} as ItemsContainer;
  const _items = input.items;
  if ((_items === undefined || Array.isArray(_items))) return { ...input } as ItemsContainer;
  return {
    ...input,
    ...(_items !== undefined && { items: Array.isArray(_items) ? _items : [] }),
  } as unknown as ItemsContainer;
}`,
    )
  })

  it('handles non-array type with ref when useRefImports is true', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/Contact' },
        age: { type: 'number' },
      },
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {} as User;
  const _contact = input.contact;
  const _age = input.age;
  if ((_contact === undefined || validateContactShape(_contact)) && (_age === undefined || typeof _age === "number")) return { ...input } as User;
  return {
    ...input,
    ...(_contact !== undefined && { contact: parseContact(_contact) }),
    ...(_age !== undefined && { age: typeof _age === "number" ? _age : (Number.isFinite(Number(_age)) ? Number(_age) : 0) }),
  } as unknown as User;
}`,
    )
  })

  it('handles empty properties object', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {},
    }

    const result = generateParserFunction(schema, 'Empty')

    expect(result).toBe(
      `export const parseEmpty = (input: unknown): Empty => {
  if (!isObject(input)) return {} as Empty;
  return {
    ...input,
  } as unknown as Empty;
}`,
    )
  })

  it('handles schema with only non-schema object properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        prop1: true,
        prop2: false,
        prop3: true,
      },
    }

    const result = generateParserFunction(schema, 'AllInvalid')

    expect(result).toBe(
      `export const parseAllInvalid = (input: unknown): AllInvalid => {
  if (!isObject(input)) return {} as AllInvalid;
  return {
    ...input,
  } as unknown as AllInvalid;
}`,
    )
  })

  it('generates correct parser name for PascalCase type names', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
      },
    }

    const result = generateParserFunction(schema, 'MyCustomType')

    expect(result).toBe(
      `export const parseMyCustomType = (input: unknown): MyCustomType => {
  if (!isObject(input)) return {} as MyCustomType;
  const _id = input.id;
  if ((_id === undefined || typeof _id === "number")) return { ...input } as MyCustomType;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : (Number.isFinite(Number(_id)) ? Number(_id) : 0) }),
  } as unknown as MyCustomType;
}`,
    )
  })

  it('generates correct parser name for camelCase type names', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
      },
    }

    const result = generateParserFunction(schema, 'myCustomType')

    expect(result).toBe(
      `export const parsemyCustomType = (input: unknown): myCustomType => {
  if (!isObject(input)) return {} as myCustomType;
  const _id = input.id;
  if ((_id === undefined || typeof _id === "number")) return { ...input } as myCustomType;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : (Number.isFinite(Number(_id)) ? Number(_id) : 0) }),
  } as unknown as myCustomType;
}`,
    )
  })

  it('handles object schema with properties property but no type', () => {
    const schema: JSONSchema = {
      properties: {
        name: { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'Implicit')

    expect(result).toBe(
      `export const parseImplicit = (input: unknown): Implicit => {
  if (!isObject(input)) return {} as Implicit;
  const _name = input.name;
  if ((_name === undefined || typeof _name === "string")) return { ...input } as Implicit;
  return {
    ...input,
    ...(_name !== undefined && { name: typeof _name === "string" ? _name : String(_name) }),
  } as unknown as Implicit;
}`,
    )
  })

  it('handles additionalProperties as true', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: true,
    }

    const result = generateParserFunction(schema, 'AnyAdditional')

    expect(result).toBe(
      'export const parseAnyAdditional = (input: unknown): AnyAdditional => isObject(input) ? { ...input } as AnyAdditional : {} as AnyAdditional;',
    )
  })

  it('handles additionalProperties with string type by validating values', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        type: 'string',
      },
    }

    const result = generateParserFunction(schema, 'MapOfStrings', { useRefImports: true })

    expect(result).toBe(
      'export const parseMapOfStrings = (input: unknown): MapOfStrings => validateRecord(input, (value: unknown) => typeof value === "string" ? value : "") as MapOfStrings;',
    )
  })

  it('handles additionalProperties with array type by validating values', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
    }

    const result = generateParserFunction(schema, 'SecurityRequirement', { useRefImports: true })

    expect(result).toBe(
      'export const parseSecurityRequirement = (input: unknown): SecurityRequirement => validateRecord(input, (value: unknown) => Array.isArray(value) ? value : []) as SecurityRequirement;',
    )
  })

  it('handles array with items as boolean schema', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: true,
        },
      },
    }

    const result = generateParserFunction(schema, 'Container', { useRefImports: true })

    expect(result).toBe(
      `export const parseContainer = (input: unknown): Container => {
  if (!isObject(input)) return {} as Container;
  const _data = input.data;
  if ((_data === undefined || Array.isArray(_data))) return { ...input } as Container;
  return {
    ...input,
    ...(_data !== undefined && { data: Array.isArray(_data) ? _data : [] }),
  } as unknown as Container;
}`,
    )
  })

  it('handles ref with complex path', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        nested: { $ref: '#/$defs/deeply/nested/Type' },
      },
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {} as User;
  const _nested = input.nested;
  if ((_nested === undefined || validateTypeShape(_nested))) return { ...input } as User;
  return {
    ...input,
    ...(_nested !== undefined && { nested: parseType(_nested) }),
  } as unknown as User;
}`,
    )
  })

  it('handles multiple array properties with refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contacts: {
          type: 'array',
          items: { $ref: '#/$defs/Contact' },
        },
        addresses: {
          type: 'array',
          items: { $ref: '#/$defs/Address' },
        },
      },
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {} as User;
  const _contacts = input.contacts;
  const _addresses = input.addresses;
  if ((_contacts === undefined || Array.isArray(_contacts) && _contacts.every(validateContactShape)) && (_addresses === undefined || Array.isArray(_addresses) && _addresses.every(validateAddressShape))) return { ...input } as User;
  return {
    ...input,
    ...(_contacts !== undefined && { contacts: validateArray(_contacts, parseContact) }),
    ...(_addresses !== undefined && { addresses: validateArray(_addresses, parseAddress) }),
  } as unknown as User;
}`,
    )
  })

  it('handles empty required array', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
      },
      required: [],
    }

    const result = generateParserFunction(schema, 'User')

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {} as User;
  const _id = input.id;
  const _name = input.name;
  if ((_id === undefined || typeof _id === "number") && (_name === undefined || typeof _name === "string")) return { ...input } as User;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : (Number.isFinite(Number(_id)) ? Number(_id) : 0) }),
    ...(_name !== undefined && { name: typeof _name === "string" ? _name : String(_name) }),
  } as unknown as User;
}`,
    )
  })

  it('handles schema with undefined required property', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
      },
    }

    const result = generateParserFunction(schema, 'User')

    expect(result).toBe(
      `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {} as User;
  const _id = input.id;
  if ((_id === undefined || typeof _id === "number")) return { ...input } as User;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : (Number.isFinite(Number(_id)) ? Number(_id) : 0) }),
  } as unknown as User;
}`,
    )
  })

  it('generates parser for additionalProperties with ref and validates input type', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        $ref: '#/$defs/Value',
      },
    }

    const result = generateParserFunction(schema, 'Map', { useRefImports: true })

    expect(result).toBe(`export const parseMap = (input: unknown): Map => validateRecord(input, parseValue) as Map;`)
  })

  it('generates a simple object pass-through parser for allOf-only schema', () => {
    // A schema with only allOf refs and type: object but no properties generates
    // a simple spread parser since there is nothing to specifically parse.
    const schema: JSONSchema = {
      type: 'object',
      allOf: [{ $ref: '#/$defs/type-apikey' }, { $ref: '#/$defs/type-http-bearer' }, { $ref: '#/$defs/type-oauth2' }],
    }

    const result = generateParserFunction(schema, 'SecurityScheme', { useRefImports: true })

    expect(result).toBe(
      `export const parseSecurityScheme = (input: unknown): SecurityScheme => isObject(input) ? { ...input } as SecurityScheme : {} as SecurityScheme;`,
    )
  })

  it('generates a parser for the components object', () => {
    const components: JSONSchema.Object = {
      type: 'object',
      properties: {
        responses: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/response' },
        },
        parameters: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/parameter' },
        },
        headers: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/header' },
        },
        pathItems: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/path-item' },
        },
      },
    }

    const result = generateParserFunction(components, 'Components', { useRefImports: true })
    expect(result).toBe(
      `export const parseComponents = (input: unknown): Components => {
  if (!isObject(input)) return {} as Components;
  const _responses = input.responses;
  const _parameters = input.parameters;
  const _headers = input.headers;
  const _pathItems = input.pathItems;
  return {
    ...input,
    ...(_responses !== undefined && { responses: validateRecord(_responses, parseResponse) }),
    ...(_parameters !== undefined && { parameters: validateRecord(_parameters, parseParameter) }),
    ...(_headers !== undefined && { headers: validateRecord(_headers, parseHeader) }),
    ...(_pathItems !== undefined && { pathItems: validateRecord(_pathItems, parsePathItem) }),
  } as unknown as Components;
}`,
    )
  })

  it('handles ref schema with conditional if/then/else logic', () => {
    const schema: JSONSchema = {
      if: { type: 'object', required: ['$ref'] },
      then: { $ref: '#/$defs/reference' },
      else: { $ref: '#/$defs/callbacks' },
    }

    const result = generateParserFunction(schema, 'Conditional')
    expect(result).toBe(
      `export const parseConditional = (input: unknown): Conditional | Reference =>
  hasRef(input) ? parseReference(input) : parseCallbacks(input)
      `,
    )
  })

  it('handles OpenAPI paths schema with patternProperties', () => {
    // This is the actual schema from OpenAPI 3.1.2 for the paths object
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: {
        '^/': { $ref: '#/$defs/path-item' },
      },
      $ref: '#/$defs/specification-extensions',
      unevaluatedProperties: false,
    }

    const result = generateParserFunction(schema, 'Paths', { useRefImports: true })

    expect(result).toBe(
      `export const parsePaths = (input: unknown): Paths => {
  if (!isObject(input)) {
    return {} as unknown as Paths;
  }
  const result = {
    ...input,
  } as unknown as Paths;
  for (const key in input) {
    if (/^\\//.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = parsePathItem(value);
    }
  }
  return result;
};`,
    )
  })

  it('generates a simple object pass-through parser for allOf-only schema with multiple subtypes', () => {
    // With the OpenAPI SecurityScheme dispatcher logic removed, a schema that only has
    // allOf refs and no fixed properties generates a simple spread parser.
    const schema: JSONSchema = {
      type: 'object',
      allOf: [
        { $ref: '#/$defs/type-apikey' },
        { $ref: '#/$defs/type-http' },
        { $ref: '#/$defs/type-http-bearer' },
        { $ref: '#/$defs/type-oauth2' },
        { $ref: '#/$defs/type-oidc' },
      ],
    }

    const result = generateParserFunction(schema, 'SecurityScheme', { useRefImports: true })

    expect(result).toBe(
      `export const parseSecurityScheme = (input: unknown): SecurityScheme => isObject(input) ? { ...input } as SecurityScheme : {} as SecurityScheme;`,
    )
  })

  it('documents the difference: webhooks uses additionalProperties and works correctly', () => {
    // This is how webhooks is defined in OpenAPI - uses additionalProperties instead of patternProperties
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: { $ref: '#/$defs/path-item' },
    }

    const result = generateParserFunction(schema, 'Webhooks', { useRefImports: true })

    // This works correctly because additionalProperties is handled
    expect(result).toBe(
      `export const parseWebhooks = (input: unknown): Webhooks => validateRecord(input, parsePathItem) as Webhooks;`,
    )
    expect(result).not.toContain('input as Webhooks')
  })

  it('handles simple patternProperties with $ref', () => {
    // A simpler case with just patternProperties
    const schema: JSONSchema = {
      type: 'object',
      patternProperties: {
        '^/': { $ref: '#/$defs/path-item' },
      },
    }

    const result = generateParserFunction(schema, 'SimplePaths', { useRefImports: true })

    expect(result).toBe(
      `export const parseSimplePaths = (input: unknown): SimplePaths => {
  if (!isObject(input)) {
    return {} as unknown as SimplePaths;
  }
  const result = {
    ...input,
  } as unknown as SimplePaths;
  for (const key in input) {
    if (/^\\//.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = parsePathItem(value);
    }
  }
  return result;
};`,
    )
  })

  it('generates consistent code for optional direct $ref properties in Document-like schemas', () => {
    // This simulates the OpenAPI Document schema structure
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        openapi: { type: 'string' },
        info: { $ref: '#/$defs/info' },
        servers: {
          type: 'array',
          items: { $ref: '#/$defs/server' },
        },
        paths: { $ref: '#/$defs/paths' },
        webhooks: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/path-item' },
        },
        components: { $ref: '#/$defs/components' },
        externalDocs: { $ref: '#/$defs/external-documentation' },
      },
      required: ['openapi', 'info'],
    }

    const result = generateParserFunction(schema, 'Document', { useRefImports: true })
    expect(result).toBe(`export const parseDocument = (input: unknown): Document => {
  if (!isObject(input)) return {
        openapi: "",
        info: parseInfo(undefined),
      };
  const _openapi = input.openapi;
  const _info = input.info;
  const _servers = input.servers;
  const _paths = input.paths;
  const _webhooks = input.webhooks;
  const _components = input.components;
  const _externalDocs = input.externalDocs;
  return {
    ...input,
    openapi: typeof _openapi === "string" ? _openapi : (_openapi !== undefined ? String(_openapi) : ""),
    info: parseInfo(_info),
    ...(_servers !== undefined && { servers: validateArray(_servers, parseServer) }),
    ...(_paths !== undefined && { paths: parsePaths(_paths) }),
    ...(_webhooks !== undefined && { webhooks: validateRecord(_webhooks, parsePathItem) }),
    ...(_components !== undefined && { components: parseComponents(_components) }),
    ...(_externalDocs !== undefined && { externalDocs: parseExternalDocumentation(_externalDocs) }),
  } as unknown as Document;
}`)
  })

  it('generates parser for components-like schema with $dynamicRef and record properties', () => {
    // Tests that $dynamicRef in additionalProperties generates the schema pass-through,
    // while plain $ref properties generate proper validateRecord calls.
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        schemas: {
          type: 'object',
          additionalProperties: { $dynamicRef: '#meta' },
        },
        responses: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/response' },
        },
        parameters: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/parameter' },
        },
        pathItems: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/path-item' },
        },
      },
    }

    const result = generateParserFunction(schema, 'Components', { useRefImports: true })
    expect(result).toBe(
      `export const parseComponents = (input: unknown): Components => {
  if (!isObject(input)) return {} as Components;
  const _schemas = input.schemas;
  const _responses = input.responses;
  const _parameters = input.parameters;
  const _pathItems = input.pathItems;
  return {
    ...input,
    ...(_schemas !== undefined && { schemas: isObject(_schemas) ? _schemas : typeof _schemas === "object" && _schemas !== null ? _schemas : {} }),
    ...(_responses !== undefined && { responses: validateRecord(_responses, parseResponse) }),
    ...(_parameters !== undefined && { parameters: validateRecord(_parameters, parseParameter) }),
    ...(_pathItems !== undefined && { pathItems: validateRecord(_pathItems, parsePathItem) }),
  } as unknown as Components;
}`,
    )
  })

  it('generates combined parser for schema with both properties and patternProperties', () => {
    // A schema with a known property and patternProperties for dynamic keys
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        default: { $ref: '#/$defs/response' },
      },
      patternProperties: {
        '^[1-5](?:[0-9]{2}|XX)$': { $ref: '#/$defs/response' },
      },
    }

    const result = generateParserFunction(schema, 'Responses', { useRefImports: true })

    expect(result).toBe(
      `export const parseResponses = (input: unknown): Responses => {
  if (!isObject(input)) {
    return {} as unknown as Responses;
  }
  const result = {
    ...input,
    ...(input.default && { default: parseResponse(input.default) }),
  } as unknown as Responses;
  for (const key in input) {
    if (/^[1-5](?:[0-9]{2}|XX)$/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = parseResponse(value);
    }
  }
  return result;
};`,
    )
  })

  it('falls back to object parser when patternProperties has no $ref and useRefImports is false', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        default: { $ref: '#/$defs/response' },
      },
      patternProperties: {
        '^[1-5]': { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'Responses', { useRefImports: false })

    // Without useRefImports, falls back to regular object parser
    expect(result).toContain('isObject(input)')
    expect(result).toContain('default:')
    expect(result).not.toContain('for (const [key, value]')
  })

  it('generates parser for schema object with $dynamicRef in additionalProperties', () => {
    // This tests the JSON Schema 2020-12 $dynamicRef feature used in OpenAPI 3.1.2
    // for the schemas property which can contain any valid JSON Schema
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        $dynamicRef: '#meta',
      },
    }

    const result = generateParserFunction(schema, 'Schema', { useRefImports: true })

    // Schema is a special case that handles both boolean and object types
    expect(result).toContain("if (typeof input === 'boolean')")
    expect(result).toContain('return input as Schema')
    expect(result).toContain('if (!isObject(input))')
    expect(result).toContain('return {} as Schema')
  })

  it('uses bracket notation for hyphenated property keys with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        'x-linkedin': { $ref: '#/$defs/extension' },
      },
    }

    const result = generateParserFunction(schema, 'InfoExtensions', { useRefImports: true })

    expect(result).toContain("input['x-linkedin']")
    expect(result).toContain("'x-linkedin':")
    expect(result).not.toContain('input.x-linkedin')
  })

  it('uses bracket notation for hyphenated property keys with validation', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        'x-custom': { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'Test')

    expect(result).toContain("input['x-custom']")
    expect(result).toContain("'x-custom':")
    expect(result).not.toContain('input.x-custom')
  })

  it('generates object parser from conditional if/then fragments', () => {
    const schema: JSONSchema = {
      if: {
        properties: {
          type: {
            const: 'http',
          },
        },
      },
      then: {
        properties: {
          scheme: {
            type: 'string',
          },
        },
        required: ['scheme'],
      },
    }

    const result = generateParserFunction(schema, 'TypeHttp', { useRefImports: true })

    expect(result).toContain('isObject(input)')
    expect(result).toContain('type:')
    expect(result).toContain('scheme:')
    expect(result).not.toContain('input as TypeHttp')
  })

  it('generates parser for patternProperties-only schema without explicit type', () => {
    const schema: JSONSchema = {
      patternProperties: {
        '^x-': true,
      },
    }

    const result = generateParserFunction(schema, 'SpecificationExtensions', { useRefImports: true })

    expect(result).toContain('for (const key in input)')
    expect(result).toContain('...input,')
    expect(result).not.toContain('input as SpecificationExtensions')
  })

  it('optimization: inlines variables for simple properties without fast-path', () => {
    // When there's no fast-path, simple properties should be inlined
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        description: { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'Example')

    // Should NOT cache variables when no fast-path is possible
    // (in this case, fast-path exists, so variables ARE cached)
    expect(result).toContain('const _summary')
    expect(result).toContain('const _description')
  })

  it('optimization: caches variables when fast-path exists', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    }

    const result = generateParserFunction(schema, 'User')

    // Should cache variables because fast-path exists
    expect(result).toContain('const _name = input.name')
    expect(result).toContain('const _age = input.age')
    // Should have fast-path check
    expect(result).toContain('if (typeof _name === "string"')
    expect(result).toContain('return { ...input } as User')
  })

  it('optimization: removes redundant undefined checks in optional properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        description: { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'Example')

    // The generated code should have the outer undefined check
    expect(result).toContain('!== undefined &&')
    // But should NOT have redundant nested undefined checks in the coercion
    // Count occurrences - should only appear in the outer check, not in String() coercion
    const matches = result.match(/!== undefined/g) || []
    // Should have exactly 2 occurrences (one for each optional property's outer check)
    expect(matches.length).toBe(2)
  })

  it('optimization: inlines properties with $ref when they cannot use fast-path', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/Contact' },
      },
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    // Should still cache because $ref properties always need caching
    expect(result).toContain('const _contact = input.contact')
  })

  it('optimization: caches variables for complex schemas with multiple constraints', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          pattern: '^[A-Z]',
          minLength: 3,
          maxLength: 10,
        },
      },
    }

    const result = generateParserFunction(schema, 'Code')

    // Should cache because property has multiple constraints
    expect(result).toContain('const _code = input.code')
  })

  it('optimization: fast-path returns input directly when all properties valid', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['id'],
    }

    const result = generateParserFunction(schema, 'Item')

    // Should have fast-path that returns a new shallow copy
    expect(result).toContain('return { ...input } as Item')
    // Fast-path check should exist
    expect(result).toContain('if (typeof _id')
    // Should have both fast and slow paths
    expect(result).toContain('return {')
  })

  it('optimization: ref properties participate in deep fast-path via shape predicate', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/Contact' },
        name: { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'User', { useRefImports: true })

    // Fast-path now handles refs by calling the imported shape predicate.
    expect(result).toContain('validateContactShape(_contact)')
    expect(result).toContain('return { ...input } as User')
    // Slow path still exists for invalid input.
    expect(result).toContain('return {')
  })

  it('optimization: generates efficient code for all optional properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'Optional')

    // Should have fast-path for all optional
    expect(result).toContain('return { ...input } as Optional')
    // Should use spread operators for optional properties
    const spreadCount = (result.match(/\.\.\./g) || []).length
    expect(spreadCount).toBeGreaterThan(0)
  })

  it('optimization: handles mixed required and optional with fast-path', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['id', 'name'],
    }

    const result = generateParserFunction(schema, 'User')

    // Should cache all variables for fast-path
    expect(result).toContain('const _id')
    expect(result).toContain('const _name')
    expect(result).toContain('const _email')
    // Should have fast-path check
    expect(result).toContain('return { ...input } as User')
    // Fast-path should check required fields and optional fields
    expect(result).toContain('typeof _id === "number"')
    expect(result).toContain('typeof _name === "string"')
    expect(result).toContain('_email === undefined || typeof _email === "string"')
  })

  it('optimization: selective caching based on property complexity', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        // Simple property - could be inlined if no fast-path
        simple: { type: 'string' },
        // Complex property - should be cached
        complex: {
          type: 'string',
          pattern: '^[A-Z]',
          minLength: 5,
          maxLength: 100,
        },
      },
    }

    const result = generateParserFunction(schema, 'Mixed')

    // Both should be cached because fast-path exists
    expect(result).toContain('const _simple')
    expect(result).toContain('const _complex')
  })

  it('generates parser for product schema with required fields, minimum constraint, boolean, and array', () => {
    const schema: JSONSchema = {
      description: 'A product available for purchase in the catalog.',
      type: 'object',
      properties: {
        id: { description: 'Unique product identifier (UUID).', type: 'string' },
        name: { description: 'Display name shown to customers.', type: 'string' },
        price: { description: 'Unit price in USD cents (must be non-negative).', type: 'number', minimum: 0 },
        inStock: { description: 'Whether the product is currently available for purchase.', type: 'boolean' },
        tags: {
          description: 'Searchable labels associated with the product.',
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['id', 'name', 'price'],
    }

    const result = generateParserFunction(schema, 'Product')

    expect(result).toBe(
      `export const parseProduct = (input: unknown): Product => {
  if (!isObject(input)) return {
        id: "",
        name: "",
        price: 0,
      };
  const _id = input.id;
  const _name = input.name;
  const _price = input.price;
  const _inStock = input.inStock;
  const _tags = input.tags;
  if (typeof _id === "string" && typeof _name === "string" && typeof _price === "number" && _price >= 0 && (_inStock === undefined || typeof _inStock === "boolean") && (_tags === undefined || Array.isArray(_tags))) return { ...input } as Product;
  return {
    ...input,
    id: typeof _id === "string" ? _id : (_id !== undefined ? String(_id) : ""),
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    price: typeof _price === "number" && _price >= 0 ? _price : (_price !== undefined ? (Number.isFinite(Number(_price)) ? Number(_price) : 0) : 0),
    ...(_inStock !== undefined && { inStock: typeof _inStock === "boolean" ? _inStock : Boolean(_inStock) }),
    ...(_tags !== undefined && { tags: Array.isArray(_tags) ? _tags : [] }),
  } as unknown as Product;
}`,
    )
  })

  it('generates parser for pagination params with integer minimum/maximum constraints', () => {
    const schema: JSONSchema = {
      description: 'Query parameters for paginated list endpoints.',
      type: 'object',
      properties: {
        page: { description: 'The 1-based page number to retrieve.', type: 'integer', minimum: 1 },
        perPage: { description: 'Number of items per page.', type: 'integer', minimum: 1, maximum: 100 },
        search: { description: 'Optional full-text search query.', type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'PageParams')

    expect(result).toBe(
      `export const parsePageParams = (input: unknown): PageParams => {
  if (!isObject(input)) return {} as PageParams;
  const _page = input.page;
  const _perPage = input.perPage;
  const _search = input.search;
  if ((_page === undefined || typeof _page === "number" && _page >= 1) && (_perPage === undefined || typeof _perPage === "number" && _perPage >= 1 && _perPage <= 100) && (_search === undefined || typeof _search === "string")) return { ...input } as PageParams;
  return {
    ...input,
    ...(_page !== undefined && { page: typeof _page === "number" && _page >= 1 ? _page : (Number.isFinite(Number(_page)) ? Number(_page) : 0) }),
    ...(_perPage !== undefined && { perPage: typeof _perPage === "number" && _perPage >= 1 && _perPage <= 100 ? _perPage : (Number.isFinite(Number(_perPage)) ? Number(_perPage) : 0) }),
    ...(_search !== undefined && { search: typeof _search === "string" ? _search : String(_search) }),
  } as unknown as PageParams;
}`,
    )
  })

  it('generates parser for string enum schema', () => {
    const schema: JSONSchema = {
      description: 'One of the supported theme colors.',
      type: 'string',
      enum: ['red', 'green', 'blue', 'yellow', 'purple'],
    }

    const result = generateParserFunction(schema, 'ThemeColor')

    expect(result).toBe(
      'export const parseThemeColor = (input: unknown): ThemeColor => typeof input === "string" ? input as ThemeColor : "" as ThemeColor;',
    )
  })

  it('generates parser for geo coordinate with min/max on required and optional number fields', () => {
    const schema: JSONSchema = {
      description: 'A geographic coordinate pair.',
      type: 'object',
      properties: {
        latitude: { description: 'Degrees latitude, from -90 to 90.', type: 'number', minimum: -90, maximum: 90 },
        longitude: { description: 'Degrees longitude, from -180 to 180.', type: 'number', minimum: -180, maximum: 180 },
        altitude: { description: 'Elevation in metres above sea level.', type: 'number' },
        label: { description: 'Human-readable name for this location.', type: 'string' },
      },
      required: ['latitude', 'longitude'],
    }

    const result = generateParserFunction(schema, 'GeoCoordinate')

    expect(result).toBe(
      `export const parseGeoCoordinate = (input: unknown): GeoCoordinate => {
  if (!isObject(input)) return {
        latitude: 0,
        longitude: 0,
      };
  const _latitude = input.latitude;
  const _longitude = input.longitude;
  const _altitude = input.altitude;
  const _label = input.label;
  if (typeof _latitude === "number" && _latitude >= -90 && _latitude <= 90 && typeof _longitude === "number" && _longitude >= -180 && _longitude <= 180 && (_altitude === undefined || typeof _altitude === "number") && (_label === undefined || typeof _label === "string")) return { ...input } as GeoCoordinate;
  return {
    ...input,
    latitude: typeof _latitude === "number" && _latitude >= -90 && _latitude <= 90 ? _latitude : (_latitude !== undefined ? (Number.isFinite(Number(_latitude)) ? Number(_latitude) : 0) : 0),
    longitude: typeof _longitude === "number" && _longitude >= -180 && _longitude <= 180 ? _longitude : (_longitude !== undefined ? (Number.isFinite(Number(_longitude)) ? Number(_longitude) : 0) : 0),
    ...(_altitude !== undefined && { altitude: typeof _altitude === "number" ? _altitude : (Number.isFinite(Number(_altitude)) ? Number(_altitude) : 0) }),
    ...(_label !== undefined && { label: typeof _label === "string" ? _label : String(_label) }),
  } as unknown as GeoCoordinate;
}`,
    )
  })

  describe('logWarnings option', () => {
    it('emits a console.warn loop for unknown properties when logWarnings is true', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      }

      const result = generateParserFunction(schema, 'User', { logWarnings: true })
      expect(result).toBe(
        `export const parseUser = (input: unknown): User => {
  if (!isObject(input)) return {
        name: "",
      };
  const _name = input.name;
  const _age = input.age;
  for (const _k in input) {
    if (_k !== "name" && _k !== "age") {
      console.warn(\`[User] Unknown property "\${_k}"\`);
    }
  }
  if (typeof _name === "string" && (_age === undefined || typeof _age === "number")) return { ...input } as User;
  return {
    ...input,
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_age !== undefined && { age: typeof _age === "number" ? _age : (Number.isFinite(Number(_age)) ? Number(_age) : 0) }),
  } as unknown as User;
}`,
      )
    })

    it('does not emit a console.warn loop when logWarnings is false', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      }

      const result = generateParserFunction(schema, 'User', { logWarnings: false })
      expect(result).not.toContain('console.warn')
      expect(result).not.toContain('_knownKeys')
    })

    it('does not emit a console.warn loop when logWarnings is not set', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      }

      const result = generateParserFunction(schema, 'User')
      expect(result).not.toContain('console.warn')
    })
  })

  describe('strict option', () => {
    it('throws on non-object input for object schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }
      const result = generateParserFunction(schema, 'User', { strict: true })
      expect(result).toContain(
        'if (!isObject(input)) throw new Error(`[User] expected object, got ${input === null ? "null" : typeof input}`)',
      )
      expect(result).not.toContain('if (!isObject(input)) return')
    })

    it('throws on missing required property', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }
      const result = generateParserFunction(schema, 'User', { strict: true })
      expect(result).toContain('if (!("name" in input)) throw new Error(\'[User] missing required property "name"\')')
    })

    it('throws on wrong primitive type for required property', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }
      const result = generateParserFunction(schema, 'User', { strict: true })
      expect(result).toContain(
        'if (typeof input.name !== "string") throw new Error(`[User] field "name" expected string, got ${typeof input.name}`)',
      )
    })

    it('only throws on wrong type for optional property when provided', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { age: { type: 'number' } },
      }
      const result = generateParserFunction(schema, 'User', { strict: true })
      expect(result).toContain(
        'if (input.age !== undefined && (typeof input.age !== "number")) throw new Error(`[User] field "age" expected number, got ${typeof input.age}`)',
      )
    })

    it('throws on enum mismatch', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { role: { enum: ['admin', 'user'] } },
        required: ['role'],
      }
      const result = generateParserFunction(schema, 'User', { strict: true })
      expect(result).toContain('must be one of: "admin", "user"')
    })

    it('throws on pattern mismatch for strings', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { code: { type: 'string', pattern: '^[A-Z]+$' } },
        required: ['code'],
      }
      const result = generateParserFunction(schema, 'User', { strict: true })
      expect(result).toContain('must match pattern ^[A-Z]+$')
    })

    it('throws on minLength / maxLength violations', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string', minLength: 1, maxLength: 10 } },
        required: ['name'],
      }
      const result = generateParserFunction(schema, 'User', { strict: true })
      expect(result).toContain('must have at least 1 characters')
      expect(result).toContain('must have at most 10 characters')
    })

    it('throws on minimum / maximum / multipleOf violations', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { age: { type: 'number', minimum: 0, maximum: 120, multipleOf: 1 } },
        required: ['age'],
      }
      const result = generateParserFunction(schema, 'User', { strict: true })
      expect(result).toContain('must be >= 0')
      expect(result).toContain('must be <= 120')
      expect(result).toContain('must be a multiple of 1')
    })

    it('does not generate strict assertions for $ref properties (delegated to nested parser)', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { contact: { $ref: '#/$defs/contact' } },
        required: ['contact'],
      }
      const result = generateParserFunction(schema, 'User', { strict: true, useRefImports: true })
      // The missing-required check is still emitted, but no inline type check.
      expect(result).toContain('missing required property "contact"')
      expect(result).not.toContain('field "contact" expected')
    })

    it('throws on wrong type for non-object scalar schemas', () => {
      const schema: JSONSchema = { type: 'string' }
      const result = generateParserFunction(schema, 'Name', { strict: true })
      expect(result).toContain(
        'if (typeof input !== "string") throw new Error(`[Name] expected string, got ${input === null ? "null" : typeof input}`)',
      )
      expect(result).toContain('return input as Name;')
    })

    it('throws on non-object input for empty object schemas', () => {
      const schema: JSONSchema = { type: 'object' }
      const result = generateParserFunction(schema, 'Any', { strict: true })
      expect(result).toContain('if (!isObject(input)) throw new Error')
      expect(result).toContain('return { ...input } as Any;')
    })

    it('preserves existing safe behavior when strict is not set', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }
      const result = generateParserFunction(schema, 'User')
      expect(result).not.toContain('throw new Error')
      expect(result).toContain('if (!isObject(input)) return')
    })
  })

  describe('inline nested objects', () => {
    const nestedSchema: JSONSchema = {
      type: 'object',
      properties: {
        a: { type: 'number' },
        nested: {
          type: 'object',
          properties: { foo: { type: 'string' } },
          required: ['foo'],
        },
      },
      required: ['a', 'nested'],
    }

    it('emits a private sub-parser and shape predicate for an inline nested object', () => {
      const result = generateParserFunction(nestedSchema, 'Demo')

      expect(result).toContain('type DemoNested = Demo["nested"];')
      expect(result).toContain('const parseDemoNested = (input: unknown): DemoNested =>')
      expect(result).toContain('const validateDemoNestedShape = (input: unknown): boolean =>')
      // Private helpers stay private — only the root parser is exported.
      expect(result).not.toContain('export const parseDemoNested')
      expect(result).toContain('nested: parseDemoNested(_nested),')
    })

    it('coerces the fields of an inline nested object', () => {
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateParserFunction(nestedSchema, 'Demo'),
        'parseDemo',
      )

      expect(parse({ a: 1, nested: { foo: 'x' } })).toEqual({ a: 1, nested: { foo: 'x' } })
      // Previously the nested object passed through unchecked; now its fields
      // are coerced like any top-level property.
      expect(parse({ a: 1, nested: { foo: 42 } })).toEqual({ a: 1, nested: { foo: '42' } })
    })

    it('throws on invalid inline nested fields in strict mode', () => {
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateParserFunction(nestedSchema, 'Demo', { strict: true }),
        'parseDemo',
      )

      expect(() => parse({ a: 1, nested: { foo: 42 } })).toThrow('[DemoNested] field "foo" expected string, got number')
      expect(() => parse({ a: 1, nested: {} })).toThrow('[DemoNested] missing required property "foo"')
    })

    it('parses inline objects nested more than one level deep', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          outer: {
            type: 'object',
            properties: {
              inner: {
                type: 'object',
                properties: { leaf: { type: 'boolean' } },
                required: ['leaf'],
              },
            },
            required: ['inner'],
          },
        },
        required: ['outer'],
      }
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateParserFunction(schema, 'Tree', { strict: true }),
        'parseTree',
      )

      expect(parse({ outer: { inner: { leaf: true } } })).toEqual({ outer: { inner: { leaf: true } } })
      expect(() => parse({ outer: { inner: { leaf: 'no' } } })).toThrow(
        '[TreeOuterInner] field "leaf" expected boolean, got string',
      )
    })

    it('falls back to deep defaults for required inline nested objects', () => {
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateParserFunction(nestedSchema, 'Demo'),
        'parseDemo',
      )

      expect(parse(null)).toEqual({ a: 0, nested: { foo: '' } })
    })
  })

  describe('additionalProperties: false', () => {
    const strictKeysSchema: JSONSchema = {
      type: 'object',
      properties: {
        a: { type: 'number' },
        nested: {
          type: 'object',
          properties: { foo: { type: 'string' } },
          required: ['foo'],
          additionalProperties: false,
        },
      },
      required: ['a', 'nested'],
      additionalProperties: false,
    }

    it('strips undeclared keys at every level', () => {
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateParserFunction(strictKeysSchema, 'Demo'),
        'parseDemo',
      )

      expect(parse({ a: 1, nested: { foo: 'x', evil: 2 }, evil: true })).toEqual({ a: 1, nested: { foo: 'x' } })
    })

    it('keeps undeclared keys when additionalProperties is absent', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { a: { type: 'number' } },
        required: ['a'],
      }
      const parse = evalGenerated<(input: unknown) => unknown>(generateParserFunction(schema, 'Loose'), 'parseLoose')

      expect(parse({ a: 1, extra: 'fine' })).toEqual({ a: 1, extra: 'fine' })
    })

    it('throws on undeclared keys in strict mode', () => {
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateParserFunction(strictKeysSchema, 'Demo', { strict: true }),
        'parseDemo',
      )

      expect(parse({ a: 1, nested: { foo: 'x' } })).toEqual({ a: 1, nested: { foo: 'x' } })
      expect(() => parse({ a: 1, nested: { foo: 'x' }, evil: true })).toThrow('[Demo] unknown property "evil"')
      expect(() => parse({ a: 1, nested: { foo: 'x', evil: 2 } })).toThrow('[DemoNested] unknown property "evil"')
    })

    it('inlines !== comparisons for the strict-key sweep below the threshold', () => {
      const result = generateParserFunction(strictKeysSchema, 'Demo', { strict: true })

      expect(result).toContain('_k !== "a" && _k !== "nested"')
      expect(result).not.toContain('_knownKeysDemo = new Set')
    })

    it('falls back to a hoisted Set for the strict-key sweep above the threshold', () => {
      const properties = Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`k${i}`, { type: 'string' as const }]),
      )
      const wide: JSONSchema = { type: 'object', properties, additionalProperties: false }
      const result = generateParserFunction(wide, 'Wide', { strict: true })

      expect(result).toContain('_knownKeysWide = new Set(')
      expect(result).toContain('!_knownKeysWide.has(_k)')
    })

    it('rejects undeclared keys in the shape validator', () => {
      // The shape predicate gates the fast path, so it has to refuse inputs
      // the parser would strip — otherwise extras would survive `{ ...input }`.
      const combined = `${generateShapeValidator(strictKeysSchema, 'Demo', false)}\n\n${generateParserFunction(strictKeysSchema, 'Demo')}`
      const isShape = evalGenerated<(input: unknown) => boolean>(combined, 'validateDemoShape')

      expect(isShape({ a: 1, nested: { foo: 'x' } })).toBe(true)
      expect(isShape({ a: 1, nested: { foo: 'x' }, evil: true })).toBe(false)
      expect(isShape({ a: 1, nested: { foo: 'x', evil: 2 } })).toBe(false)
    })
  })
})
