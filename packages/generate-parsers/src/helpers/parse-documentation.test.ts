import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'bun:test'
import { parseDocumentation } from './parse-documentation'

const markdownDocumentation = await readFile(new URL('../../../../fixtures/3.1.0.md', import.meta.url), 'utf-8')

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
})

describe('parse-documentation (real OpenAPI markdown)', () => {
  it('parses the OAuth Flows Object section', () => {
    // Verifies that the "#### OAuth Flows Object" heading is present and parseable.
    // The oauth-flows fixture is missing JSDoc only because the source schema lacks $comment —
    // not because the documentation section is absent from the markdown.
    const result = parseDocumentation(markdownDocumentation, 'https://spec.openapis.org/oas/v3.1#oauth-flows-object')

    expect(result).not.toBeNull()
    expect(result?.title).toBe('Oauth Flows object')
    expect(result?.description).toContain('Allows configuration of the supported OAuth Flows')
    expect(result?.properties).toHaveProperty('implicit')
    expect(result?.properties).toHaveProperty('password')
    expect(result?.properties).toHaveProperty('clientCredentials')
    expect(result?.properties).toHaveProperty('authorizationCode')
  })

  it('parses the OAuth Flow Object section including the Applies To column', () => {
    // The OAuth Flow Object table has four columns (Field Name | Type | Applies To | Description).
    // parseDocumentation must pick the last column (index 3) as the description.
    // All four sub-type fixtures (authorization-code, client-credentials, implicit, password)
    // would receive these property docs if their source schemas had a $comment.
    const result = parseDocumentation(markdownDocumentation, 'https://spec.openapis.org/oas/v3.1#oauth-flow-object')

    expect(result).not.toBeNull()
    expect(result?.title).toBe('Oauth Flow object')
    expect(result?.description).toContain('Configuration details for a supported OAuth Flow')
    expect(result?.properties['authorizationUrl']?.description).toContain('**REQUIRED**. The authorization URL')
    expect(result?.properties['tokenUrl']?.description).toContain('**REQUIRED**. The token URL')
    expect(result?.properties['refreshUrl']?.description).toContain('obtaining refresh tokens')
    expect(result?.properties['scopes']?.description).toContain('**REQUIRED**. The available scopes')
  })

  it('returns null for the specification-extensions fragment', () => {
    // The specification-extensions fixture has $comment "...#specification-extensions",
    // but there is no "#### Specification Extensions" heading in the markdown.
    // parseDocumentation therefore returns null, and no JSDoc is emitted.
    const result = parseDocumentation(
      markdownDocumentation,
      'https://spec.openapis.org/oas/v3.1#specification-extensions',
    )

    expect(result).toBeNull()
  })

  it('returns null for the fixed-fields-10 fragment', () => {
    // The content fixture has $comment "...#fixed-fields-10".
    // parseDocumentation converts the fragment to "Fixed Fields 10" and looks for
    // "#### Fixed Fields 10", which does not exist as a section heading.
    const result = parseDocumentation(markdownDocumentation, 'https://spec.openapis.org/oas/v3.1#fixed-fields-10')

    expect(result).toBeNull()
  })
})
