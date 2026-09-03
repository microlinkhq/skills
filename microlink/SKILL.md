---
name: microlink
description: Turn URLs into product results with microlink.io — metadata, markdown/html/text, screenshots, PDFs, logos, embeds, video/audio, page collections, Google search, and remote JS functions. Use when the user mentions Microlink, microlink.io, taking screenshots, generating PDFs, extracting page content, scraping without browser infra, or the microlink CLI/MCP.
---

# microlink.io

The Microlink API organized into products. Each method returns a **direct result**.

For HTTP query-parameter details, see [microlink-api](../microlink-api/SKILL.md).

## Quick Start

```js
import createClient from 'microlink.io'

const microlink = createClient()
const microlinkPro = createClient({ apiKey: process.env.MICROLINK_API_KEY })

const markdown = await microlink.markdown('https://example.com')
```

```bash
npm install microlink.io
npx microlink.io markdown https://example.com
```

Factory options merge into every call. Per-call options override them.

## Option Routing

Every product is `product(url, options)`. Keys are routed automatically:

- `headers` — real HTTP request headers (never in the URL). The API forwards `x-api-header-<name>` to the target as `<name>` (cookies, auth).
- Well-known capability keys nest under the product (`fullPage` → screenshot, `format` → pdf, `selector` → markdown).
- Everything else is a top-level API query param (`device`, `waitUntil`, `prerender`, `ttl`, `proxy`, …).

```js
await microlink.screenshot('https://example.com', {
  fullPage: true, // nests under screenshot
  device: 'iPhone 11' // top-level query param
})
```

## Products

| Need | Method |
| --- | --- |
| Link preview / metadata | `metadata(url)` |
| Markdown / HTML / text | `markdown` / `html` / `text` |
| Screenshot | `screenshot(url)` — `{ animated: true }` for GIF/MP4 |
| PDF | `pdf(url)` |
| Brand logo | `logo(url)` |
| oEmbed iframe | `embed(url)` |
| Primary video / audio | `video(url)` / `audio(url)` |
| All links / images / videos / audios / emails | `links` / `images` / `videos` / `audios` / `emails` |
| Custom CSS rules | `extract(url, rules)` |
| Tech stack | `technologies(url)` |
| Lighthouse | `lighthouse(url)` |
| Google as structured data | `search(query)` — requires `apiKey` |
| Remote JavaScript | `run(url, code)` (alias `function`) |

### metadata(url, options)

Unified metadata object (`title`, `description`, `image`, `publisher`, …):

```js
const { title, description } = await microlink.metadata('https://vercel.com')
```

### markdown / html / text

Page content. Scope with `selector`:

```js
const markdown = await microlink.markdown('https://example.com', { selector: 'article' })
```

### screenshot / pdf

Returns an asset object (`url`, `type`, `width`, `height`, `size`, …):

```js
const { url } = await microlink.screenshot('https://example.com', { fullPage: true })
const { url: pdfUrl } = await microlink.pdf('https://example.com', { format: 'A4' })
```

Screenshot keys: `fullPage`, `type` (`png`/`jpeg`), `element`, `omitBackground`, `overlay`, `codeScheme`, `animated`, `palette`, `quality`, `optimizeForSpeed`.

PDF keys: `format`, `margin`, `scale`, `landscape`, `pageRanges`, `width`, `height`, `printBackground`.

### logo(url, options)

```js
const { url } = await microlink.logo('https://github.com', { square: true })
```

### embed(url, options)

oEmbed-style `{ html, scripts }`. Constrain with `maxWidth` / `maxHeight`.

```js
const { html } = await microlink.embed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
```

### video / audio

Primary playable source as an asset object:

```js
const { url } = await microlink.video('https://vimeo.com/76979871')
```

### links / images / videos / audios / emails

Clean `string[]` — absolute, junk-filtered, deduped. Scope collections with `selectorAll`:

```js
const links = await microlink.links('https://example.com', { selectorAll: 'nav a' })
const emails = await microlink.emails('https://microlink.io')
```

### extract(url, rules, options)

