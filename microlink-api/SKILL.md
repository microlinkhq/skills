---
name: microlink-api
description: Interact with Microlink API and MQL for metadata extraction, screenshots, PDFs, web scraping, and browser automation. Use when the user mentions Microlink, MQL, @microlink/mql, web scraping with CSS selectors, taking website screenshots, generating PDFs from URLs, extracting metadata from links, or embedding link previews.
---

# Microlink API

Microlink API automates browser actions via HTTP GET. Given a URL, it returns structured data (metadata, screenshots, PDFs, scraped content).

## Endpoints

- **Free**: `https://api.microlink.io` — unauthenticated, 50 reqs/day
- **Pro**: `https://pro.microlink.io` — authenticated via `x-api-key` header, starts at 14,000 reqs/month

Query parameters support both camelCase and snake_case.

## Authentication

Pass API key as `x-api-key` request header. Verify with `x-pricing-plan: pro` in response headers.

Never expose API keys in client-side code. Use [proxy](https://github.com/microlinkhq/proxy) or [edge-proxy](https://github.com/microlinkhq/edge-proxy) for frontend usage.

## Response Format (JSend)

```json
{
  "status": "success",
  "data": { "title": "...", "description": "...", "image": { "url": "...", "width": 1280, "height": 720, "type": "jpg", "size": 120116, "size_pretty": "120 kB" }, "url": "..." },
  "message": "optional error message",
  "more": "optional docs link"
}
```

Status values: `'success'` (2xx), `'fail'` (4xx), `'error'` (5xx).

## Default Data Fields

Extracted automatically from any URL: `title`, `description`, `author`, `publisher`, `date` (ISO 8601), `lang` (ISO 639-1), `url`, `image`, `video`, `logo`.

Media fields include: `width`, `height`, `type`, `size`, `size_pretty`. Playable media adds `duration`, `duration_pretty`.

Additional HTTP info: `statusCode`, `headers`, `redirects`.

## Core Parameters

| Parameter    | Type           | Default      | Pro | Description                                                       |
| ------------ | -------------- | ------------ | --- | ----------------------------------------------------------------- |
| `url`        | string         | **required** |     | Target URL (must include protocol)                                |
| `screenshot` | boolean        | false        |     | Generate screenshot                                               |
| `pdf`        | boolean        | false        |     | Generate PDF                                                      |
| `video`      | boolean        | false        |     | Detect video sources                                              |
| `audio`      | boolean        | false        |     | Detect audio sources                                              |
| `meta`       | boolean/object | true         |     | Metadata extraction (disable with `false` to speed up)            |
| `data`       | object         |              |     | Custom scraping rules (CSS selectors)                             |
| `embed`      | string         |              |     | Return specific field as response body (e.g., `'screenshot.url'`) |
| `filter`     | string         |              |     | Comma-separated fields to pick from response                      |
| `prerender`  | boolean/string | 'auto'       |     | Headless browser: `true`, `false`, or `'auto'`                    |
| `iframe`     | boolean/object | false        |     | oEmbed detection                                                  |
| `insights`   | boolean/object | false        |     | Lighthouse + Wappalyzer tech detection                            |
| `palette`    | boolean        | false        |     | Color palette extraction                                          |
| `function`   | string         |              |     | Execute JS with Puppeteer page access                             |

## Screenshot Options

| Parameter                   | Type    | Default     | Description                                                                                        |
| --------------------------- | ------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `screenshot.element`        | string  |             | CSS selector to capture specific element                                                           |
| `screenshot.fullPage`       | boolean | false       | Full scrollable page                                                                               |
| `screenshot.type`           | string  | 'png'       | `'jpeg'` or `'png'`                                                                                |
| `screenshot.omitBackground` | boolean | false       | Transparent background                                                                             |
| `screenshot.overlay`        | object  |             | Browser chrome overlay (`browser`: `'light'`/`'dark'`, `background`: CSS gradient/color/image URL) |
| `screenshot.codeScheme`     | string  | 'atom-dark' | Syntax highlighting theme                                                                          |

## PDF Options

| Parameter        | Type          | Default | Description                            |
| ---------------- | ------------- | ------- | -------------------------------------- |
| `pdf.format`     | string        |         | Page format (e.g., `'A4'`, `'Letter'`) |
| `pdf.landscape`  | boolean       | false   | Landscape orientation                  |
| `pdf.scale`      | number        |         | Scale factor                           |
| `pdf.margin`     | string/object |         | Page margins                           |
| `pdf.pageRanges` | string        |         | Pages to print (e.g., `'1-3'`)         |

## Browser Control

| Parameter         | Type            | Default          | Description                                                        |
| ----------------- | --------------- | ---------------- | ------------------------------------------------------------------ |
| `device`          | string          | 'macbook pro 13' | Device emulation (e.g., `'iPad'`, `'iPhone X'`)                    |
| `viewport`        | object          |                  | `{ width, height, deviceScaleFactor, isMobile }`                   |
| `colorScheme`     | string          | 'no-preference'  | `'light'` or `'dark'`                                              |
| `javascript`      | boolean         | true             | Enable/disable JS execution                                        |
| `animations`      | boolean         | false            | Enable CSS animations                                              |
| `mediaType`       | string          | 'screen'         | `'screen'` or `'print'`                                            |
| `click`           | string/string[] |                  | CSS selector(s) to click                                           |
| `scroll`          | string          |                  | CSS selector to scroll to                                          |
| `scripts`         | string/string[] |                  | Inject `<script>` (inline code or URL)                             |
| `modules`         | string/string[] |                  | Inject `<script type="module">`                                    |
| `styles`          | string/string[] |                  | Inject `<style>` (inline CSS or URL)                               |
| `waitUntil`       | string/string[] | 'auto'           | `'load'`, `'domcontentloaded'`, `'networkidle0'`, `'networkidle2'` |
| `waitForSelector` | string          |                  | Wait for CSS selector                                              |
| `waitForTimeout`  | string/number   |                  | Wait duration (e.g., `'3s'`, `3000`)                               |
| `timeout`         | string/number   | 28s              | Max request lifecycle                                              |

## Cache Control

| Parameter  | Type                  | Default | Pro | Description                                                      |
| ---------- | --------------------- | ------- | --- | ---------------------------------------------------------------- |
| `ttl`      | string/number         | '24h'   | yes | Cache lifetime (1m to 31d). Formats: `'1d'`, `'24h'`, `86400000` |
| `staleTtl` | string/number/boolean | false   | yes | Serve stale while revalidating. `staleTtl=0` always revalidates  |
| `force`    | boolean               | false   |     | Bypass cache, get fresh copy                                     |

Cache headers: `x-cache-status` (`HIT`/`MISS`/`BYPASS`), `x-cache-ttl`.

## Pro-Only Parameters

`headers`, `proxy`, `ttl`, `staleTtl`, `filename` require a Pro plan.

- `headers`: Custom HTTP headers. Use `x-api-header-*` prefix for sensitive headers
- `proxy`: Custom proxy URL or automatic proxy resolution for anti-bot bypass
- `filename`: Custom name for generated screenshot/PDF assets

## Embed Pattern

Use `embed` to serve assets directly (no JSON wrapper):

```html
<img src="https://api.microlink.io/?url=https://example.com&screenshot=true&meta=false&embed=screenshot.url">
```

Common embed fields: `screenshot.url`, `pdf.url`, `image.url`, `logo.url`, `video.url`.

## function Parameter

Execute custom JS with Puppeteer access. Receives `{ page, html, response }` plus any query params:

```js
const { data } = await mql('https://example.com', {
  function: '({ page }) => page.evaluate("document.title")',
  meta: false
})
console.log(data.function)
```

Supports compression (`lz#`, `gz#`, `br#` prefixes) and NPM packages: `cheerio`, `lodash`, `got`, `jsdom`, `@mozilla/readability`, `ioredis`, `@aws-sdk/client-s3`, `youtube-dl-exec`, and others.

## Error Codes

| Code          | Cause                              |
| ------------- | ---------------------------------- |
| EAUTH         | Invalid API key                    |
| ERATE         | Daily rate limit reached           |
| EINVALURL     | Invalid URL format                 |
| EBRWSRTIMEOUT | Browser navigation timeout         |
| EFATAL        | Generic resolution failure         |
| EPRO          | Auth request sent to free endpoint |
| ETIMEOUT      | Request timeout exceeded           |

For complete details, see [api-reference.md](api-reference.md).

---

## MQL (Microlink Query Language)

MQL is the official Node.js/browser HTTP client for Microlink API (`@microlink/mql`).

### Installation

```bash
npm install @microlink/mql --save
```

### Environments

- **Node.js**: `const mql = require('@microlink/mql')`
- **Edge/WinterCG**: `import mql from '@microlink/mql/lightweight'`
- **Browser**: `import mql from 'https://esm.sh/@microlink/mql'`

### Basic Usage

```js
const mql = require('@microlink/mql')
const { status, data, response } = await mql('https://example.com')
```

### API Signature

```
mql(url, [options], [httpOptions])
```

- `url`: Target URL (required)
- `options`: Any Microlink API parameter + `apiKey`, `cache`, `retry`
- `httpOptions`: Passed to underlying HTTP client (got/ky)

Additional methods: `mql.stream()`, `mql.buffer()`.

### Error Handling

```js
const { MicrolinkError } = mql
try {
  const { data } = await mql('https://example.com', { screenshot: true })
} catch (error) {
  // error.status, error.code, error.message, error.statusCode
}
```

### Client-Side Caching (Node.js only)

```js
const cache = new Map()
const { data } = await mql('https://example.com', { cache })
// data.response.fromCache → true on second call
```

## Custom Data Extraction (Scraping)

Define rules with three primitives: **selector** (CSS), **attr** (what to extract), **type** (validation).

### Single Field

```js
const { data } = await mql('https://kikobeats.com', {
  data: {
    avatar: { selector: '#avatar', type: 'image', attr: 'src' }
  }
})
```

### Multiple Fields

```js
const { data } = await mql('https://news.ycombinator.com', {
  data: {
    headline: { selector: '.titleline > a', attr: 'text' },
    link: { selector: '.titleline > a', attr: 'href', type: 'url' }
  }
})
```

### Collections (selectorAll)

```js
const { data } = await mql('https://news.ycombinator.com', {
  data: {
    stories: { selectorAll: '.titleline > a', attr: 'text' }
  }
})
```

### Fallback Rules

```js
data: {
  title: [
    { selector: 'meta[property="og:title"]', attr: 'content' },
    { selector: 'title', attr: 'text' },
    { selector: 'h1', attr: 'text' }
  ]
}
```

### Nested Rules

```js
data: {
  stats: {
    selector: '.profile',
    attr: {
      followers: { selector: '.followers', type: 'number' },
      stars: { selector: '.stars', type: 'number' }
    }
  }
}
```

### Whole-Page Serialization

```js
data: {
  content: { attr: 'markdown' }  // omit selector for full page
}
```

### attr Values

Standard HTML attributes plus: `'html'`, `'outerHTML'`, `'text'`, `'markdown'`, `'val'`.

### type Values

`'auto'`, `'string'`, `'number'`, `'boolean'`, `'date'`, `'image'`, `'url'`, `'audio'`, `'video'`, `'email'`, `'author'`, `'publisher'`, `'title'`, `'description'`, `'lang'`, `'logo'`, `'object'`, `'regexp'`, `'ip'`.

### evaluate

Execute JS in browser context instead of CSS selectors:

```js
data: {
  version: { evaluate: 'window.next.version', type: 'string' }
}
```

## CLI

```bash
npm install @microlink/cli --global
microlink <url> [flags]
```

Flags: `--api-key`, `--colors`, `--copy`, `--pretty`.

## Additional Resources

- For full API parameter reference, see [api-reference.md](api-reference.md)
