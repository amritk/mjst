import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'bun:test'
import { generateParserFunction } from './generate-parser-function'

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

    const result = generateParserFunction(schema, 'UserObject')
    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {
        name: "",
      };
  const _name = input.name;
  const _age = input.age;
  if (typeof _name === "string" && (_age === undefined || typeof _age === "number")) return { ...input } as UserObject;
  return {
    ...input,
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_age !== undefined && { age: typeof _age === "number" ? _age : Number(_age) }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'ProductObject')
    expect(result).toBe(
      `export const parseProductObject = (input: unknown): ProductObject => {
  if (!isObject(input)) return {} as ProductObject;
  const _id = input.id;
  if ((_id === undefined || typeof _id === "number")) return { ...input } as ProductObject;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : Number(_id) }),
  } as unknown as ProductObject;
}`,
    )
  })

  it('handles object schema without properties', () => {
    const schema: JSONSchema = {
      type: 'object',
    }

    const result = generateParserFunction(schema, 'EmptyObject')
    expect(result).toBe('export const parseEmptyObject = (input: unknown): EmptyObject => isObject(input) ? input as EmptyObject : {} as EmptyObject;')
  })

  it('handles non-object schema with type validation', () => {
    const schema: JSONSchema = {
      type: 'string',
    }

    const result = generateParserFunction(schema, 'StringType')
    expect(result).toBe('export const parseStringType = (input: unknown): StringType => typeof input === "string" ? input as StringType : "" as StringType;')
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

    const result = generateParserFunction(schema, 'UserObject')

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {
        id: 0,
        name: "",
      };
  const _id = input.id;
  const _name = input.name;
  const _email = input.email;
  if (typeof _id === "number" && typeof _name === "string" && (_email === undefined || typeof _email === "string")) return { ...input } as UserObject;
  return {
    ...input,
    id: typeof _id === "number" ? _id : (_id !== undefined ? Number(_id) : 0),
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_email !== undefined && { email: typeof _email === "string" ? _email : String(_email) }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'ItemObject')

    expect(result).toBe(
      `export const parseItemObject = (input: unknown): ItemObject => {
  if (!isObject(input)) return {
        id: 0,
      };
  const _id = input.id;
  const _description = input.description;
  if (typeof _id === "number" && (_description === undefined || typeof _description === "string")) return { ...input } as ItemObject;
  return {
    ...input,
    id: typeof _id === "number" ? _id : (_id !== undefined ? Number(_id) : 0),
    ...(_description !== undefined && { description: typeof _description === "string" ? _description : String(_description) }),
  } as unknown as ItemObject;
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

    const result = generateParserFunction(schema, 'MixedObject')

    expect(result).toBe(
      `export const parseMixedObject = (input: unknown): MixedObject => {
  if (!isObject(input)) return {} as MixedObject;
  return {
    ...input,
    ...(input.validProp !== undefined && { validProp: typeof input?.validProp === "string" ? input?.validProp : String(input?.validProp) }),
  } as unknown as MixedObject;
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

    const result = generateParserFunction(schema, 'UserObject')

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {} as UserObject;
  return {
    ...input,
    ...(input.contact !== undefined && { contact: input?.contact ?? undefined }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {
        contact: parseContactObject(undefined),
      };
  const _contact = input.contact;
  return {
    ...input,
    contact: parseContactObject(_contact),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {} as UserObject;
  const _contact = input.contact;
  return {
    ...input,
    ...(_contact !== undefined && { contact: parseContactObject(_contact) }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {
        contacts: [],
      };
  const _contacts = input.contacts;
  return {
    ...input,
    contacts: validateArray(_contacts, parseContactObject),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {} as UserObject;
  const _contacts = input.contacts;
  return {
    ...input,
    ...(_contacts !== undefined && { contacts: validateArray(_contacts, parseContactObject) }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: false })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {} as UserObject;
  const _contacts = input.contacts;
  if ((_contacts === undefined || Array.isArray(_contacts))) return { ...input } as UserObject;
  return {
    ...input,
    ...(_contacts !== undefined && { contacts: Array.isArray(_contacts) ? _contacts : [] }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'StringMapObject')

    expect(result).toBe(
      'export const parseStringMapObject = (input: unknown): StringMapObject => validateRecord(input, (value: unknown) => typeof value === "string" ? value : "") as StringMapObject;',
    )
  })

  it('handles object with additionalProperties as ref without useRefImports', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        $ref: '#/$defs/Contact',
      },
    }

    const result = generateParserFunction(schema, 'ContactMapObject', { useRefImports: false })

    expect(result).toBe(
      `export const parseContactMapObject = (input: unknown): ContactMapObject => isObject(input) ? input as ContactMapObject : {};`,
    )
  })

  it('handles object with additionalProperties as ref with useRefImports', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        $ref: '#/$defs/Contact',
      },
    }

    const result = generateParserFunction(schema, 'ContactMapObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseContactMapObject = (input: unknown): ContactMapObject => validateRecord(input, parseContactObject) as ContactMapObject;`,
    )
  })

  it('handles object with additionalProperties false', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: false,
    }

    const result = generateParserFunction(schema, 'StrictObject')

    expect(result).toBe('export const parseStrictObject = (input: unknown): StrictObject => isObject(input) ? input as StrictObject : {} as StrictObject;')
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

    const result = generateParserFunction(schema, 'ComplexObject')

    expect(result).toBe(
      `export const parseComplexObject = (input: unknown): ComplexObject => {
  if (!isObject(input)) return {
        id: 0,
        name: "",
      };
  const _id = input.id;
  const _name = input.name;
  const _tags = input.tags;
  const _metadata = input.metadata;
  const _isActive = input.isActive;
  if (typeof _id === "number" && typeof _name === "string" && (_tags === undefined || Array.isArray(_tags)) && (_metadata === undefined || isObject(_metadata)) && (_isActive === undefined || typeof _isActive === "boolean")) return { ...input } as ComplexObject;
  return {
    ...input,
    id: typeof _id === "number" ? _id : (_id !== undefined ? Number(_id) : 0),
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_tags !== undefined && { tags: Array.isArray(_tags) ? _tags : [] }),
    ...(_metadata !== undefined && { metadata: isObject(_metadata) ? _metadata : typeof _metadata === "object" && _metadata !== null ? _metadata : {} }),
    ...(_isActive !== undefined && { isActive: typeof _isActive === "boolean" ? _isActive : Boolean(_isActive) }),
  } as unknown as ComplexObject;
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

    const result = generateParserFunction(schema, 'ApiSpecObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseApiSpecObject = (input: unknown): ApiSpecObject => {
  if (!isObject(input)) return {} as ApiSpecObject;
  const _externalDoc = input.externalDoc;
  return {
    ...input,
    ...(_externalDoc !== undefined && { externalDoc: parseExternalDocumentationObject(_externalDoc) }),
  } as unknown as ApiSpecObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {
        contact: parseContactObject(undefined),
      };
  const _contact = input.contact;
  const _address = input.address;
  const _company = input.company;
  return {
    ...input,
    contact: parseContactObject(_contact),
    ...(_address !== undefined && { address: parseAddressObject(_address) }),
    ...(_company !== undefined && { company: parseCompanyObject(_company) }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {
        id: 0,
        name: "",
      };
  const _contact = input.contact;
  return {
    ...input,
    id: typeof input?.id === "number" ? input?.id : (input?.id !== undefined ? Number(input?.id) : 0),
    ...(_contact !== undefined && { contact: parseContactObject(_contact) }),
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'TaggedObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseTaggedObject = (input: unknown): TaggedObject => {
  if (!isObject(input)) return {} as TaggedObject;
  const _tags = input.tags;
  if ((_tags === undefined || Array.isArray(_tags))) return { ...input } as TaggedObject;
  return {
    ...input,
    ...(_tags !== undefined && { tags: Array.isArray(_tags) ? _tags : [] }),
  } as unknown as TaggedObject;
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

    const result = generateParserFunction(schema, 'ItemsContainerObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseItemsContainerObject = (input: unknown): ItemsContainerObject => {
  if (!isObject(input)) return {} as ItemsContainerObject;
  const _items = input.items;
  if ((_items === undefined || Array.isArray(_items))) return { ...input } as ItemsContainerObject;
  return {
    ...input,
    ...(_items !== undefined && { items: Array.isArray(_items) ? _items : [] }),
  } as unknown as ItemsContainerObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {} as UserObject;
  const _contact = input.contact;
  return {
    ...input,
    ...(_contact !== undefined && { contact: parseContactObject(_contact) }),
    ...(input.age !== undefined && { age: typeof input?.age === "number" ? input?.age : Number(input?.age) }),
  } as unknown as UserObject;
}`,
    )
  })

  it('handles empty properties object', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {},
    }

    const result = generateParserFunction(schema, 'EmptyObject')

    expect(result).toBe(
      `export const parseEmptyObject = (input: unknown): EmptyObject => {
  if (!isObject(input)) return {} as EmptyObject;
  return {
    ...input,
  } as unknown as EmptyObject;
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

    const result = generateParserFunction(schema, 'AllInvalidObject')

    expect(result).toBe(
      `export const parseAllInvalidObject = (input: unknown): AllInvalidObject => {
  if (!isObject(input)) return {} as AllInvalidObject;
  return {
    ...input,
  } as unknown as AllInvalidObject;
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

    const result = generateParserFunction(schema, 'MyCustomTypeObject')

    expect(result).toBe(
      `export const parseMyCustomTypeObject = (input: unknown): MyCustomTypeObject => {
  if (!isObject(input)) return {} as MyCustomTypeObject;
  const _id = input.id;
  if ((_id === undefined || typeof _id === "number")) return { ...input } as MyCustomTypeObject;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : Number(_id) }),
  } as unknown as MyCustomTypeObject;
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

    const result = generateParserFunction(schema, 'myCustomTypeObject')

    expect(result).toBe(
      `export const parsemyCustomTypeObject = (input: unknown): myCustomTypeObject => {
  if (!isObject(input)) return {} as myCustomTypeObject;
  const _id = input.id;
  if ((_id === undefined || typeof _id === "number")) return { ...input } as myCustomTypeObject;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : Number(_id) }),
  } as unknown as myCustomTypeObject;
}`,
    )
  })

  it('handles object schema with properties property but no type', () => {
    const schema: JSONSchema = {
      properties: {
        name: { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'ImplicitObject')

    expect(result).toBe(
      `export const parseImplicitObject = (input: unknown): ImplicitObject => {
  if (!isObject(input)) return {} as ImplicitObject;
  const _name = input.name;
  if ((_name === undefined || typeof _name === "string")) return { ...input } as ImplicitObject;
  return {
    ...input,
    ...(_name !== undefined && { name: typeof _name === "string" ? _name : String(_name) }),
  } as unknown as ImplicitObject;
}`,
    )
  })

  it('handles additionalProperties as true', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: true,
    }

    const result = generateParserFunction(schema, 'AnyAdditionalObject')

    expect(result).toBe(
      'export const parseAnyAdditionalObject = (input: unknown): AnyAdditionalObject => isObject(input) ? input as AnyAdditionalObject : {} as AnyAdditionalObject;',
    )
  })

  it('handles additionalProperties with string type by validating values', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        type: 'string',
      },
    }

    const result = generateParserFunction(schema, 'MapOfStringsObject', { useRefImports: true })

    expect(result).toBe(
      'export const parseMapOfStringsObject = (input: unknown): MapOfStringsObject => validateRecord(input, (value: unknown) => typeof value === "string" ? value : "") as MapOfStringsObject;',
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

    const result = generateParserFunction(schema, 'SecurityRequirementObject', { useRefImports: true })

    expect(result).toBe(
      'export const parseSecurityRequirementObject = (input: unknown): SecurityRequirementObject => validateRecord(input, (value: unknown) => Array.isArray(value) ? value : []) as SecurityRequirementObject;',
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

    const result = generateParserFunction(schema, 'ContainerObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseContainerObject = (input: unknown): ContainerObject => {
  if (!isObject(input)) return {} as ContainerObject;
  const _data = input.data;
  if ((_data === undefined || Array.isArray(_data))) return { ...input } as ContainerObject;
  return {
    ...input,
    ...(_data !== undefined && { data: Array.isArray(_data) ? _data : [] }),
  } as unknown as ContainerObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {} as UserObject;
  const _nested = input.nested;
  return {
    ...input,
    ...(_nested !== undefined && { nested: parseTypeObject(_nested) }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {} as UserObject;
  const _contacts = input.contacts;
  const _addresses = input.addresses;
  return {
    ...input,
    ...(_contacts !== undefined && { contacts: validateArray(_contacts, parseContactObject) }),
    ...(_addresses !== undefined && { addresses: validateArray(_addresses, parseAddressObject) }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'UserObject')

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {} as UserObject;
  const _id = input.id;
  const _name = input.name;
  if ((_id === undefined || typeof _id === "number") && (_name === undefined || typeof _name === "string")) return { ...input } as UserObject;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : Number(_id) }),
    ...(_name !== undefined && { name: typeof _name === "string" ? _name : String(_name) }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'UserObject')

    expect(result).toBe(
      `export const parseUserObject = (input: unknown): UserObject => {
  if (!isObject(input)) return {} as UserObject;
  const _id = input.id;
  if ((_id === undefined || typeof _id === "number")) return { ...input } as UserObject;
  return {
    ...input,
    ...(_id !== undefined && { id: typeof _id === "number" ? _id : Number(_id) }),
  } as unknown as UserObject;
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

    const result = generateParserFunction(schema, 'MapObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseMapObject = (input: unknown): MapObject => validateRecord(input, parseValueObject) as MapObject;`,
    )
  })

  it('generates security-scheme parser dispatching to http-bearer when only type-http-bearer is in allOf', () => {
    // When type-http is absent from allOf but type-http-bearer is present, the switch
    // case for "http" should route directly to the bearer parser without the dual check.
    const schema: JSONSchema = {
      $comment: 'https://spec.openapis.org/oas/v3.1#security-scheme-object',
      type: 'object',
      allOf: [
        { $ref: '#/$defs/specification-extensions' },
        { $ref: '#/$defs/security-scheme/$defs/type-apikey' },
        { $ref: '#/$defs/security-scheme/$defs/type-http-bearer' },
        { $ref: '#/$defs/security-scheme/$defs/type-oauth2' },
        { $ref: '#/$defs/security-scheme/$defs/type-oidc' },
      ],
    }

    const result = generateParserFunction(schema, 'SecuritySchemeObject', { useRefImports: true })

    expect(result).toContain('case "http"')
    expect(result).toContain('parseTypeHttpBearerObject')
    // Without type-http in allOf, there should be no separate http parser call
    expect(result).not.toContain('parseTypeHttpObject')
  })

  it('generates a parser for the components object', () => {
    const components: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#components-object',
      type: 'object',
      properties: {
        responses: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/response-or-reference',
          },
        },
        parameters: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/parameter-or-reference',
          },
        },
        examples: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/example-or-reference',
          },
        },
        requestBodies: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/request-body-or-reference',
          },
        },
        headers: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/header-or-reference',
          },
        },
        securitySchemes: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/security-scheme-or-reference',
          },
        },
        links: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/link-or-reference',
          },
        },
        callbacks: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/callbacks-or-reference',
          },
        },
        pathItems: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/path-item',
          },
        },
      },
    }

    const result = generateParserFunction(components, 'ComponentsObject', { useRefImports: true })
    expect(result).toBe(
      `export const parseComponentsObject = (input: unknown): ComponentsObject => {
  if (!isObject(input)) return {} as ComponentsObject;
  const _responses = input.responses;
  const _parameters = input.parameters;
  const _examples = input.examples;
  const _requestBodies = input.requestBodies;
  const _headers = input.headers;
  const _securitySchemes = input.securitySchemes;
  const _links = input.links;
  const _callbacks = input.callbacks;
  const _pathItems = input.pathItems;
  return {
    ...input,
    ...(_responses !== undefined && { responses: validateRecord(_responses, parseResponseObject) }),
    ...(_parameters !== undefined && { parameters: validateRecord(_parameters, parseParameterObject) }),
    ...(_examples !== undefined && { examples: validateRecord(_examples, parseExampleObject) }),
    ...(_requestBodies !== undefined && { requestBodies: validateRecord(_requestBodies, parseRequestBodyObject) }),
    ...(_headers !== undefined && { headers: validateRecord(_headers, parseHeaderObject) }),
    ...(_securitySchemes !== undefined && { securitySchemes: validateRecord(_securitySchemes, parseSecuritySchemeObject) }),
    ...(_links !== undefined && { links: validateRecord(_links, parseLinkObject) }),
    ...(_callbacks !== undefined && { callbacks: validateRecord(_callbacks, parseCallbacksObject) }),
    ...(_pathItems !== undefined && { pathItems: validateRecord(_pathItems, parsePathItemObject) }),
  } as unknown as ComponentsObject;
}`,
    )
  })

  it('handles ref schema with conditional if/then/else logic', () => {
    const schema: JSONSchema = {
      if: { type: 'object', required: ['$ref'] },
      then: { $ref: '#/$defs/reference' },
      else: { $ref: '#/$defs/callbacks' },
    }

    const result = generateParserFunction(schema, 'ConditionalObject')
    expect(result).toBe(
      `export const parseConditionalObject = (input: unknown): ConditionalObject | ReferenceObject =>
  hasRef(input) ? parseReferenceObject(input) : parseCallbacksObject(input)
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

    const result = generateParserFunction(schema, 'PathsObject', { useRefImports: true })

    expect(result).toBe(
      `export const parsePathsObject = (input: unknown): PathsObject => {
  if (!isObject(input)) {
    return {} as unknown as PathsObject;
  }
  const result = {
    ...input,
  } as unknown as PathsObject;
  for (const key in input) {
    if (/^\\//.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = parsePathItemObject(value);
    }
  }
  return result;
};`,
    )
  })

  it('generates security-scheme parser as a subtype union dispatcher', () => {
    const schema: JSONSchema = {
      $comment: 'https://spec.openapis.org/oas/v3.1#security-scheme-object',
      type: 'object',
      allOf: [
        { $ref: '#/$defs/specification-extensions' },
        { $ref: '#/$defs/security-scheme/$defs/type-apikey' },
        { $ref: '#/$defs/security-scheme/$defs/type-http' },
        { $ref: '#/$defs/security-scheme/$defs/type-http-bearer' },
        { $ref: '#/$defs/security-scheme/$defs/type-oauth2' },
        { $ref: '#/$defs/security-scheme/$defs/type-oidc' },
      ],
    }

    const result = generateParserFunction(schema, 'SecuritySchemeObject', { useRefImports: true })

    expect(result).toBe(`export const parseSecuritySchemeObject = (input: unknown): SecuritySchemeObject => {
  if (!isObject(input)) {
    return parseTypeApikeyObject(input);
  }

  const parsedSubtype: SecuritySchemeObject = (() => {
    switch (input["type"]) {
    case "apiKey":
      return parseTypeApikeyObject(input);
    case "http":
      if (typeof input["scheme"] === "string" && /^[Bb][Ee][Aa][Rr][Ee][Rr]$/.test(input["scheme"])) {
        return parseTypeHttpBearerObject(input);
      }
      return parseTypeHttpObject(input);
    case "oauth2":
      return parseTypeOauth2Object(input);
    case "openIdConnect":
      return parseTypeOidcObject(input);
    default:
      return parseTypeApikeyObject(input);
    }
  })();

  return {
    ...input,
    ...((value => value === undefined ? {} : { description: value })(typeof input?.["description"] === "string" ? input?.["description"] : (input?.["description"] !== undefined ? String(input?.["description"]) : undefined))),
    ...parsedSubtype,
  };
};`)
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
      `export const parseWebhooks = (input: unknown): Webhooks => validateRecord(input, parsePathItemObject) as Webhooks;`,
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
      (result as Record<string, unknown>)[key] = parsePathItemObject(value);
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
        info: parseInfoObject(undefined),
      };
  const _info = input.info;
  const _servers = input.servers;
  const _paths = input.paths;
  const _webhooks = input.webhooks;
  const _components = input.components;
  const _externalDocs = input.externalDocs;
  return {
    ...input,
    openapi: typeof input?.openapi === "string" ? input?.openapi : (input?.openapi !== undefined ? String(input?.openapi) : ""),
    info: parseInfoObject(_info),
    ...(_servers !== undefined && { servers: validateArray(_servers, parseServerObject) }),
    ...(_paths !== undefined && { paths: parsePathsObject(_paths) }),
    ...(_webhooks !== undefined && { webhooks: validateRecord(_webhooks, parsePathItemObject) }),
    ...(_components !== undefined && { components: parseComponentsObject(_components) }),
    ...(_externalDocs !== undefined && { externalDocs: parseExternalDocumentationObject(_externalDocs) }),
  } as unknown as Document;
}`)
  })

  it('generates parser for OpenAPI 3.1.2 components schema with all properties', () => {
    // This is the actual schema from OpenAPI 3.1.2 specification
    const schema: JSONSchema = {
      $comment: 'https://spec.openapis.org/oas/v3.1#components-object',
      type: 'object',
      properties: {
        schemas: {
          type: 'object',
          additionalProperties: {
            $dynamicRef: '#meta',
          },
        },
        responses: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/response-or-reference',
          },
        },
        parameters: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/parameter-or-reference',
          },
        },
        examples: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/example-or-reference',
          },
        },
        requestBodies: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/request-body-or-reference',
          },
        },
        headers: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/header-or-reference',
          },
        },
        securitySchemes: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/security-scheme-or-reference',
          },
        },
        links: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/link-or-reference',
          },
        },
        callbacks: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/callbacks-or-reference',
          },
        },
        pathItems: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/path-item',
          },
        },
      },
      patternProperties: {
        '^(?:schemas|responses|parameters|examples|requestBodies|headers|securitySchemes|links|callbacks|pathItems)$': {
          $comment:
            'Enumerating all of the property names in the regex above is necessary for unevaluatedProperties to work as expected',
          propertyNames: {
            pattern: '^[a-zA-Z0-9._-]+$',
          },
        },
      },
      $ref: '#/$defs/specification-extensions',
      unevaluatedProperties: false,
    }

    const result = generateParserFunction(schema, 'ComponentsObject', { useRefImports: true })
    expect(result).toBe(
      `export const parseComponentsObject = (input: unknown): ComponentsObject => {
  if (!isObject(input)) return {} as ComponentsObject;
  const _responses = input.responses;
  const _parameters = input.parameters;
  const _examples = input.examples;
  const _requestBodies = input.requestBodies;
  const _headers = input.headers;
  const _securitySchemes = input.securitySchemes;
  const _links = input.links;
  const _callbacks = input.callbacks;
  const _pathItems = input.pathItems;
  return {
    ...input,
    ...(input.schemas !== undefined && { schemas: isObject(input?.schemas) ? input?.schemas : typeof input?.schemas === "object" && input?.schemas !== null ? input?.schemas : {} }),
    ...(_responses !== undefined && { responses: validateRecord(_responses, parseResponseObject) }),
    ...(_parameters !== undefined && { parameters: validateRecord(_parameters, parseParameterObject) }),
    ...(_examples !== undefined && { examples: validateRecord(_examples, parseExampleObject) }),
    ...(_requestBodies !== undefined && { requestBodies: validateRecord(_requestBodies, parseRequestBodyObject) }),
    ...(_headers !== undefined && { headers: validateRecord(_headers, parseHeaderObject) }),
    ...(_securitySchemes !== undefined && { securitySchemes: validateRecord(_securitySchemes, parseSecuritySchemeObject) }),
    ...(_links !== undefined && { links: validateRecord(_links, parseLinkObject) }),
    ...(_callbacks !== undefined && { callbacks: validateRecord(_callbacks, parseCallbacksObject) }),
    ...(_pathItems !== undefined && { pathItems: validateRecord(_pathItems, parsePathItemObject) }),
  } as unknown as ComponentsObject;
}`,
    )
  })

  it('generates combined parser for schema with both properties and patternProperties', () => {
    // This is the OpenAPI responses object pattern: known "default" property
    // plus patternProperties for HTTP status codes like "200", "4XX"
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        default: { $ref: '#/$defs/response-or-reference' },
      },
      patternProperties: {
        '^[1-5](?:[0-9]{2}|XX)$': { $ref: '#/$defs/response-or-reference' },
      },
    }

    const result = generateParserFunction(schema, 'ResponsesObject', { useRefImports: true })

    expect(result).toBe(
      `export const parseResponsesObject = (input: unknown): ResponsesObject => {
  if (!isObject(input)) {
    return {} as unknown as ResponsesObject;
  }
  const result = {
    ...input,
    ...(input.default && { default: isObject(input.default) && '$ref' in input.default ? input.default : parseResponseObject(input.default) }),
  } as unknown as ResponsesObject;
  for (const key in input) {
    if (/^[1-5](?:[0-9]{2}|XX)$/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = isObject(value) && '$ref' in value ? value : parseResponseObject(value);
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

    const result = generateParserFunction(schema, 'ResponsesObject', { useRefImports: false })

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

    const result = generateParserFunction(schema, 'SchemaObject', { useRefImports: true })

    // SchemaObject is a special case that handles both boolean and object types
    expect(result).toContain("if (typeof input === 'boolean')")
    expect(result).toContain('return input as SchemaObject')
    expect(result).toContain('if (!isObject(input))')
    expect(result).toContain('return {} as SchemaObject')
  })

  it('uses bracket notation for hyphenated property keys with $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        'x-linkedin': { $ref: '#/$defs/extension' },
      },
    }

    const result = generateParserFunction(schema, 'InfoExtensionsObject', { useRefImports: true })

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

    const result = generateParserFunction(schema, 'TestObject')

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

    const result = generateParserFunction(schema, 'TypeHttpObject', { useRefImports: true })

    expect(result).toContain('isObject(input)')
    expect(result).toContain('type:')
    expect(result).toContain('scheme:')
    expect(result).not.toContain('input as TypeHttpObject')
  })

  it('generates parser for patternProperties-only schema without explicit type', () => {
    const schema: JSONSchema = {
      patternProperties: {
        '^x-': true,
      },
    }

    const result = generateParserFunction(schema, 'SpecificationExtensionsObject', { useRefImports: true })

    expect(result).toContain('for (const key in input)')
    expect(result).toContain('...input,')
    expect(result).not.toContain('input as SpecificationExtensionsObject')
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

    const result = generateParserFunction(schema, 'ExampleObject')

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

    const result = generateParserFunction(schema, 'UserObject')

    // Should cache variables because fast-path exists
    expect(result).toContain('const _name = input.name')
    expect(result).toContain('const _age = input.age')
    // Should have fast-path check
    expect(result).toContain('if (typeof _name === "string"')
    expect(result).toContain('return { ...input } as UserObject')
  })

  it('optimization: removes redundant undefined checks in optional properties', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        description: { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'ExampleObject')

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

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

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

    const result = generateParserFunction(schema, 'CodeObject')

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

    const result = generateParserFunction(schema, 'ItemObject')

    // Should have fast-path that returns a new shallow copy
    expect(result).toContain('return { ...input } as ItemObject')
    // Fast-path check should exist
    expect(result).toContain('if (typeof _id')
    // Should have both fast and slow paths
    expect(result).toContain('return {')
  })

  it('optimization: no fast-path when properties use ref imports', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/Contact' },
        name: { type: 'string' },
      },
    }

    const result = generateParserFunction(schema, 'UserObject', { useRefImports: true })

    // Should NOT have fast-path because ref imports cannot be checked inline
    expect(result).not.toContain('return { ...input } as UserObject')
    // Should still have the main return statement
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

    const result = generateParserFunction(schema, 'OptionalObject')

    // Should have fast-path for all optional
    expect(result).toContain('return { ...input } as OptionalObject')
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

    const result = generateParserFunction(schema, 'UserObject')

    // Should cache all variables for fast-path
    expect(result).toContain('const _id')
    expect(result).toContain('const _name')
    expect(result).toContain('const _email')
    // Should have fast-path check
    expect(result).toContain('return { ...input } as UserObject')
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

    const result = generateParserFunction(schema, 'MixedObject')

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
        tags: { description: 'Searchable labels associated with the product.', type: 'array', items: { type: 'string' } },
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
    price: typeof _price === "number" && _price >= 0 ? _price : (_price !== undefined ? Number(_price) : 0),
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
    ...(_page !== undefined && { page: typeof _page === "number" && _page >= 1 ? _page : Number(_page) }),
    ...(_perPage !== undefined && { perPage: typeof _perPage === "number" && _perPage >= 1 && _perPage <= 100 ? _perPage : Number(_perPage) }),
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
    latitude: typeof _latitude === "number" && _latitude >= -90 && _latitude <= 90 ? _latitude : (_latitude !== undefined ? Number(_latitude) : 0),
    longitude: typeof _longitude === "number" && _longitude >= -180 && _longitude <= 180 ? _longitude : (_longitude !== undefined ? Number(_longitude) : 0),
    ...(_altitude !== undefined && { altitude: typeof _altitude === "number" ? _altitude : Number(_altitude) }),
    ...(_label !== undefined && { label: typeof _label === "string" ? _label : String(_label) }),
  } as unknown as GeoCoordinate;
}`,
    )
  })
})