Custom CSS rules, result unwrapped:

```js
const { image } = await microlink.extract('https://microlink.io', {
  image: { selector: 'meta[property="og:image"]', attr: 'content', type: 'image' }
})
```

Single value:

```js
{ avatar: { selector: '#avatar', attr: 'src', type: 'image' } }
```

Collection:

```js
{ stories: { selectorAll: '.titleline > a', attr: 'text' } }
```

Fallback list (first match wins):

```js
{
  title: [
    { selector: 'meta[property="og:title"]', attr: 'content' },
    { selector: 'title', attr: 'text' },
    { selector: 'h1', attr: 'text' }
  ]
}
```

Nested object:

```js
{
  stats: {
    selector: '.profile',
    attr: {
      followers: { selector: '.followers', type: 'number' },
      stars: { selector: '.stars', type: 'number' }
    }
  }
}
```

Evaluate JS in the page:

```js
{ version: { evaluate: 'window.next.version', type: 'string' } }
```

### technologies / lighthouse

```js
const technologies = await microlink.technologies('https://microlink.io')
const report = await microlink.lighthouse('https://microlink.io', {
  onlyCategories: ['performance']
})
```

Lighthouse keys: `onlyCategories`, `onlyAudits`, `skipAudits`, `output`.

### search(query, options)

Google as structured data. Requires `apiKey`. Operators (`site:`, `filetype:`, quotes) work as-is.

```js
const page = await microlink.search('Lotus Elise S2')
console.log(page.results) // [{ title, url, description }, ...]
console.log(page.knowledgeGraph)
console.log(page.peopleAlsoAsk)
console.log(page.relatedSearches)
```

| `type` | Returns |
| --- | --- |
| `search` (default) | web results + knowledge graph, related questions/searches |
| `news` | articles with `publisher`, `date`, thumbnail |
| `images` | full-resolution image URLs with dimensions |
| `videos` | video metadata with duration |
| `places` / `maps` | local entities with address, phone, coordinates, ratings, hours |
| `shopping` | products with parsed `price` and ratings |
| `scholar` | papers with citation counts and PDF links |
| `patents` | filings with ISO 8601 dates |
| `autocomplete` | query suggestions (`value` only) |

```js
await microlink.search('open source llm', { type: 'news', period: 'week' })
await microlink.search('recetas de pasta', { location: 'es', limit: 10 })
await microlink.search('node.js frameworks', { page: 2 })
```

Results with a `url` expose lazy `.html()` and `.markdown()`. The page itself has the same helpers plus `.next()`:

```js
const page = await microlink.search('site:openai.com function calling guide')
await Promise.all(
  page.results.slice(0, 3).map(async result => ({
    title: result.title,
    url: result.url,
    markdown: await result.markdown()
  }))
)
```

Eager fetch: `{ html: true }` or `{ markdown: true }` resolves page + every result up front.

Vertical result fields (plus `html()` / `markdown()` when the result has a `url`):

- `search`: `title`, `url`, `description`
- `news`: + `date`, `publisher`, `image?`
- `images`: `title`, `url`, `image { url, width, height }`, `thumbnail`
- `videos`: + `duration`, `duration_pretty`, `publisher`, `channel`
- `places`: `title`, `address`, `latitude`, `longitude`, `phone? { number }`, `cid`
- `maps`: places + `rating`, `ratingCount`, `price? { level }`, `opening? { hours }`
- `shopping`: `title`, `url`, `publisher`, `price { symbol, amount }`, `rating?`
- `scholar`: `title`, `url`, `publisher`, `year`, `citations`, `pdf?`
- `patents`: `title`, `url`, `priority`/`filing`/`grant`/`publication` dates, `inventor`, `assignee`, `pdf?`
- `autocomplete`: `value` only (no `url`)

### run(url, code, options)

Run JavaScript in Microlink's sandbox. Alias: `function`. If the code does not reference `page`, no browser starts.

Prefer `extract` for simple DOM fields, and `styles`/`scripts`/`modules` for injection. Use `run` when you need to click, wait, compute, or `require()` a package.

