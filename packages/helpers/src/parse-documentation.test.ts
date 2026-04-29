import { describe, expect, it } from 'bun:test'

import { parseDocumentation } from './parse-documentation'

describe('parse-documentation', () => {
  const markdown = `
#### Info Object

This is the info description that spans
across multiple lines.

##### Fixed Fields

Field Name | Type | Description
---|---|---
title | string | **REQUIRED**. The title of the API.
description | string | A description of the API. [CommonMark syntax](http://commonmark.org/) MAY be used for rich text representation.
version | string | **REQUIRED**. The version of the OpenAPI Document.

This object MAY be extended with Specification Extensions.

#### Contact Object

Contact information for the exposed API.

##### Fixed Fields

Field Name | Type | Description
---|---|---
name | string | The identifying name of the contact person/organization.
url | string | The URL for the contact information. This MUST be in the form of a URL.
email | string | The email address of the contact person/organization.
`

  it('parses title from fragment ID', () => {
    const result = parseDocumentation(markdown, 'https://spec.openapis.org/oas/v3.1.1#info-object')
    expect(result?.title).toBe('Info object')
  })

  it('parses description from section content', () => {
    const result = parseDocumentation(markdown, 'https://spec.openapis.org/oas/v3.1.1#info-object')
    expect(result?.description).toContain('info description')
  })

  it('parses properties from Fixed Fields table', () => {
    const result = parseDocumentation(markdown, 'https://spec.openapis.org/oas/v3.1.1#info-object')
    expect(result?.properties).toHaveProperty('title')
    expect(result?.properties).toHaveProperty('description')
    expect(result?.properties).toHaveProperty('version')
  })

  it('detects REQUIRED fields', () => {
    const result = parseDocumentation(markdown, 'https://spec.openapis.org/oas/v3.1.1#info-object')
    expect(result?.properties['title']?.isRequired).toBe(true)
    expect(result?.properties['description']?.isRequired).toBe(false)
    expect(result?.properties['version']?.isRequired).toBe(true)
  })

  it('returns null when fragment ID is missing', () => {
    const result = parseDocumentation(markdown, 'https://spec.openapis.org/oas/v3.1.1')
    expect(result).toBeNull()
  })

  it('returns null when section is not found', () => {
    const result = parseDocumentation(markdown, 'https://spec.openapis.org/oas/v3.1.1#nonexistent-object')
    expect(result).toBeNull()
  })

  it('parses contact object correctly', () => {
    const result = parseDocumentation(markdown, 'https://spec.openapis.org/oas/v3.1.1#contact-object')
    expect(result?.title).toBe('Contact object')
    expect(result?.properties).toHaveProperty('name')
    expect(result?.properties).toHaveProperty('url')
    expect(result?.properties).toHaveProperty('email')
  })

  it('replaces relative anchor links with full URLs', () => {
    const mdWithAnchors = `
#### Test Object

Test description.

##### Fixed Fields

Field Name | Type | Description
---|---|---
ref | string | See (#other-object) for details.
`
    const result = parseDocumentation(mdWithAnchors, 'https://spec.openapis.org/oas/v3.1.1#test-object')
    expect(result?.properties['ref']?.description).toContain('https://spec.openapis.org/oas/v3.1.1#other-object')
  })

  it('handles escaped pipes in table cells', () => {
    const mdWithPipes = `
#### Pipe Object

Description.

##### Fixed Fields

Field Name | Type | Description
---|---|---
pattern | string | Uses \\| as separator.
`
    const result = parseDocumentation(mdWithPipes, 'https://example.com#pipe-object')
    expect(result?.properties['pattern']?.description).toContain('|')
  })

  it('handles table with Applies To column', () => {
    const mdWithAppliesTo = `
#### Extended Object

Description.

##### Fixed Fields

Field Name | Applies To | Type | Description
---|---|---|---
name | All | string | The field name description.
`
    const result = parseDocumentation(mdWithAppliesTo, 'https://example.com#extended-object')
    expect(result?.properties['name']?.description).toContain('field name description')
  })

  it('returns null for empty markdown', () => {
    const result = parseDocumentation('', 'https://example.com#some-object')
    expect(result).toBeNull()
  })

  it('returns empty description when section has no description before Fixed Fields', () => {
    const mdNoDesc = `
#### No Desc Object

##### Fixed Fields

Field Name | Type | Description
---|---|---
name | string | A name field.
`
    const result = parseDocumentation(mdNoDesc, 'https://example.com#no-desc-object')
    expect(result?.description).toBe('')
    expect(result?.properties).toHaveProperty('name')
  })

  it('handles HTML tags in field names', () => {
    const mdWithHtml = `
#### Html Object

Description.

##### Fixed Fields

Field Name | Type | Description
---|---|---
<span>name</span> | string | A name field.
`
    const result = parseDocumentation(mdWithHtml, 'https://example.com#html-object')
    expect(result?.properties).toHaveProperty('name')
  })

  it('inherits properties from fallback section when primary has no Fixed Fields table', () => {
    const mdWithFallback = `
#### Header Object

The Header Object follows the structure of the Parameter Object.

#### Parameter Object

Parameter description.

##### Fixed Fields

Field Name | Type | Description
---|---|---
description | string | A brief description.
required | boolean | Whether the parameter is mandatory.
`
    const result = parseDocumentation(
      mdWithFallback,
      'https://example.com#header-object',
      'https://example.com#parameter-object',
    )
    expect(result?.title).toBe('Header object')
    expect(result?.description).toContain('follows the structure')
    expect(result?.properties).toHaveProperty('description')
    expect(result?.properties).toHaveProperty('required')
  })

  it('does not use fallback when primary section has its own Fixed Fields table', () => {
    const mdWithBoth = `
#### Header Object

Header description.

##### Fixed Fields

Field Name | Type | Description
---|---|---
ownField | string | A field unique to header.

#### Parameter Object

Parameter description.

##### Fixed Fields

Field Name | Type | Description
---|---|---
description | string | A brief description.
`
    const result = parseDocumentation(
      mdWithBoth,
      'https://example.com#header-object',
      'https://example.com#parameter-object',
    )
    expect(result?.properties).toHaveProperty('ownField')
    expect(result?.properties).not.toHaveProperty('description')
  })

  it('excludes non-field rows from adjacent tables within the Fixed Fields section', () => {
    // The Encoding Object has a "default contentType" table between its two Fixed Fields
    // sub-tables. Rows like `\`string\`` and `[_absent_]` must not be treated as field names.
    const mdWithAdjacentTable = `
#### Encoding Object

Encoding description.

##### Fixed Fields

###### Common Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| contentType | \`string\` | The content type. |

This object MAY be extended with Specification Extensions.

| \`type\` | \`contentEncoding\` | Default |
| ---- | ---- | ---- |
| \`string\` | present | \`application/octet-stream\` |
| [_absent_](#foo) | n/a | \`application/octet-stream\` |

###### RFC6570 Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| style | \`string\` | The style. |
`
    const result = parseDocumentation(mdWithAdjacentTable, 'https://example.com#encoding-object')
    expect(result?.properties).toHaveProperty('contentType')
    expect(result?.properties).toHaveProperty('style')
    // Rows from the non-field table should be excluded
    expect(result?.properties).not.toHaveProperty('`string`')
    expect(result?.properties).not.toHaveProperty('`type`')
    expect(Object.keys(result?.properties ?? {}).some((k) => k.startsWith('['))).toBe(false)
  })

  it('collects properties from multiple sub-tables within a single Fixed Fields section', () => {
    const mdMultiTable = `
#### Encoding Object

Encoding description.

##### Fixed Fields

###### Common Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| contentType | \`string\` | The content type. |
| headers | Map | A map of headers. |

This object MAY be extended with Specification Extensions.

###### Fixed Fields for RFC6570-style Serialization

| Field Name | Type | Description |
| ---- | :----: | ---- |
| style | \`string\` | The style. |
| explode | \`boolean\` | Whether to explode. |
| allowReserved | \`boolean\` | Whether to allow reserved. |

#### Next Object

Next description.
`
    const result = parseDocumentation(mdMultiTable, 'https://example.com#encoding-object')
    expect(result?.properties).toHaveProperty('contentType')
    expect(result?.properties).toHaveProperty('headers')
    expect(result?.properties).toHaveProperty('style')
    expect(result?.properties).toHaveProperty('explode')
    expect(result?.properties).toHaveProperty('allowReserved')
    expect(result?.properties['style']?.description).toBe('The style.')
  })

  it('ignores fallback when fallback section also has no properties', () => {
    const mdNoProperties = `
#### Header Object

Header description.

#### Parameter Object

Parameter description with no table.
`
    const result = parseDocumentation(
      mdNoProperties,
      'https://example.com#header-object',
      'https://example.com#parameter-object',
    )
    expect(result?.properties).toEqual({})
  })
})
