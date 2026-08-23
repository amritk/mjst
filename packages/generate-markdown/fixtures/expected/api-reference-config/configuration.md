# Configuration

You can pass a — what we call universal — configuration object to fine-tune your API reference.

It is universal because it works in all environments: pass it to the JS API directly, or use it in one of the integrations.

Working with just an HTML file, that is how you pass the configuration:

```javascript
Scalar.createApiReference('#app', {
  // Your configuration goes here…
  url: '/openapi.json'
})
```

## API Documents

There is just one thing that is really required to render at least something: the content. There are a couple of ways to pass your API document.

### url

**Type:** `string`

Pass an absolute or relative URL to your API document. This can be JSON or YAML.

It is the recommended way to pass your API document: in most cases the document can be cached by the browser, so subsequent requests are fast even as the document grows.

```javascript
{
  url: '/openapi.json'
}
```

### content

**Type:** `string | Record<string, any> | () => Record<string, any>`

Directly pass an API document (JSON or YAML) as a string.

> While this is convenient for a quick setup, it may hurt performance for large documents. Prefer `url` for those.

```javascript
{
  content: '{ "openapi": "3.1.1" }'
}
```

### sources

**Type:** `object[]`

Add multiple API documents to render all of them. We need a slug and title to tell them apart in the UI and in the URL — omit them and we will do our best anyway.

```javascript
Scalar.createApiReference('#app', {
  sources: [
    { title: 'Scalar Galaxy', slug: 'scalar-galaxy', url: 'https://example.com/galaxy.json' },
    { url: 'https://example.com/openapi.json', default: true },
  ]
})
```

The first entry is the default one. When the list is generated, set `default: true` to pick another.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` |  | Shown in the UI. Falls back to `API #1`, `API #2`, … |
| `slug` | `string` |  | Used in the URL. Generated from the title or the index when omitted. |
| `url` | `string` |  | Absolute or relative URL to the API document. |
| `default` | `boolean` | `false` | Makes this the document rendered first. |

## Properties

Configuration properties to customize the behavior and appearance of your API reference.

### authentication

**Type:** `AuthenticationConfiguration`

To make authentication easier you can prefill the credentials for your users.

```javascript
{
  authentication: {
    // The OpenAPI document has keys for all security schemes.
    // Specify which one should be used by default:
    preferredSecurityScheme: 'my_custom_security_scheme',
    securitySchemes: {
      apiKeyHeader: { name: 'X-API-KEY', in: 'header', value: 'tokenValue' },
    },
  }
}
```

`preferredSecurityScheme` also accepts an array (OR) or an array of arrays (AND/OR) for more complex relationships.

### darkMode

**Type:** `boolean`

Whether dark mode is on or off initially (light mode).

**Default:** `false`

```javascript
{
  darkMode: true
}
```

### documentDownloadType

**Type:** `'json' | 'yaml' | 'both' | 'direct' | 'none'`

Sets the file type of the document to download. Set it to `none` to hide the download button.

**Default:** `'both'`

```javascript
{
  documentDownloadType: 'json'
}
```

When `direct` is passed, it just outputs a regular link to the passed URL.

### hideModels

**Type:** `boolean`

Whether to show the models section at the bottom of the page.

**Default:** `false`

```javascript
{
  hideModels: true
}
```

### layout

**Type:** `'modern' | 'classic'`

The layout to use for the references.

**Default:** `'modern'`

```javascript
{
  layout: 'classic'
}
```

### proxyUrl

**Type:** `string`

Making requests to other domains is restricted in the browser and requires CORS headers. A proxy is used to work around that.

**Constraints:** `format: uri`

```javascript
{
  proxyUrl: 'https://proxy.scalar.com'
}
```

### searchHotKey

**Type:** `string`

Key used with `CTRL`/`CMD` to open the search modal.

**Default:** `'k'`

**Constraints:** `pattern: ^[a-z]$`

```javascript
{
  searchHotKey: 'l'
}
```

### spec

> **Deprecated**

**Type:** `object`

The old way to pass an API document.

> Use `url` or `content` instead. `spec` still works and is migrated automatically, with a console warning.

## Methods

Custom functions to control specific behaviors and URL generation.

### customFetch

**Type:** `(input: string | URL | Request, init?: RequestInit) => Promise<Response>`

Custom fetch function used both when loading the API document and when sending "Test Request" calls from the API client. Use it to add headers, attach credentials, or handle auth.

```javascript
{
  customFetch: (input, init) => window.fetch(input, { ...init, credentials: 'include' })
}
```

### generateHeadingSlug

**Type:** `(heading: Heading) => string`

Customize how heading URLs are generated. The function receives the heading and returns the string id that controls the entire URL hash.

> This must be passed through JavaScript — setting a data attribute will not work.

Default behavior, resulting in the hash `#description/heading-slug`:

```javascript
{
  generateHeadingSlug: (heading) => `#description/${heading.slug}`
}
```

A custom section instead:

```javascript
{
  generateHeadingSlug: (heading) => `#custom-section/${heading.slug}`
}
```

## Events

Callback functions that are triggered by user interactions and system events.

### onBeforeRequest

**Type:** `({ request, requestBuilder }) => void | Promise<void>`

Fired before the outbound request is sent from the embedded API client. Mutate `requestBuilder` to change method, path, query, headers, and body.

> **Experimental:** `RequestFactory` may change in minor releases. Treat its fields as unstable until the API stabilizes.

```javascript
{
  onBeforeRequest: ({ requestBuilder }) => {
    requestBuilder.headers.set('X-Custom-Header', 'test')
  }
}
```

### onLoaded

**Type:** `() => void`

Fired when the references are fully loaded.

```javascript
{
  onLoaded: () => console.log('The API reference is ready.')
}
```