```js
const { value } = await microlink.run('https://example.com', () => 40 + 2)

const { value: title } = await microlink.run('https://example.com', async ({ page }) => {
  await page.waitForSelector('h1')
  return page.$eval('h1', el => el.textContent)
})
```

Extra options are forwarded into function scope. `require()` any npm package (`require('cheerio@1.0.0')` to pin). Result: `isFulfilled`, `value`, `logging`, `profiling`. Thrown code still resolves — `isFulfilled` is `false` and `value` is `{ name, message }`.

Prefer `page.title()`, `page.$eval()`, `page.waitForSelector()` over `page.evaluate()` and fixed timeouts. Set `meta: false` unless you need metadata.

| | Free | Pro |
| --- | --- | --- |
| Timeout | 5s | up to 60s |
| Memory | 16 MB | 32 MB |
| Code size | 1024 bytes | unlimited |
| Concurrency | 1 per IP | unlimited |

Resource errors: `TimeoutError`, `CpuTimeError`, `MemoryError`, `CodeSizeError`, `ConcurrencyError`. Function errors: `EINVALFUNCTION` (syntax), `EINVALEVAL` (runtime).

## Shared Browser / Cache Options

Available on most URL products:

- Browser: `prerender`, `waitUntil`, `waitForSelector`, `waitForTimeout`, `timeout`, `device`, `viewport`, `javascript`, `animations`, `adblock`, `mediaType`, `colorScheme`, `click`, `scroll`, `scripts`, `modules`, `styles`
- Cache: `force`, `ttl`, `staleTtl` (Pro), `cacheKey`
- Pro: `headers`, `proxy`, `filename`

If metadata is not needed, product methods already set `meta: false`.

## Authentication

`apiKey` is sent as `x-api-key`. Never put secrets in URLs.

```js
const microlink = createClient({ apiKey: process.env.MICROLINK_API_KEY })

await microlink.markdown('https://x.com/some/article', {
  headers: { 'x-api-header-cookie': 'auth_token=...' } // forwarded as `cookie`
})
```

- Free: `https://api.microlink.io` — 50 requests/day, no key
- Pro: `https://pro.microlink.io` — set `apiKey` (or `endpoint` to override)

Never expose `apiKey` in client-side code. Proxy through a server (`microlinkhq/proxy` or `microlinkhq/edge-proxy`).

## Error Handling

API errors reject with `MicrolinkError` (`code`, `statusCode`, `description`):

```js
import createClient, { MicrolinkError } from 'microlink.io'

try {
  await microlink.screenshot('https://example.com')
} catch (error) {
  if (error instanceof MicrolinkError) console.error(error.code, error.description)
}
```

Common codes: `EAUTH`, `ERATE`, `EINVALURL`, `EBRWSRTIMEOUT`, `EPRO`, `ETIMEOUT`.

## CLI

`npx microlink.io` works without a global install. `microlink login` saves an API key; `logout` clears it. A bare URL defaults to `metadata`.

```bash
npx microlink.io login
npx microlink.io https://example.com
npx microlink.io markdown https://example.com --selector article
npx microlink.io screenshot https://example.com --fullPage
npx microlink.io logo https://github.com --square
npx microlink.io links https://example.com
npx microlink.io search "best coffee" --limit 10 --location es
npx microlink.io search "the matrix" --markdown --page 2
npx microlink.io extract https://microlink.io --data '{"image":{"selector":"meta[property=og:image]","attr":"content","type":"image"}}'
npx microlink.io function https://example.com --file ./fn.js --selector h1
```

Shared flags: `--api-key`, `--endpoint`, `--header` / `-H`, `--http.header.<name>`, `--trace`, `--trace-full`. `--trace` is not supported for `search` / `function` / `run`.

On `429`, the CLI hints to run `microlink login`.

## MCP

For AI assistants, use `@microlink/mcp` — see [microlink-mcp](../microlink-mcp/SKILL.md). Each tool mirrors a product method (`microlink_screenshot` → `screenshot()`, …).
