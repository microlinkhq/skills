---
name: microlink-api
description: Microlink HTTP API parameters, embed URLs, and query-string composition via the microlink.io client. Use when the user needs api.microlink.io query parameters, a direct asset URL via embed, or the full parameter list. Prefer the microlink skill for product methods.
---

# Microlink API

HTTP API behind `microlink.io`. Use the [microlink](../microlink/SKILL.md) skill for product methods. This skill covers endpoints, query parameters, embed URLs, and `extract` rule patterns.

## Quick Start

```js
import createClient from 'microlink.io'

const microlink = createClient()
const microlinkPro = createClient({ apiKey: process.env.MICROLINK_API_KEY })

const { title, description } = await microlink.metadata('https://example.com')
```

```bash
npm install microlink.io
```

- Free: `https://api.microlink.io` — 50 requests/day, no key
- Pro: `https://pro.microlink.io` — requires `apiKey` (`x-api-key`)

## When To Use What

- Metadata → `microlink.metadata(url)`
- Screenshot → `microlink.screenshot(url)`
- PDF → `microlink.pdf(url)`
- Specific DOM values → `microlink.extract(url, rules)`
- Direct asset URL (no JSON) → `embed` query param
- JS-heavy pages → `prerender: true` or keep `auto`

## Common Workflows

For copy-paste recipes, see [common-workflows/README.md](common-workflows/README.md).

## Parameters At A Glance

These are API query parameters. The product client routes well-known keys for you; everything else is forwarded as a top-level query param.

### Core

- `url` (required): target URL with protocol
- `meta` (default `true`): metadata extraction
- `data`: custom scraping rules (`extract`)
- `filter`: comma-separated output fields
- `embed`: return one field directly as the response body

### Asset generation

- `screenshot` / `screenshot.*`: create page image
- `pdf` / `pdf.*`: create PDF
- `video`, `audio`: detect playable sources

### Browser behavior

- `prerender`: `auto`, `true`, or `false`
- `waitUntil`, `waitForSelector`, `waitForTimeout`, `timeout`
- `device`, `viewport`, `javascript`, `animations`, `mediaType`
- `click`, `scroll`, `scripts`, `modules`, `styles`

### Caching and performance

- `force`: bypass cache
- `ttl` (Pro): cache lifetime
- `staleTtl` (Pro): stale-while-revalidate strategy

### Pro-only

- `headers`, `proxy`, `filename`, `ttl`, `staleTtl`

## Scraping Patterns

Pass rules to `microlink.extract(url, rules)`:

### Single value

```js
const { avatar } = await microlink.extract('https://example.com', {
  avatar: { selector: '#avatar', attr: 'src', type: 'image' }
})
```

### Collection

```js
const { stories } = await microlink.extract('https://news.ycombinator.com', {
  stories: { selectorAll: '.titleline > a', attr: 'text' }
})
```

### Fallback list

```js
const { title } = await microlink.extract('https://example.com', {
  title: [
    { selector: 'meta[property="og:title"]', attr: 'content' },
    { selector: 'title', attr: 'text' },
    { selector: 'h1', attr: 'text' }
  ]
})
```

### Nested object

```js
const { stats } = await microlink.extract('https://example.com', {
  stats: {
    selector: '.profile',
    attr: {
      followers: { selector: '.followers', type: 'number' },
      stars: { selector: '.stars', type: 'number' }
    }
  }
})
```

### Evaluate JS in browser context

```js
const { version } = await microlink.extract('https://example.com', {
  version: { evaluate: 'window.next.version', type: 'string' }
})
```

## Embed URLs

Return one field as the response body (useful in `<img src>`):

```html
<img src="https://api.microlink.io/?url=https://example.com&screenshot=true&meta=false&embed=screenshot.url">
```

Useful paths: `screenshot.url`, `pdf.url`, `image.url`, `logo.url`, `video.url`.

## Error Handling

```js
import createClient, { MicrolinkError } from 'microlink.io'

const microlink = createClient()

try {
  await microlink.screenshot('https://example.com')
} catch (error) {
  if (error instanceof MicrolinkError) {
    // error.status, error.code, error.message, error.statusCode
  }
}
```

Common error codes: `EAUTH`, `ERATE`, `EINVALURL`, `EBRWSRTIMEOUT`, `EPRO`, `ETIMEOUT`.

## Security And Reliability Rules

- Never expose `x-api-key` in client-side code.
- Use `pro.microlink.io` for authenticated requests (set `apiKey` on the client).
- For frontend usage, use a server proxy (`microlinkhq/proxy` or `microlinkhq/edge-proxy`).
- If a request is heavy and metadata is not needed, product methods already set `meta: false`.

## CLI

```bash
npx microlink.io <url|product> [flags]
npx microlink.io login
```

See [microlink](../microlink/SKILL.md) for every product as a subcommand.

## Deep Reference

For complete parameter-by-parameter docs, full error matrix, and response headers, see [api-reference.md](api-reference.md).
